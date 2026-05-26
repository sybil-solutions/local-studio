# Recipes & Models

Once the controller is running, a **recipe** is how you tell it what model to run and how to run it. Think of it as a launch configuration — backend, model path, GPU settings, all in one place.

---

## Creating your first recipe

Go to the **Recipes** page (`/recipes` in the frontend) and click **New Recipe**. The essential fields:

| Field | What to put |
|---|---|
| **Name** | Anything — `"Mistral 7B"`, `"my-local-llama"` |
| **Backend** | `vllm` is the default and most common |
| **Model path** | A HuggingFace model ID like `mistralai/Mistral-7B-Instruct-v0.3` or a local path like `/models/mistral-7b` |
| **Tensor parallel size** | Number of GPUs to split across — `1` for single GPU, `2` for two, etc. |

The defaults for everything else work for most models. Click **Save**, then **Launch**.

---

## Backends

Six backends are available. Pick the one that matches your model and setup.

| Backend | Best for | Model path format | Notes |
|---|---|---|---|
| **vLLM** | Most models, best throughput | HF ID or local path | Default. Supports AWQ/GPTQ quantization, tensor parallelism, tool calling. |
| **SGLang** | High-throughput serving, structured outputs | HF ID or local path | Similar to vLLM. Set `VLLM_STUDIO_SGLANG_PYTHON` if using a venv. |
| **llama.cpp** | GGUF models, CPU/Apple Silicon | Path to `.gguf` file | Uses `llama-server`. Set `VLLM_STUDIO_LLAMA_BIN` to override the binary path. |
| **ExLlamaV3** | GPTQ models on NVIDIA | Local path | Requires `VLLM_STUDIO_EXLLAMAV3_COMMAND` for the launch template. |
| **TabbyAPI** | Exllamav2-based serving | — | Not supported by the controller lifecycle — use directly. |
| **Transformers** | Simple HuggingFace pipeline | HF ID or local path | Falls through to vLLM launch; useful as a compatibility alias. |

---

## Where model weights live

### Option 1: HuggingFace (auto-download)

Put a HuggingFace model ID in the **model path** field — vLLM and SGLang download weights automatically on first launch:

```
mistralai/Mistral-7B-Instruct-v0.3
meta-llama/Llama-3.1-8B-Instruct
Qwen/Qwen2.5-7B-Instruct
```

### Option 2: Local models directory

Set `VLLM_STUDIO_MODELS_DIR` to a directory containing model folders (default `/models`). Each subfolder should contain a HuggingFace-format model (`config.json` + `.safetensors` files).

The controller scans this directory automatically. Discovered models appear on the Recipes page.

For llama.cpp, point the model path directly at a `.gguf` file:

```
/models/llama-3.1-8b-q4_k_m.gguf
```

### Option 3: Browse from the UI

The Recipes page has a **Model Browser** that searches local directories and HuggingFace — you can pick a model without typing paths.

---

## Launching a model

From the Recipes page, click **Launch** next to your recipe. The launch goes through four stages:

| Stage | What's happening |
|---|---|
| `idle` | Nothing running |
| `launching` | Building the command, spawning the process |
| `waiting` | Process started, polling `:8000/health` until the model is ready |
| `ready` | Model is serving — you can chat now |
| `error` | Something went wrong — check the logs |

Logs are written to `<data_dir>/<recipe_id>.log`. To watch in real time:

```bash
tail -f data/<your-recipe-id>.log
```

### Switching models

Launching a new recipe automatically stops the currently running model. You don't need to manually evict — just launch the one you want.

### Evicting (stopping a model)

Click **Evict** on the Recipes page, or use the CLI:

```bash
bun src/main.ts evict
```

---

## Common configurations

### Multi-GPU

Set **tensor parallel size** to your GPU count. For 4 GPUs:

```
tensor_parallel_size: 4
```

vLLM handles the rest — no other config needed.

### Quantized models (AWQ, GPTQ)

Set the **quantization** field:

```
quantization: "awq"
```

The model path should point to the quantized weights. vLLM detects the quantization method from the model config in most cases — you only need to set this explicitly if auto-detection fails.

### Custom Python environment

If vLLM or SGLang is installed in a specific venv:

```bash
# Set before starting the controller
VLLM_STUDIO_RUNTIME_PYTHON=/path/to/venv/bin/python bun src/main.ts
```

Or set per-recipe in the **python_path** field.

### Mock mode (no GPU)

```bash
VLLM_STUDIO_MOCK_INFERENCE=1 bun src/main.ts
```

Mock mode skips model loading entirely — recipes still work but return synthetic responses. Good for UI development.

---

## Troubleshooting launches

**Port 8000 already in use:**
```bash
lsof -i :8000
```
Change the recipe's **port** field, or set `VLLM_STUDIO_INFERENCE_PORT`.

**GPU out of memory:**
Lower these in the recipe:
- **GPU memory utilization** — try `0.7` instead of `0.9`
- **Max model length** — try `8192` instead of `32768`
- Use a quantized version of the model (AWQ or GPTQ)

**Backend binary not found:**
- vLLM: make sure `vllm` is on `PATH`, or set `VLLM_STUDIO_RUNTIME_PYTHON`
- SGLang: set `VLLM_STUDIO_SGLANG_PYTHON` to a venv with SGLang installed
- llama.cpp: set `VLLM_STUDIO_LLAMA_BIN` to the `llama-server` binary path

**Launch hangs at "waiting":**
Check the log file — the model is likely still loading weights. Large models can take several minutes. The default timeout is 5 minutes before the controller reports an error.

**Recipe won't save:**
The **model path** and **name** fields are required. If you see a validation error, check that the backend is one of `vllm`, `sglang`, `llamacpp`, `transformers`, `tabbyapi`, or `exllamav3`.

---

## Next steps

- [Agent workspace](./agent-workspace.md) — the main surface: projects, sessions, panes, composer, tools
- [Environment variables](./environment.md) — `VLLM_STUDIO_MODELS_DIR`, Python paths, GPU monitoring
- [Operations guide](./operations.md) — daemon mode, remote deploy, health checks
- [API docs](http://localhost:8080/api/docs) — recipe CRUD via REST (available when controller is running)

---

[← Back to docs index](./README.md)
