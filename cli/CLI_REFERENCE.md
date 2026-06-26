# Local Studio CLI — Complete Reference

> Comprehensive documentation of the Local Studio CLI — every command, its underlying controller API, response structures, error modes, and the interactive TUI.
> Source: [`cli/src/`](src/) and [`controller/src/`](../controller/src/)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [CLI Executable & Entry Points](#2-cli-executable--entry-points)
3. [Headless Commands](#3-headless-commands)
   - [help](#31-help)
   - [status](#32-status)
   - [gpus](#33-gpus)
   - [recipes](#34-recipes)
   - [config](#35-config)
   - [metrics](#36-metrics)
   - [launch \<recipe-id\>](#37-launch-recipe-id)
   - [evict](#38-evict)
4. [Interactive TUI Mode](#4-interactive-tui-mode)
   - [Key Bindings](#41-key-bindings)
   - [Tabs & Views](#42-tabs--views)
   - [Auto-Refresh Cycle](#43-auto-refresh-cycle)
5. [Controller API Reference (All Endpoints)](#5-controller-api-reference-all-endpoints)
   - [System Endpoints](#51-system-endpoints)
   - [Engine / Lifecycle Endpoints](#52-engine--lifecycle-endpoints)
   - [Model Endpoints](#53-model-endpoints)
   - [Studio Endpoints](#54-studio-endpoints)
   - [Proxy / Inference Endpoints](#55-proxy--inference-endpoints)
   - [Monitoring Endpoints](#56-monitoring-endpoints)
   - [Logs & Events Endpoints](#57-logs--events-endpoints)
   - [Runtime Job Endpoints](#58-runtime-job-endpoints)
   - [Audio Endpoints](#59-audio-endpoints)
6. [Error Handling & Exit Codes](#6-error-handling--exit-codes)
7. [Environment Variables](#7-environment-variables)
8. [Data Types & Response Shapes](#8-data-types--response-shapes)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────┐
│  Local Studio CLI  (Bun / TypeScript)        │
│  ┌───────────────────────────────────────┐  │
│  │  Headless Mode                        │  │
│  │  local-studio <command>  ──► JSON out  │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  Interactive TUI Mode                 │  │
│  │  local-studio  ──► live dashboard     │  │
│  └───────────────────────────────────────┘  │
└──────────────┬──────────────────────────────┘
               │ HTTP (fetch)
               ▼
┌─────────────────────────────────────────────┐
│  Local Studio Controller  (Bun / Hono)       │
│  Port: 8080 (default)                       │
│  ┌─────────┬──────────┬───────────────┐    │
│  │ System  │ Engines  │  Models       │    │
│  │ Routes  │ Routes   │  Routes       │    │
│  ├─────────┼──────────┼───────────────┤    │
│  │ Studio  │ Proxy    │ Runtime Jobs/ │    │
│  │ Routes  │ Routes   │ Audio Routes  │    │
│  └─────────┴──────────┴───────────────┘    │
│                                             │
│  Proxies inference requests to active       │
│  backend (vLLM / SGLang / llama.cpp)        │
└─────────────────────────────────────────────┘
```

- The CLI communicates with the controller over HTTP.
- Auth is via `X-API-Key` header (from `LOCAL_STUDIO_API_KEY` env var).
- Controller URL is configured via `LOCAL_STUDIO_URL` env var (default `http://localhost:8080`).
- Headless commands output JSON on stdout, errors on stderr, exit codes: 0 = success, 1 = failure.

---

## 2. CLI Executable & Entry Points

| Aspect | Detail |
|---|---|
| **Binary** | `cli/local-studio` (compiled via `bun build --compile`) |
| **Source** | `cli/src/main.ts` |
| **Runtime** | Bun ≥ 1.0 |
| **Modes** | Headless (args provided) or Interactive TUI (no args) |
| **Build** | `cd cli && bun run build` |

### Entry Point Logic (`main.ts`)

```typescript
// If CLI args exist → headless mode
if (process.argv.length > 2) {
  const { runHeadless } = await import("./headless");
  await runHeadless();
  process.exit(process.exitCode ?? 0);
}
// Otherwise → interactive TUI mode
```

---

## 3. Headless Commands

### 3.1 `help`

Shows usage information.

**CLI source:** `headless.ts` — `COMMANDS.help`

**Output:**

```
local-studio - Model lifecycle management CLI

Commands:
  status    Show current model status
  gpus      List GPUs with memory/utilization
  recipes   List available model recipes
  config    Show system configuration
  metrics   Show lifetime metrics
  launch    Launch recipe: local-studio launch <id>
  evict     Stop running model
  help      Show this help

Environment:
  LOCAL_STUDIO_URL  Controller URL (default: http://localhost:8080)
```

**Exit code:** 0

---

### 3.2 `status`

Shows the current inference engine status — whether a model is running, its process info, and any errors.

**CLI source:** `headless.ts` — `COMMANDS.status` → `api.fetchStatus()`

**API call:** `GET /status`

**Controller source:** `controller/src/modules/system/routes.ts`

**Underlying logic:**

1. Controller calls `context.processManager.findInferenceProcess(config.inference_port)` to look up the running inference process.
2. Returns process info (pid, backend, model_path, port) if found, or `null` if nothing running.
3. Also returns `launching` — the recipe ID currently being launched, if any.

**Response shape:**

```json
{
  "running": true,
  "process": {
    "pid": 2098445,
    "backend": "sglang",
    "model_path": "/workspace/model",
    "port": 8000,
    "served_model_name": "deepseek-v4-flash"
  },
  "inference_port": 8000,
  "launching": null
}
```

| Field | Type | Description |
|---|---|---|
| `running` | boolean | Whether an inference process is active |
| `process.pid` | number \| null | Process ID of the inference backend |
| `process.backend` | string \| null | Engine type: `vllm`, `sglang`, `llamacpp`, etc. |
| `process.model_path` | string \| null | Filesystem path to loaded model weights |
| `process.port` | number \| null | Port the inference server is listening on |
| `process.served_model_name` | string \| null | Public model name (used in `/v1/models`) |
| `inference_port` | number | Configured inference port |
| `launching` | string \| null | Recipe ID currently launching, if any |

**Error cases:**
- Network error: `CliApiError("Network error calling GET /status: ...")`
- HTTP error (non-2xx): `CliApiError("Request failed for GET /status: 401 Unauthorized")`

**Exit code:** 0 on success, 1 on error

---

### 3.3 `gpus`

Lists all GPUs with their memory, utilization, temperature, and power metrics.

**CLI source:** `headless.ts` — `COMMANDS.gpus` → `api.fetchGPUs()`

**API call:** `GET /gpus`

**Controller source:** `controller/src/modules/system/routes.ts`

**Underlying logic:**

1. Controller calls `getGpuInfo()` which uses `nvidia-smi` (or equivalent) to query GPU state.
2. Returns an array of GPU objects with both raw (`memory_used`) and human-friendly fields (`memory_used_mb`).

**Response shape:**

```json
// GET /gpus → { count: 5, gpus: [...] }
[
  {
    "index": 0,
    "name": "NVIDIA RTX PRO 6000 Blackwell Workstation Edition",
    "memory_used": 97330921472,
    "memory_total": 102641958912,
    "utilization": 99,
    "temperature": 63,
    "power_draw": 168.04
  }
]
```

| Field | Type | Description |
|---|---|---|
| `index` | number | GPU device index |
| `name` | string | GPU model name |
| `memory_used` | number | Used memory in bytes |
| `memory_total` | number | Total memory in bytes |
| `utilization` | number | GPU utilization % (0–100) |
| `temperature` | number | GPU temperature in °C |
| `power_draw` | number | Current power draw in watts |

**CLI data mapping** (`api.ts` → `fetchGPUs()`):
- The raw controller response is `{ count: number, gpus: GpuInfo[] }`.
- Each `GpuInfo` contains extensive fields (`memory_total_mb`, `memory_used_mb`, `power_limit`, etc.).
- The CLI extracts only 7 key fields for display.

**Exit code:** 0 on success, 1 on error

---

### 3.4 `recipes`

Lists all configured model recipes with their status (running/stopped/starting).

**CLI source:** `headless.ts` — `COMMANDS.recipes` → `api.fetchRecipes()`

**API call:** `GET /recipes`

**Controller source:** `controller/src/modules/engines/routes.ts`

**Underlying logic:**

1. Controller fetches all recipes from the `recipeStore` (persisted JSON store).
2. For each recipe, checks if the current running process matches it via `isRecipeRunning()`.
3. Enriches each recipe with a `status` field: `"running"`, `"stopped"`, or `"starting"`.
4. No authentication required for reads (per app.ts skip list).

**Response shape:**

```json
[
  {
    "id": "deepseek-v4-flash",
    "name": "DeepSeek-V4-Flash",
    "model_path": "/mnt/llm_models/DeepSeek-V4-Flash-FP8",
    "backend": "sglang",
    "tensor_parallel_size": 4,
    "max_model_len": 393216,
    "status": "running"
    // ... full recipe fields
  }
]
```

**Recipe fields exposed by CLI** (defined in `types.ts` `Recipe` type):

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique recipe identifier |
| `name` | string | Human-readable recipe name |
| `model_path` | string | Path to model weights |
| `backend` | `sglang` \| `vllm` \| `llamacpp` | Inference engine |
| `tensor_parallel_size` | number | GPU tensor parallelism count |
| `max_model_len` | number | Maximum context length |
| `status` | `"running"` \| `"stopped"` \| `"starting"` | Current recipe status |

**Exit code:** 0 on success, 1 on error

---

### 3.5 `config`

Shows the controller's system configuration — ports, directories, and runtime info.

**CLI source:** `headless.ts` — `COMMANDS.config` → `api.fetchConfig()`

**API call:** `GET /config`

**Controller source:** `controller/src/modules/system/routes.ts`

**Underlying logic:**

1. Controller builds a full system config payload including config values, service health checks, and runtime info.
2. Service health checks: TCP connect to controller port, inference port, Redis (6379), Prometheus (9090), frontend (3000).
3. Runtime info via `getSystemRuntimeInfo()` — Python version, GPU monitoring tool detection, etc.
4. The CLI extracts only 4 config fields from the nested response.

**Response shape (full):**

```json
{
  "config": {
    "host": "0.0.0.0",
    "port": 8080,
    "inference_port": 8000,
    "api_key_configured": true,
    "models_dir": "/models",
    "data_dir": "/home/ser/projects/vllm/lmvllm/data",
    "db_path": "/home/ser/projects/vllm/lmvllm/data/local-studio.db",
    "sglang_python": "/usr/bin/python3",
    "tabby_api_dir": null,
    "llama_bin": null
  },
  "services": [
    { "name": "Controller", "port": 8080, "status": "running", ... },
    { "name": "vLLM/SGLang", "port": 8000, "status": "running", ... },
    { "name": "Frontend", "port": 3000, "status": "stopped", ... }
  ],
  "environment": {
    "controller_url": "http://host:8080",
    "inference_url": "http://host:8000",
    "frontend_url": "http://host:3000"
  },
  "runtime": { ... }
}
```

**CLI-extracted fields:**

| Field | Type | Description |
|---|---|---|
| `port` | number | Controller HTTP port |
| `inference_port` | number | Inference backend port |
| `models_dir` | string | Directory for model weight storage |
| `data_dir` | string | Directory for data (configs, logs, DB) |

**Exit code:** 0 on success, 1 on error

---

### 3.6 `metrics`

Shows lifetime usage metrics — total tokens served, total requests, and energy consumption.

**CLI source:** `headless.ts` — `COMMANDS.metrics` → `api.fetchLifetimeMetrics()`

**API call:** `GET /lifetime-metrics`

**Controller source:** `controller/src/modules/system/metrics-routes.ts`

**Underlying logic:**

1. Controller reads from `lifetimeMetricsStore` — a persistent store of cumulative metrics.
2. Computes derived fields: `uptime_hours`, `energy_kwh`, `kwh_per_million_tokens`, `current_power_watts`.
3. Energy is calculated from GPU power draw sampled over time.
4. Token/request counts are accumulated from inference proxy requests.
5. Uptime tracked via `first_started_at` timestamp.

**Response shape (full):**

```json
{
  "tokens_total": 205800442,
  "requests_total": 5021,
  "energy_wh": 230264.954,
  "energy_kwh": 230.26,
  "uptime_seconds": 123456,
  "uptime_hours": 34.29,
  "first_started_at": 1714500000,
  "kwh_per_million_tokens": 1.12,
  "current_power_watts": 668.79
}
```

**CLI-extracted fields:**

| Field | Type | Description |
|---|---|---|
| `total_tokens` | number | Total tokens generated across all sessions |
| `total_requests` | number | Total inference requests proxied |
| `total_energy_kwh` | number | Total energy consumption in kWh |

**Exit code:** 0 on success, 1 on error

---

### 3.7 `launch <recipe-id>`

Launches a model recipe — starts the inference backend (vLLM, SGLang, llama.cpp) with the recipe's configuration.

**CLI source:** `headless.ts` — `COMMANDS.launch` → `api.launchRecipe(id)`

**API call:** `POST /launch/:recipeId`

**Controller source:** `controller/src/modules/engines/routes.ts`

**Underlying logic:**

1. Controller looks up recipe by `recipeId` in `recipeStore`.
2. Creates an `AbortController` for cancellable launch.
3. Calls `engineService.setActiveRecipe(recipe)` which:
   - Kills any currently running inference process.
   - Resolves the recipe's `python_path` or uses default.
   - Spawns the inference backend with recipe's CLI args, `env_vars`, and model path.
   - Captures stdout/stderr to a log file.
   - Waits for the process to start and be ready.
4. Returns `{ success: true, message: "Launch started" }` when the process begins.
5. Actual readiness is checked via `GET /wait-ready`.

**Request:** `POST /launch/:recipeId` (no body)

**Response:**

```json
{ "success": true, "message": "Launch started" }
```

**Error cases:**

| Scenario | HTTP Status | CLI Error |
|---|---|---|
| Recipe not found | 404 | `Request failed for POST /launch/...: Not Found` |
| Launch cancelled | 400 | `Request failed for POST /launch/...: cancelled` |
| Backend spawn failed | 503 | `Request failed for POST /launch/...: (error message)` |
| Network error | — | `Network error calling POST /launch/...` |

**Exit code:** 0 on success, 1 on error

---

### 3.8 `evict`

Stops the currently running inference process (unloads the model).

**CLI source:** `headless.ts` — `COMMANDS.evict` → `api.evictModel()`

**API call:** `POST /evict`

**Controller source:** `controller/src/modules/engines/routes.ts`

**Underlying logic:**

1. Controller calls `engineService.setActiveRecipe(null)`.
2. Sends SIGTERM to the inference process.
3. Waits briefly for clean shutdown, then SIGKILL if needed.
4. Cleans up process tracking state.
5. Returns `{ success: true, evicted_pid: null }` or `{ success: true, evicted_pid: 12345 }`.

**Request:** `POST /evict` (no body)

**Response:**

```json
{ "success": true, "evicted_pid": null }
```

**Exit code:** 0 on success, 1 on error

---

## 4. Interactive TUI Mode

Run `local-studio` (no arguments) for a live-updating curses-like dashboard.

**Source:** `main.ts` (refresh loop + key handler), `render.ts` (layout compositor), `views/*.ts` (tab content)

### 4.1 Key Bindings

| Key | Action | Source |
|---|---|---|
| `1` | Switch to **Dashboard** tab | `main.ts` — `VIEWS[0]` |
| `2` | Switch to **Recipes** tab | `main.ts` — `VIEWS[1]` |
| `3` | Switch to **Status** tab | `main.ts` — `VIEWS[2]` |
| `4` | Switch to **Config** tab | `main.ts` — `VIEWS[3]` |
| `↑` | Move recipe selection up | `main.ts` — `state.selectedIndex--` |
| `↓` | Move recipe selection down | `main.ts` — `state.selectedIndex++` |
| `Enter` | Launch selected recipe (in Recipes tab) | `main.ts` — calls `api.launchRecipe(id)` |
| `e` | Evict running model | `main.ts` — calls `api.evictModel()` |
| `r` | Force immediate refresh | `main.ts` — calls `refresh()` |
| `q` / `Ctrl-C` | Quit and restore cursor | `main.ts` — calls `cleanup()` |

### 4.2 Tabs & Views

#### Dashboard (`views/dashboard.ts`)
- Displays live GPU stats: memory bars, utilization %, temperature, power.
- Shows current model status (running / stopped / launching).
- Shows lifetime metrics (tokens, requests, kWh).

#### Recipes (`views/recipes.ts`)
- Lists all recipes with their status indicator (▶ running, ⬜ stopped).
- Highlights the currently selected recipe.
- Shows key fields: name, backend, TP size, max context length.

#### Status (`views/status.ts`)
- Shows detailed inference process info: PID, backend, port, model path.
- Shows launch state (if a recipe is being launched).

#### Config (`views/config.ts`)
- Shows controller configuration: ports, directories, API key presence.

### 4.3 Auto-Refresh Cycle

- **Interval:** Every 2 seconds (`setInterval(refresh, 2000)`)
- **Timer is unref'd** so it doesn't prevent process exit.
- **Refresh fires 5 parallel requests:**
  1. `api.fetchGPUs()` — `GET /gpus`
  2. `api.fetchRecipes()` — `GET /recipes`
  3. `api.fetchStatus()` — `GET /status`
  4. `api.fetchConfig()` — `GET /config`
  5. `api.fetchLifetimeMetrics()` — `GET /lifetime-metrics`
- If any request fails, `state.error` is set (shown in red at bottom of screen).
- `selectedIndex` is clamped to valid recipe range after each refresh.
- Cursor is hidden during TUI mode (`hideCursor()`), restored on exit (`showCursor()`).

### Layout

```
┌─ Local Studio CLI v0.1.0  [1]Dashboard [2]Recipes [3]Status [4]Config ─┐
│ ─────────────────────────────────────────────────────────────────────── │
│                         (tab content)                                   │
│                                                                         │
│ Error: ...  (if any, in red)                                            │
│ [↑↓]Navigate [Enter]Select [e]Evict [r]Refresh [q]Quit                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Controller API Reference (All Endpoints)

### 5.1 System Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/status` | `system/routes.ts` | Current inference process status | No |
| `GET` | `/gpus` | `system/routes.ts` | GPU inventory & metrics | No |
| `GET` | `/config` | `system/routes.ts` | Full controller configuration + service health + runtime info | No |
| `GET` | `/compat` | `system/routes.ts` | Compatibility report — GPU monitoring, inference port, runtime health | No |
| `POST` | `/vram-calculator` | `system/routes.ts` | Estimate VRAM requirements for a model + context length | Yes |

### 5.2 Engine / Lifecycle Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/recipes` | `engines/routes.ts` | List all recipes with status | No |
| `GET` | `/recipes/:id` | `engines/routes.ts` | Get single recipe by ID | No |
| `POST` | `/recipes` | `engines/routes.ts` | Create a new recipe | Yes |
| `PUT` | `/recipes/:id` | `engines/routes.ts` | Update an existing recipe | Yes |
| `DELETE` | `/recipes/:id` | `engines/routes.ts` | Delete a recipe | Yes |
| `POST` | `/launch/:recipeId` | `engines/routes.ts` | Launch a recipe (start inference) | Yes |
| `POST` | `/launch/:recipeId/cancel` | `engines/routes.ts` | Cancel a pending launch | Yes |
| `POST` | `/evict` | `engines/routes.ts` | Stop running inference | Yes |
| `GET` | `/wait-ready` | `engines/routes.ts` | Poll until inference backend is healthy (query: `?timeout=300`) | No |

### 5.3 Model Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/v1/models` | `models/routes.ts` | OpenAI-compatible model list (enriched with recipe info) | No (proxy) |
| `GET` | `/v1/models/:id` | `models/routes.ts` | Single model detail | No (proxy) |
| `GET` | `/v1/studio/models` | `models/routes.ts` | Detailed model browser — scanned weights, recipe linkage | No |
| `GET` | `/v1/huggingface/models` | `models/routes.ts` | Browse HuggingFace models (proxied) | No |

### 5.4 Studio Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/studio/settings` | `studio/routes.ts` | Get persisted settings (models_dir) | No |
| `POST` | `/studio/settings` | `studio/routes.ts` | Update settings | Yes |
| `GET` | `/studio/diagnostics` | `studio/routes.ts` | Full system diagnostics (CPU, GPU, RAM, disks, runtime) | Yes |
| `GET` | `/studio/storage` | `studio/routes.ts` | Storage usage — model count, bytes, disk space | No |
| `GET` | `/studio/recommendations` | `studio/routes.ts` | VRAM-based model recommendations | No |
| `POST` | `/studio/models/delete` | `studio/routes.ts` | Delete model files from disk | Yes |
| `POST` | `/studio/models/move` | `studio/routes.ts` | Move model files within models_dir | Yes |
| `GET` | `/studio/providers` | `studio/provider-routes.ts` | List configured API providers | Yes |
| `POST` | `/studio/providers` | `studio/provider-routes.ts` | Create a new API provider | Yes |
| `PUT` | `/studio/providers/:id` | `studio/provider-routes.ts` | Update an API provider | Yes |
| `DELETE` | `/studio/providers/:id` | `studio/provider-routes.ts` | Delete an API provider | Yes |
| `GET` | `/studio/provider-models` | `studio/provider-routes.ts` | Fetch models from all enabled providers | Yes |
| `GET` | `/studio/downloads` | `engines/routes.ts` | List active/finished model downloads | Yes |
| `GET` | `/studio/downloads/:id` | `engines/routes.ts` | Single download status | Yes |
| `POST` | `/studio/downloads` | `engines/routes.ts` | Start a model download from HuggingFace | Yes |
| `POST` | `/studio/downloads/:id/pause` | `engines/routes.ts` | Pause an active download | Yes |
| `POST` | `/studio/downloads/:id/resume` | `engines/routes.ts` | Resume a paused download | Yes |
| `POST` | `/studio/downloads/:id/cancel` | `engines/routes.ts` | Cancel a download | Yes |

### 5.5 Proxy / Inference Endpoints

Proxy endpoints forward to the active inference backend (`/health` is answered by the controller itself). Auth is controller-level.

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `POST` | `/v1/chat/completions` | `proxy/openai-routes.ts` | Chat completions (with tool call streaming, content normalization) | Yes |
| `GET` | `/health` | `http/app.ts` | Controller liveness check (`{ "status": "ok" }`) | No (skip list) |
| `POST` | `/v1/tokenize` | `proxy/tokenization-routes.ts` | Tokenize text | Yes |
| `POST` | `/v1/detokenize` | `proxy/tokenization-routes.ts` | Detokenize IDs | Yes |
| `POST` | `/v1/count-tokens` | `proxy/tokenization-routes.ts` | Count tokens for text | Yes |
| `POST` | `/v1/tokenize-chat-completions` | `proxy/tokenization-routes.ts` | Tokenize a chat-completions payload | Yes |
| `POST` | `/api/title` | `proxy/tokenization-routes.ts` | Generate a short title via the active model | Yes |

### 5.6 Monitoring Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/metrics` | `metrics-routes.ts` | Prometheus-formatted metrics | No (skip list) |
| `GET` | `/v1/metrics/vllm` | `metrics-routes.ts` | Latest vLLM metrics snapshot | No |
| `GET` | `/peak-metrics` | `metrics-routes.ts` | Per-model peak throughput metrics | No |
| `GET` | `/lifetime-metrics` | `metrics-routes.ts` | Cumulative lifetime stats (tokens, requests, energy) | No |
| `POST` | `/benchmark` | `metrics-routes.ts` | Run a benchmark against the active model | Yes |

### 5.7 Logs & Events Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/logs` | `logs-routes.ts` | List log sessions | No |
| `GET` | `/logs/:sessionId` | `logs-routes.ts` | Get log content for a session (query: `?limit=2000`) | No |
| `DELETE` | `/logs/:sessionId` | `logs-routes.ts` | Delete a log session | Yes |
| `GET` | `/logs/:sessionId/stream` | `logs-routes.ts` | SSE stream of log lines (query: `?tail=2000`) | No |
| `GET` | `/events` | `logs-routes.ts` | SSE stream of all controller events | No (skip list) |
| `GET` | `/events/stats` | `logs-routes.ts` | Event manager statistics | No |

### 5.8 Runtime Job Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `POST` | `/runtime/jobs` | `engines/routes.ts` | Create a runtime job for an engine backend (install/update) | Yes |
| `GET` | `/runtime/jobs` | `engines/routes.ts` | List all runtime jobs | No |
| `GET` | `/runtime/jobs/:jobId` | `engines/routes.ts` | Get runtime job status | No |
| `POST` | `/runtime/jobs/:jobId/cancel` | `engines/routes.ts` | Cancel a running runtime job | Yes |

### 5.9 Audio Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `POST` | `/v1/audio/transcriptions` | `audio/routes.ts` | Speech-to-text transcription | Yes |
| `POST` | `/v1/audio/speech` | `audio/routes.ts` | Text-to-speech generation | Yes |

### 5.10 Runtime Endpoints

| Method | Path | Source | Description | Auth |
|---|---|---|---|---|
| `GET` | `/runtime/vllm` | `engines/routes.ts` | vLLM runtime info (installed, version, path) | No |
| `GET` | `/runtime/vllm/config` | `engines/routes.ts` | vLLM configuration help | No |
| `GET` | `/runtime/sglang` | `engines/routes.ts` | SGLang runtime info | No |
| `GET` | `/runtime/llamacpp` | `engines/routes.ts` | llama.cpp runtime info | No |
| `GET` | `/runtime/llamacpp/config` | `engines/routes.ts` | llama.cpp configuration help | No |
| `GET` | `/runtime/mlx` | `engines/routes.ts` | MLX runtime info | No |
| `GET` | `/runtime/targets` | `engines/routes.ts` | List runtime targets with current process info | No |
| `GET` | `/runtime/targets/:targetId` | `engines/routes.ts` | Single runtime target detail | No |
| `POST` | `/runtime/targets/:targetId/select` | `engines/routes.ts` | Select a runtime target | Yes |
| `GET` | `/runtime/targets/:targetId/health` | `engines/routes.ts` | Runtime target health | No |
| `GET` | `/runtime/cuda` | `engines/routes.ts` | CUDA toolkit info (nvcc version, devices) | No |
| `GET` | `/runtime/rocm` | `engines/routes.ts` | ROCm toolkit info | No |
| `POST` | `/runtime/vllm/upgrade` | `engines/routes.ts` | Upgrade vLLM installation | Yes |
| `POST` | `/runtime/sglang/upgrade` | `engines/routes.ts` | Upgrade SGLang installation | Yes |
| `POST` | `/runtime/llamacpp/upgrade` | `engines/routes.ts` | Upgrade llama.cpp installation | Yes |
| `POST` | `/runtime/cuda/upgrade` | `engines/routes.ts` | Upgrade CUDA toolkit | Yes |
| `POST` | `/runtime/rocm/upgrade` | `engines/routes.ts` | Upgrade ROCm toolkit | Yes |

---

## 6. Error Handling & Exit Codes

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success — command completed normally |
| `1` | Failure — command error, HTTP error, or network error |

### CLI Error Types (`api.ts`)

**`CliApiError`** — Custom error class for API failures:

| Property | Type | Description |
|---|---|---|
| `message` | string | Human-readable error description |
| `status` | number \| null | HTTP status code (null = network error) |
| `method` | string | HTTP method that failed |
| `path` | string | API path that failed |

**Error scenarios:**

| Scenario | Detected In | Error Message |
|---|---|---|
| Controller unreachable | `requestJson()` catch | `Network error calling GET /status: fetch failed` |
| HTTP 404 | `requestJson()` response.ok | `Request failed for GET /status: Not Found` |
| HTTP 401/403 | `requestJson()` response.ok | `Request failed for GET /status: 401 Unauthorized` |
| Invalid JSON response | `fetchGPUs()` validation | `Invalid response for GET /gpus` |
| Unknown headless command | `runHeadless()` | `Unknown command: foo` |
| Missing recipe ID (launch) | `COMMANDS.launch` | `Usage: local-studio launch <recipe-id>` |

### TUI Error Handling

- Errors are captured per-request in the `Promise.allSettled` refresh cycle.
- Only the **first** error across all 5 parallel requests is shown (in red at the bottom of the screen).
- Other requests continue to update their data.
- Network interruptions cause a red error banner; data resumes when connectivity returns.

### Controller Error Response Format

```json
{ "detail": "Not Found" }
```

HTTP status codes used: `400` (bad request), `401` (unauthorized), `404` (not found), `499` (client disconnected), `500` (internal error), `503` (service unavailable).

---

## 7. Environment Variables

| Variable | Default | Description | Used In |
|---|---|---|---|
| `LOCAL_STUDIO_URL` | `http://localhost:8080` | Controller base URL | `api.ts` — `resolveBaseUrl()` |
| `LOCAL_STUDIO_API_KEY` | — | API key sent as `X-API-Key` header | `api.ts` — `resolveApiKey()` |

### How resolution works:

```typescript
// Base URL
function resolveBaseUrl(): string {
  const configured = process.env.LOCAL_STUDIO_URL?.trim() || DEFAULT_BASE_URL;
  return configured.endsWith("/") ? configured.slice(0, -1) : configured;
}

// API Key
function resolveApiKey(): string | undefined {
  return process.env.LOCAL_STUDIO_API_KEY?.trim() || undefined;
}
```

- The API key is sent on **every** request via the `X-API-Key` header.
- If no key is configured, the header is omitted entirely.

---

## 8. Data Types & Response Shapes

### `GPU` (CLI type)

```typescript
interface GPU {
  index: number;        // GPU device index
  name: string;         // GPU model name
  memory_used: number;  // Used memory in bytes
  memory_total: number; // Total memory in bytes
  utilization: number;  // GPU utilization 0-100
  temperature: number;  // Temperature in °C
  power_draw: number;   // Power draw in watts
}
```

### `Recipe` (CLI type)

```typescript
interface Recipe {
  id: string;                    // Unique identifier
  name: string;                  // Human-readable name
  model_path: string;            // Path to model weights
  backend: "sglang" | "vllm" | "llamacpp";  // Inference engine
  tensor_parallel_size: number;  // GPU count for TP
  max_model_len: number;         // Maximum context length
}
```

**Full recipe (controller-side)** includes an additional `status` field at response time:
```typescript
status: "running" | "stopped" | "starting"
```

### `Status` (CLI type)

```typescript
interface Status {
  running: boolean;      // Is a model running?
  launching: boolean;    // Is a launch in progress?
  model?: string;        // Served model name
  backend?: string;      // Inference engine name
  pid?: number;          // Process ID
  port?: number;         // Inference server port
  error?: string;        // Error message if any
}
```

### `Config` (CLI type)

```typescript
interface Config {
  port: number;           // Controller HTTP port
  inference_port: number; // Inference backend port
  models_dir: string;     // Model storage directory
  data_dir: string;       // Data/config directory
}
```

### `LifetimeMetrics` (CLI type)

```typescript
interface LifetimeMetrics {
  total_tokens: number;     // Total tokens generated
  total_requests: number;   // Total inference requests
  total_energy_kwh: number; // Total energy in kWh
}
```

### `AppState` (CLI TUI state)

```typescript
interface AppState {
  view: "dashboard" | "recipes" | "status" | "config";
  selectedIndex: number;            // Selected recipe index
  gpus: GPU[];                      // GPU list
  recipes: Recipe[];                // Recipe list
  status: Status;                   // Current status
  config: Config | null;            // Controller config
  lifetime: LifetimeMetrics;        // Lifetime metrics
  error: string | null;             // Current error message
}
```

---

*Document generated from Local Studio source code at `cli/src/` and `controller/src/` (researched 2026-05).*
*For the most up-to-date information, consult the source files directly:*
- `cli/src/api.ts` — API client layer
- `cli/src/headless.ts` — Headless command handlers
- `cli/src/main.ts` — Interactive TUI entry point
- `controller/src/http/app.ts` — Route registration
- `controller/src/modules/system/routes.ts` — System endpoints
- `controller/src/modules/engines/routes.ts` — Engine/lifecycle endpoints