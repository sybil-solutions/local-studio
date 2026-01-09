# Controller (FastAPI)

The controller is the “model lifecycle” service: it stores recipes, launches/evicts inference backends as host subprocesses (vLLM/SGLang/Transformers), exposes a small API for the UI, and proxies OpenAI chat requests to LiteLLM with auto model switching.

Key code:

- API server: `controller/app.py`
- Process management: `controller/process.py`
- Backend command builders: `controller/backends.py`
- Recipe storage (SQLite): `controller/store.py`
- SSE events: `controller/events.py`
- GPU metrics: `controller/gpu.py`

## Responsibilities

- **Recipes**
  - CRUD via `/recipes` (stored as JSON blobs in SQLite at `VLLM_STUDIO_DB_PATH` / `./data/controller.db` by default).
  - The UI treats `Recipe.id` as the primary handle.
- **Model lifecycle**
  - Launch/evict inference servers on `VLLM_STUDIO_INFERENCE_PORT` (default `8000`).
  - Track “currently launching recipe” and broadcast progress via SSE.
- **Real-time telemetry**
  - `/events` streams `status`, `gpu`, `metrics`, and `launch_progress` events.
  - `/logs/{id}` and `/logs/{id}/stream` expose launch logs from `/tmp`.
- **Chat proxy**
  - `/v1/chat/completions` auto-switches models (if it can map the requested `model` to a recipe) and then forwards to LiteLLM.

## Data model: Recipe

`controller/models.py` defines `Recipe` (pydantic v2). A recipe roughly corresponds to a CLI invocation of vLLM/SGLang.

Important fields:

- `id`, `name`, `model_path`, `backend`
- Parallelism: `tensor_parallel_size` (`tp`), `pipeline_parallel_size` (`pp`)
- vLLM knobs: `max_model_len`, `gpu_memory_utilization`, `max_num_seqs`, `kv_cache_dtype`, `dtype`, `quantization`, `tool_call_parser`, `reasoning_parser`, `enable_auto_tool_choice`, etc.
- Tool call parsers: auto-detected based on model name/path (GLM → `glm45`, INTELLECT-3 → `glm45`)
- Reasoning parsers: auto-detected based on model name/path (GLM → `glm45`, INTELLECT-3 → `deepseek_r1`, MiniMax M2 → `minimax_m2_append_think`)
- Runtime selection:
  - `python_path` (explicit interpreter) **or**
  - `extra_args.venv_path` (venv directory; controller uses `<venv>/bin/vllm` or `<venv>/bin/python` if present)
- Environment:
  - `env_vars` (preferred) and legacy `extra_args.env_vars` / `env-vars` / `envVars` (back-compat)
- `extra_args`: all other flags not explicitly modeled; they are passed through to the backend as `--kebab-case` CLI flags (except controller-internal keys).

## Local model weights discovery

The controller provides a lightweight discovery endpoint the UI uses to show “model weights on disk” and link them to recipes:

- Endpoint: `GET /v1/studio/models`
- Settings: `VLLM_STUDIO_MODELS_DIR` (default `/models`)

Behavior:

- Scans `VLLM_STUDIO_MODELS_DIR` **and** the parent directories of any *local* recipe `model_path` values (absolute paths).
- Identifies a “model directory” if it contains `config.json` or weight files (`*.safetensors`, `*.bin`, `*.gguf`).
- Returns metadata and a list of `recipe_ids` that reference each model path.

Response shape (simplified):

- `models`: `{ name, path, size_bytes?, modified_at?, architecture?, context_length?, quantization?, recipe_ids[], has_recipe }[]`
- `roots`: `{ path, exists, sources[], recipe_ids[] }[]` (where the scan looked)
- `configured_models_dir`: the configured root path as a string

## Process detection

`controller/process.py` finds “the running inference server” by scanning processes with `psutil` and matching cmdlines:

- vLLM: `vllm.entrypoints.openai.api_server` or a `vllm serve ...` invocation
- SGLang: `sglang.launch_server`
- Transformers fallback: `scripts.deepseek.transformers_server:app`

It then matches by `--port` and extracts:

- `--model` / `--model-path` / `serve <model_path>`
- `--served-model-name`

This detection feeds:

- `/status` and `/health`
- `/recipes` status annotations (“running”, “starting”, “stopped”)
- metrics collection logic that needs a current model id

## Launch lifecycle

### API surface

- `POST /launch/{recipe_id}?force=true|false`
  - Always evicts first (currently uses `force=True` in the UI paths).
  - Writes logs to `/tmp/vllm_{recipe_id}.log`.
  - Waits up to 300s for `http://localhost:{inference_port}/health` to return 200.
- `POST /evict?force=true|false`
  - Stops the currently detected inference process.
- `GET /wait-ready?timeout=...`
  - Polls `/health` on the inference port until ready or timeout.

### Concurrency / preemption model

The controller uses a single `_switch_lock` to ensure only one switch (evict+launch) occurs at a time.

When a second launch request arrives while another is in progress:

- The controller publishes `launch_progress` events: `preempting` → `cancelled` (for the old recipe) → proceeds with the new launch.
- It signals a **per-recipe cancel event** and force-evicts the backend process to free VRAM quickly.

This is designed so the UI never sits waiting for an “abandoned” launch to finish a 5-minute readiness loop.

### Failure behavior

- If the launched process exits early, `/launch` returns `success=false` with a tail of `/tmp/vllm_{id}.log`.
- If readiness times out (no `/health` within 300s), the controller kills the process and returns `success=false` with a log tail. This prevents leaving a wedged backend around.

## SSE events

`GET /events` is an SSE stream. Event types:

- `status`: running/process info + inference port
- `gpu`: GPU list + count
- `metrics`: vLLM metrics snapshot (parsed from Prometheus text when available)
- `launch_progress`: `{ recipe_id, stage, message, progress? }`

The UI is expected to treat `ready`, `error`, and `cancelled` as terminal stages.

## Logs

- Launch logs are written to `/tmp/vllm_{recipe_id}.log` from `controller/process.py`.
- Controller exposes:
  - `GET /logs` (list sessions from `/tmp`)
  - `GET /logs/{id}` (tail)
  - `GET /logs/{id}/stream` (SSE tail)

## Chat proxy (auto model switching)

- Endpoint: `POST /v1/chat/completions` (OpenAI-compatible)
- Behavior:
  1. Parse request JSON, extract `model`.
  2. If `model` matches a recipe by `served_model_name` or `id`, switch to it (evict → launch → wait ready).
  3. Forward the request body to LiteLLM at `http://localhost:4100/v1/chat/completions`.

The “mapping” step is important: if chat uses model names that don’t match recipe `id` or `served_model_name`, the controller will not switch and LiteLLM will route to whatever is currently running.
