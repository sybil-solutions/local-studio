# Runtime + venv selection

Model launches are host subprocesses. The controller decides **which Python/vLLM runtime** to use per recipe; if this is inconsistent, you’ll see “same recipe, different behavior” depending on PATH and the machine’s Python installs.

Key code: `controller/backends.py`

## How the runtime is chosen

For **vLLM** recipes (`backend: vllm`), the controller builds a command in this order:

1. If `recipe.python_path` is set:
   - Prefer `<dir-of-python>/vllm serve ...` if that `vllm` executable exists.
   - Else use `python -m vllm.entrypoints.openai.api_server ...`.
2. Else if `recipe.extra_args.venv_path` is set and `<venv>/bin/python` exists:
   - Same preference for `<venv>/bin/vllm` if present.
3. Else:
   - Uses `vllm serve ...` from `PATH`.

For **SGLang**, it uses `recipe.python_path` or `VLLM_STUDIO_SGLANG_PYTHON` or `python`.

## Env vars

The backend subprocess environment is:

- Current controller env (`os.environ`)
- plus recipe env vars from:
  - `recipe.env_vars` (preferred), and
  - legacy `extra_args.env_vars` / `env-vars` / `envVars`
- plus `CUDA_VISIBLE_DEVICES` if provided in `extra_args.cuda_visible_devices` / `cuda-visible-devices`

Key code: `controller/process.py`

## Why vLLM versions can drift

The controller process and the launched inference process do **not** need to share the same Python environment.

Example failure mode:

- `vllm` on PATH points at `/usr/bin/python3.10` with vLLM `0.14.x`
- the controller runs under `python3.11` and imports vLLM `0.11.x` (or none)

That is not inherently wrong, but it makes “what version is actually running?” confusing unless you pin it per recipe.

## Recommended practice

- Treat `python_path` as required for production recipes.
  - Put a known venv under something like `/opt/venvs/vllm-0.14/bin/python`.
- Bake the vLLM version into the venv path name.
- Keep `served_model_name` aligned with the model name your chat/UI will request.

## Quick verification commands

- Check which `vllm` will be launched when `python_path` is **not** set:
  - `which vllm && head -n 1 $(which vllm) && vllm --version`
- Check a recipe’s pinned interpreter:
  - `<python_path> -c "import vllm; print(vllm.__version__)"`

