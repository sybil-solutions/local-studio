# Controller

`controller/` is the Bun/Hono backend for Local Studio. It exposes the HTTP API that the frontend and desktop app use to manage models, proxy inference requests, read runtime status, and inspect usage/system data.

## What It Does

- Launches and evicts model-serving runtimes through recipes.
- Discovers and selects runtime targets for vLLM, SGLang, llama.cpp, and MLX.
- Proxies OpenAI-compatible model, chat, audio, and tokenization requests.
- Streams controller/runtime events over SSE.
- Tracks GPU/system status, logs, downloads, usage, controller settings, and persisted runtime state.
- Provides Swagger/OpenAPI documentation for the controller API.

## What Is In Use

- Bun runtime.
- Hono HTTP framework.
- Effect Schema configuration and boundary validation.
- SQLite-backed local stores.
- Swagger UI from `@hono/swagger-ui`.
- Runtime probes for Python, Docker, `llama-server`, and MLX Python environments.

## Architecture

```mermaid
flowchart TB
    Main["src/main.ts"] --> App["src/http/app.ts"]
    App --> Security["security middleware"]
    App --> Engines["modules/engines"]
    App --> Models["modules/models"]
    App --> Proxy["modules/proxy"]
    App --> Studio["modules/studio"]
    App --> System["modules/system"]
    App --> Audio["modules/audio"]

    Engines --> Runtime["runtime process coordination"]
    Engines --> Targets["runtime target discovery"]
    Models --> Recipes["recipe and model discovery"]
    Proxy --> Inference["OpenAI-compatible inference client"]
    System --> Metrics["metrics, logs, usage, events"]
    Audio --> Speech["STT/TTS integrations"]
    System --> Stores["src/stores SQLite helpers"]
```

## Prerequisites

- Bun 1.x.
- Optional NVIDIA/CUDA stack for CUDA model serving.
- Optional Apple Silicon plus `mlx-lm` for MLX model serving.
- Optional `llama-server` binary for llama.cpp/GGUF model serving.
- Optional Docker/Compose infrastructure depending on deployment mode.

## Common Commands

```bash
bun install
bun src/main.ts
bun --watch src/main.ts
bun run typecheck
bun run lint
bun run check
```

## API Entry Points

- `GET /health`
- `GET /status`
- `GET /gpus`
- `GET /api/spec`
- `GET /api/docs`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /v1/studio/models`
- `GET /studio/downloads`
- `GET /runtime/targets`
- `GET /runtime/vllm`
- `GET /runtime/sglang`
- `GET /runtime/llamacpp`
- `GET /runtime/mlx`

Route registration starts in `src/http/app.ts`.

## Configuration

Configuration parsing lives in `src/config/env.ts`. Runtime state is stored under the configured data directory; when running from `controller/`, the default data path resolves to the repo-level `data/` directory.

Use `.env.local` for machine-specific secrets and deployment values.

Runtime-related environment variables include:

- `LOCAL_STUDIO_SGLANG_PYTHON`: preferred SGLang Python executable.
- `LOCAL_STUDIO_LLAMA_BIN`: preferred llama.cpp `llama-server` executable.
- `LOCAL_STUDIO_MLX_PYTHON`: preferred Python executable containing `mlx-lm`.
- `LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM`: skip system Python/binary discovery when set to `1`.
- `LOCAL_STUDIO_RUNTIME_SKIP_DOCKER`: skip Docker image/container discovery when set to `1`.

## Where To Look

- `src/main.ts`: server boot.
- `src/app-context.ts`: shared controller dependencies.
- `src/http/app.ts`: HTTP app and route mounting.
- `src/modules/engines/`: lifecycle, recipes, downloads, runtime process management, and runtime target discovery.
- `src/modules/proxy/`: OpenAI-compatible proxy and inference accounting.
- `src/modules/system/`: metrics, logs, usage, events, and platform state.
- `src/stores/`: SQLite helpers and persisted stores.
- `contracts/`: the `@local-studio/contracts` package — the controller's HTTP API contract, consumed by the frontend via a `file:` dependency.
