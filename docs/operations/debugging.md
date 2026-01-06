# Debugging “model won’t load” / “what is going on?”

This checklist is aimed at answering two questions quickly:

1. Did the controller *receive* my request?
2. What process/runtime/model is actually running?

## 1) Confirm controller is alive

- `GET http://localhost:8080/health`
- `GET http://localhost:8080/status`

`/status` includes `launching` when a launch is in progress.

## 2) Confirm the UI is seeing SSE

- Open the dashboard and check if it shows “Reconnecting…”.
- `GET http://localhost:8080/events/stats` should show active subscribers.

If SSE is down, the UI can look frozen even when the controller is progressing.

## 3) Inspect launch progress + logs

Controller writes per-recipe logs to:

- `/tmp/vllm_<recipe_id>.log`

API equivalents:

- `GET /logs` (list)
- `GET /logs/<recipe_id>?limit=2000` (tail)
- `GET /logs/<recipe_id>/stream` (SSE tail)

If `/launch/<id>` returns timeout, the tail returned is usually the fastest clue (bad args, missing model path, CUDA OOM, etc).

## 4) Confirm the inference server is actually listening

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/v1/models`

If `/health` never returns 200, the controller will wait (up to 300s) and then fail the launch.

## 5) Confirm the runtime/version you’re *actually* launching

If a recipe doesn’t pin `python_path` or `venv_path`, the controller launches `vllm` from PATH.

On the host:

- `which vllm && head -n 5 $(which vllm)`
- `vllm --version`

If a recipe pins `python_path`, verify that interpreter:

- `<python_path> -c "import vllm; print(vllm.__version__)"`

## 6) Check “wrong model loaded” / “switch didn’t happen”

The controller only auto-switches for chat requests when the request `model` matches:

- `recipe.id` or `recipe.served_model_name`

If chat uses a name that only exists in LiteLLM config (or differs in casing), the controller will not switch and LiteLLM will forward to whatever is running.

See: `docs/litellm/models/README.md`

