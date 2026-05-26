# Environment Variables

Every configuration knob exposed through environment variables. Grouped by concern.

---

## Controller — Core

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_HOST` | `127.0.0.1` | HTTP bind host for the controller |
| `VLLM_STUDIO_PORT` | `8080` | HTTP port for the controller |
| `VLLM_STUDIO_API_KEY` | _(none)_ | Auth token required to call the controller API |
| `VLLM_STUDIO_ALLOW_UNAUTHENTICATED` | _(false)_ | Set to `1` to skip API key checks (trusted local dev only) |
| `VLLM_STUDIO_CORS_ORIGINS` | _(built-in list)_ | Comma-separated additional CORS origins |
| `VLLM_STUDIO_DATA_DIR` | `./data` | Data directory for recipes, chat history, and the SQLite database |
| `VLLM_STUDIO_DB_PATH` | `<dataDir>/controller.db` | Override path to the SQLite database |
| `VLLM_STUDIO_MODELS_DIR` | `/models` | Directory containing model weights |
| `VLLM_STUDIO_VERSION` | `dev` | Version string returned in `/studio/diagnostics` |

---

## Controller — Runtime & Engine Backends

### Python path resolution

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_RUNTIME_PYTHON` | _(auto-detect)_ | Explicit Python binary for the vLLM runtime |
| `VLLM_STUDIO_VLLM_PYTHONS` | _(none)_ | Colon-separated list of additional vLLM Python paths to scan |
| `VLLM_STUDIO_RUNTIME_PYTHONS` | _(none)_ | Colon-separated list of additional runtime Python paths to scan |
| `VLLM_STUDIO_SGLANG_PYTHONS` | _(none)_ | Colon-separated list of SGLang Python paths to scan |
| `VLLM_STUDIO_SGLANG_PYTHON` | _(none)_ | Path to the SGLang Python venv |
| `VLLM_STUDIO_TABBY_API_DIR` | _(none)_ | Path to the TabbyAPI directory |
| `VLLM_STUDIO_LLAMA_BIN` | _(none)_ | Override path to the llama.cpp server binary |
| `VLLM_STUDIO_EXLLAMAV3_COMMAND` | _(none)_ | Custom launch command template for ExLlamaV3 |

### Runtime discovery controls

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_RUNTIME_SKIP_SYSTEM` | _(false)_ | Set to `1` to skip system-installed vLLM/llama-server |
| `VLLM_STUDIO_RUNTIME_SKIP_DOCKER` | _(false)_ | Set to `1` to skip Docker runtime targets |
| `VLLM_STUDIO_RUNTIME_BIN` | _(none)_ | Override path to the runtime binary directory |

### GPU monitoring

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_GPU_SMI_TOOL` | _(auto-detect)_ | Force GPU monitoring tool: `nvidia-smi`, `amd-smi`, or `rocm-smi` |
| `NVIDIA_SMI_PATH` | `nvidia-smi` | Path to the nvidia-smi binary |
| `AMD_SMI_PATH` | `amd-smi` | Path to the amd-smi binary |
| `ROCM_SMI_PATH` | `rocm-smi` | Path to the rocm-smi binary |
| `VLLM_STUDIO_ROCM_VERSION_FILE` | _(auto-detect)_ | Override path to the ROCm version file |

---

## Controller — Inference & Proxy

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_INFERENCE_PORT` | `8000` | Port where the inference backend (vLLM/SGLang) runs |
| `VLLM_STUDIO_MOCK_INFERENCE` | _(false)_ | Enable mock inference mode — no real LLM required |
| `VLLM_STUDIO_MOCK_MODEL_ID` | _(auto)_ | Model ID returned in mock inference mode |
| `VLLM_STUDIO_STRICT_OPENAI_MODELS` | _(false)_ | Only route configured recipes through `/v1/chat/completions` |
| `INFERENCE_API_KEY` | _(empty)_ | API key forwarded to upstream inference requests |

---

## Controller — Logging & Telemetry

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `VLLM_STUDIO_LOG_RETENTION_DAYS` | `30` | Max age of log files in days (0 = infinite) |
| `VLLM_STUDIO_LOG_MAX_FILES` | `200` | Max number of log files (0 = no cap) |
| `VLLM_STUDIO_LOG_MAX_TOTAL_BYTES` | `1_000_000_000` | Max total bytes across all log files (0 = no cap) |
| `VLLM_STUDIO_DISABLE_METRICS` | _(false)_ | Disable the background telemetry/metrics collector |

---

## Controller — Audio (STT / TTS)

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_STT_BACKEND` | `whispercpp` | Speech-to-text backend |
| `VLLM_STUDIO_STT_MODEL` | _(none)_ | Default STT model path or name |
| `VLLM_STUDIO_STT_CLI` | _(none)_ | Path to the STT CLI binary |
| `VLLM_STUDIO_TTS_BACKEND` | `piper` | Text-to-speech backend |
| `VLLM_STUDIO_TTS_MODEL` | _(none)_ | Default TTS model path or name |
| `VLLM_STUDIO_TTS_CLI` | _(none)_ | Path to the TTS CLI binary |
| `VLLM_STUDIO_FFMPEG_CLI` | `ffmpeg` | Path to the ffmpeg binary for audio transcoding |

---

## Controller — Upgrade Commands

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_VLLM_UPGRADE_CMD` | _(none)_ | Custom upgrade command for vLLM |
| `VLLM_STUDIO_VLLM_UPGRADE_VERSION` | _(latest)_ | Pin vLLM upgrade to a specific version |
| `VLLM_STUDIO_LLAMACPP_UPGRADE_CMD` | _(none)_ | Custom upgrade command for llama.cpp |
| `VLLM_STUDIO_SGLANG_UPGRADE_CMD` | _(none)_ | Custom upgrade command for SGLang |
| `VLLM_STUDIO_CUDA_UPGRADE_CMD` | _(none)_ | Custom CUDA upgrade command |
| `VLLM_STUDIO_ROCM_UPGRADE_CMD` | _(none)_ | Custom ROCm upgrade command |

---

## Frontend — Backend URL Resolution

The frontend resolves the controller URL using this priority chain (highest to lowest):

| Priority | Variable | Purpose |
|---|---|---|
| 1 | `BACKEND_URL` | Generic backend URL (server and client) |
| 2 | `NEXT_PUBLIC_BACKEND_URL` | Public backend URL (browser-visible) |
| 3 | `VLLM_STUDIO_BACKEND_URL` | Studio-specific backend URL |
| — | _(fallback)_ | `http://localhost:8080` |

For the settings page default, `NEXT_PUBLIC_API_URL` is checked between `BACKEND_URL` and `VLLM_STUDIO_BACKEND_URL`.

---

## Frontend — API Keys

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VLLM_STUDIO_API_KEY` | _(none)_ | Public API key (checked first, exposed to browser) |
| `VLLM_STUDIO_API_KEY` | _(none)_ | Server-side API key (checked second) |
| `API_KEY` | _(empty)_ | Fallback API key in settings defaults |

---

## CLI

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_STUDIO_URL` | `http://localhost:8080` | Controller base URL for CLI commands |

---

## Standard System Variables

These are read at runtime for binary resolution and are not vLLM Studio-specific:

- `PATH` — used to locate `python`, `vllm`, `llama-server`, and other binaries
- `HOME` / `USER` / `LOGNAME` — used for runtime environment construction
- `SNAP` — checked for Snap-packaged runtime detection

---

[← Back to docs index](./README.md)
