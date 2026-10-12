# Local Studio — Controller Report

A deep review of the `controller/` package (the Bun/Hono backend) for Local Studio. It covers what every piece does, how the pieces fit together, a feature registry, a route/API registry, a file-based line-of-code inventory, dependencies, and responsibilities.

---

## 1. What the controller is

`controller/` is the local-first HTTP API server for Local Studio. The Next.js/Electron frontend (`frontend/`) and the desktop app talk to it; it is the single backend that owns:

- **Model lifecycle** — launching, serving, evicting, and supervising inference runtimes (vLLM, SGLang, llama.cpp, MLX).
- **Inference proxying** — an OpenAI-compatible proxy that routes `/v1/chat/completions` and tokenization requests to the local backend (or to a configured remote provider).
- **System observability** — GPU/host telemetry, metrics, logs, usage accounting, and real-time events over SSE.
- **Studio tooling** — recipes, downloads/browser, providers, rigs, model index, settings, diagnostics, and a VRAM calculator.
- **Persistence** — SQLite-backed stores for recipes, downloads, rigs, usage, metrics peaks, settings, and controller request telemetry.

It is a Bun + Hono server written in TypeScript, with the **Effect** library driving all async, error-handling, lifecycle, and streaming code, and **Effect Schema** validating every external boundary (config, request bodies, and persisted JSON).

---

## 2. How everything fits together

### 2.1 Process lifecycle (bootstrap)

```
src/main.ts
   │  createControllerRuntime() → ManagedRuntime over AppContextLive
   │
   ├── AppContextService (src/app-context.ts)  — builds Config, Logger, EventManager, all stores,
   │     DownloadManager, Compute, ComputeBridge; acquires/releases resources (Effect scoped)
   │
   ├── startMetricsCollector()      — background fiber: 5s GPU scrape, 30s runtime summary
   ├── startComputeSupervisor()     — background fiber: 2s loop that reaps dead instances
   └── serve()                      — creates Bun.serve({ fetch: app.fetch })
        └── createApp (src/http/app.ts) — Hono app + middleware stack + route registration
```

- `main.ts` (113 LOC) wires the runtime, forks the metrics collector and compute supervisor as scoped fibers, starts the HTTP server, prints a boot summary (host/port, dirs, auth mode, detected GPU tool), and handles `SIGINT`/`SIGTERM` with graceful fiber interruption.
- `src/app-context.ts` (213 LOC) is the composition root. It defines the `AppContext` type (all services/stores in one object) and `makeAppContext`, which initializes everything in dependency order and wires effect `acquireRelease` so every store/manager is shut down cleanly on exit. `AppContextService` is the Effect service that handlers resolve.

### 2.2 HTTP layer and middleware

Every route is an **Effect handler** run through the Effect `ManagedRuntime`. The middleware chain (in `app.ts`, applied in order) is:

1. `controllerRuntimeMiddleware` — injects the runtime into Hono context (needed by `effectHandler`).
2. `createKeylessRequestGuardMiddleware` — when no API key is configured, 403s any request whose `Host` is not in `allowed_hosts` or whose `Origin` (if present) is not in `cors_origins`; the DNS-rebinding defense for keyless local binds.
3. `cors` — allowlisted origins (from `LOCAL_STUDIO_CORS_ORIGINS`, with sane localhost defaults).
4. request logger middleware (debug line per non-telemetry-skipped path).
5. `createControllerRequestObservabilityMiddleware` — records every request into `controllerRequestStore`.
6. `createMutatingRateLimitMiddleware` — defaults 120/min per client for POST/PUT/PATCH/DELETE.
7. `createReadRateLimitMiddleware` — defaults 1200/min per client for GET (exempts /health, /status, /metrics, /events, /api/docs, /api/spec, SSE streams).
8. `createAuthMiddleware` — optional bearer / `X-API-Key` auth when `LOCAL_STUDIO_API_KEY` is set; `WWW-Authenticate` on 401. `/health` is public.

Key helpers in `src/http/`:

| File | LOC | Responsibility |
|---|---|---|
| `app.ts` | 156 | Assembles Hono app, middleware stack, wires all module route registrars, error handling (maps `HttpStatus`, custom 499 for client disconnects), mounts `/api/spec` (OpenAPI) and `/api/docs` (Swagger UI). |
| `effect-handler.ts` | (in app.ts group) | `effectHandler`/`effectMiddleware` — run Effect programs and translate failures into thrown Errors; `ControllerEnvironment` type. |
| `effect-handler.ts` | | Bridges Hono handlers ↔ Effect runtime (`runtime.runPromiseExit`). |
| `route-registrar.ts` | | `defineRoutes`, `mergeRoutes` (intersection type composition), `documentRoute` (OpenAPI), `ControllerRouteApp`. |
| `security-middleware.ts` | 165 | Auth + dual sliding-window rate limiters (mutating + read), in-memory store with cap/eviction. |
| `observability-middleware.ts` | | Per-request observability into `controllerRequestStore`. |
| `sse.ts` | | SSE helpers: Effect `Stream` → `ReadableStream`, heartbeat (+ `: keepalive`), abort handling, headers. |
| `bounded-body.ts` | | Request body size cap. |
| `local-fetch.ts` | | Internal HTTP fetch to the inference runtime on the loopback; `buildInferenceUrl`. |

### 2.3 The two engine subsystems (important architectural point)

The controller has **two parallel engine stacks**, and the `ComputeBridge` reconciles them:

1. **`modules/engines/` — the "legacy"/surface stack** (35 files, 4,498 LOC). Owns *installation*, *runtime-target discovery*, *downloads*, the *recipe CRUD HTTP API*, and the *legacy lifecycle routes* (`/launch/:recipeId`, `/evict`, `/wait-ready`). It works against **recipes** (persisted config for a model) and manages how engines are installed (managed venvs, binaries, docker) and probed.

2. **`modules/compute/` — the new pure engine stack** (26 files, 2,989 LOC). A self-contained, golden-testable engine layer built around pure `ComputeEngineSpec`s (vLLM, SGLang, llama.cpp, MLX, and a not-yet-launchable exllamav3). Engines are pure: `plan()` is a total function of a `LaunchRequest`. A **launcher** (process or docker) decides *how* to run the plan. Instances are modeled as persisted records whose claimed `devices` *are* the GPU lease (no separate registry to drift). A 2s supervisor is the only reaper.

3. **`ComputeBridge` (`modules/compute/bridge.ts`)** — the translation layer. It lets the legacy surfaces ("what is serving on the inference port", `launch`, `evict`, `wait-ready`) be answered from the new compute instance records, while preserving the **one-active-model** behavior: the active model gets the fixed instance name `"llm"` and serves on the legacy `inference_port`, so the proxy, metrics, and status surfaces are unchanged. It serializes recipe `extra_args` → argv, resolves binaries per backend, and folds in GPU-selector resolution.

This split is intentional: the `compute` module is the destination architecture (pure, lease-based, testable); `engines` is the incumbent surface for installs/discovery that the compute layer is meant to eventually absorb.

### 2.4 Data flow for a launch

```
POST /launch/:recipeId  (lifecycle-routes.ts)
  → recipeStore.get()
  → launchFailureBudget guard (429 if crash-looping)
  → bridge.launchRecipe(recipe)            (compute/bridge.ts)
      → resolve GPU UUIDs from recipe selectors
      → recipeToLaunchInput()               (recipe → ComputeLaunchInput)
      → compute.service.launch(input)      (compute/lifecycle.ts)
          → host profile, engine spec supports/runtime checks
          → instance store reserve()        (claims devices = lease)
          → planLaunch() / commandOverride (compute/engines/registry.ts)
          → launcher.start()                (process.ts | docker.ts)
          → waitReady() health-poll loop
  → launchFailureBudget.reset() on success
```

### 2.5 Data flow for chat inference

```
POST /v1/chat/completions   (proxy/openai-routes.ts)
  → parse body, extract session id, normalize content/tools, force stream usage
  → findRecipeByModel() — map requested model → a managed recipe
  → provider routing (services/provider-routing.ts): "providerId/model" syntax
      → if remote provider: rewrite body.model and forward to provider baseUrl
      → else: buildInferenceUrl() → local inference runtime on inference_port
  → gateOnRunningModel() — reject with 503 model_not_running if recipe isn't the active process
  → non-streaming: forward, decode, record usage, attach session_usage, normalize reasoning/tool calls
  → streaming: chat-completions-stream.ts + tool-call-stream.ts (SSE passthrough with
    usage accounting, tool-call normalization, reasoning parsing)
```

---

## 3. Dependency inventory

### 3.1 Runtime dependencies (`controller/package.json`)

| Package | Version | Role |
|---|---|---|
| `bun` runtime | ≥1.3.14 (engine) | Runs the server; `bun:sqlite` DB driver; `Bun.serve`. |
| `effect` | 4.0.0-beta.90 | Async runtime, `Effect`/`Layer`/`Stream`/`Schedule`, DI, structured errors. |
| (bundled with effect) Effect Schema | — | Boundary validation (request bodies, config, persisted JSON). |
| `hono` | 4.12.30 | HTTP framework, routing, middleware, CORS. |
| `hono-openapi` | 1.3.1 | OpenAPI route documentation. |
| `@hono/swagger-ui` | 0.5.3 | Swagger UI at `/api/docs`. |
| `@hono/standard-validator` | 0.2.3 | Validation integration with `standard-schema`. |
| `@standard-community/standard-json` | 0.3.5 | JSON schema tooling. |
| `@standard-community/standard-openapi` | 0.2.9 | OpenAPI ↔ standard schema. |
| `openapi-types` | 12.1.3 | OpenAPI typings. |
| `@earendil-works/pi-ai` | 0.83.0 | `parseJsonWithRepair` used by proxy tool-call parser. |
| `dotenv` | 16.6.1 | Load `.env`. |
| `semver` | 7.8.5 | Version comparison in runtime upgrade logic. |

### 3.2 Internal / workspace dependencies

- **`@local-studio/contracts`** — the shared contract package (`controller/contracts/`, 9 files / 1,360 LOC) is imported as `@local-studio/contracts/*` by the controller. It defines engine args, recipes, rigs, system/runtime types, model capabilities, usage, observability, and controller event schemas. This is the single source of truth shared with `frontend/`.
- **`services/agent-runtime`** — *separate* Bun service (not part of controller); the controller is not its active owner (agent sessions live there).
- **Bun's builtin `bun:sqlite`** — backing store for every SQLite `*Store`.

### 3.3 Dev/quality tooling (`controller/package.json` + root scripts)

| Tool | Role |
|---|---|
| `typescript` | typecheck (`bun run typecheck`, `tsc --noEmit`) |
| `eslint` 9 + `@typescript-eslint` + `eslint-plugin-unicorn` | lint (`bun run lint`) |
| `knip` | unused-export/import detection |
| `jscpd` | copy/paste detection (duplication threshold) |
| `depcheck` | unused dependency detection |
| `prettier` | formatting |
| `@types/node`, `bun-types` | typings |

Root `npm run check` (= `node scripts/project.mjs check`) runs the controller's `typecheck`, `lint`, and `check` (knip + jscpd + depcheck + `controller-standards`).

---

## 4. Feature registry

| Feature | Primary module / file | What it does |
|---|---|---|
| Server bootstrap & graceful shutdown | `src/main.ts`, `src/app-context.ts` | Compose context, fork metrics + supervisor, HTTP server, SIGINT/SIGTERM handling. |
| Engine launch lifecycle | `modules/compute/lifecycle.ts` | `launch`/`stop`/`cancel`/`stateOf`/`instances`/`superviseOnce` — the only mutator in compute; instance record is the lease; derived (never stored) state. |
| Instance supervising/reaping | `modules/compute/supervisor.ts` | 2s loop dropping records whose handle is gone (frees GPUs by construction). |
| Pure engine specs (vLLM/SGLang/llama.cpp/MLX) | `modules/compute/engines/*` | `supports`/`plan`/`health`/`metrics` per backend; `registry.planLaunch` folds in device selection. |
| Process & Docker launchers | `modules/compute/launchers/{process,docker}.ts` | Execute a `LaunchPlan`; answer alive/owns/stop/logTail; ownership-checked (pid nonce, container), TERM→KILL grace window. |
| Device/GPU telemetry & profile | `modules/compute/devices/*` | Accelerator/host/storage/thermal probes; host profile (`HostProfile`). |
| GPU leasing store | `modules/compute/instances/store.ts` | Persist instance records (JSON per instance, write-then-rename); reserve/write/read/drop. |
| Legacy surface bridge | `modules/compute/bridge.ts` | Answers legacy "current inference process" and lifecycle from compute records; serializes recipes→argv; one-active-model on inference port. |
| Recipe CRUD | `modules/engines/recipe-routes.ts`, `models/recipes/recipe-store.ts` | Persisted recipes (SQLite); create/list/get/update/delete/import. |
| Legacy lifecycle routes | `modules/engines/lifecycle-routes.ts` | `/launch/:recipeId`, `/cancel`, `/evict`, `/wait-ready` over the bridge; crash-loop budget (429). |
| Crash-loop protection | `modules/engines/launch-failure-budget.ts` | 3 failures / 10 min blocks a recipe until reset. |
| Runtime target discovery | `modules/engines/runtimes/runtime-targets.ts` | Every way an engine can exist on the box (running process, python/binary, managed venv, system install, docker, bundled wheel) → `RuntimeTarget` rows. |
| Runtime install/upgrade | `modules/engines/runtimes/{managed-venv,managed-llamacpp,engine-jobs,install-lock,runtime-upgrade}` | Managed venv creation, llama.cpp binary management, async engine install jobs, install locking, upgrade paths. |
| Runtime info & config help | `modules/engines/runtimes/{runtime-info,vllm-runtime}` | Per-backend runtime info (`/runtime/vllm`, `/runtime/sglang`…) and `--help` config discovery. |
| Model downloads | `modules/engines/downloads/*` | HF-hosted model/file downloads: list/status, pause/resume/cancel, backpressure-writer, HF API client (649-LOC `download-manager.ts`), persisted in `model_downloads`. |
| OpenAI model listing | `modules/models/routes.ts` | `/v1/models`, `/v1/models/:modelId` (OpenAI shape + `active`, `max_model_len`, vision metadata), `/v1/studio/models` (disk-scan + roots), `/v1/huggingface/models` (HF API proxy). |
| Chat completions proxy | `modules/proxy/*`, `services/provider-routing.ts` | Non-streaming + streaming `/v1/chat/completions`; provider routing; tool-call & reasoning normalization; usage accounting; session_id attach. |
| Tokenization endpoints | `modules/proxy/tokenization-routes.ts` | `/v1/count-tokens`, `/v1/tokenize-chat-completions` proxied to the active backend. |
| Inference usage accounting | `modules/proxy/inference-accounting.ts` | Prompt/completion/reasoning/cache token aggregates → `inference_requests` + lifetime metrics. |
| Streaming tool-call pipeline | `modules/proxy/{tool-call-stream,chat-completions-stream}.ts` | SSE passthrough, usage append, per-chunk tool-call parsing/normalization. |
| Studio settings | `modules/studio/routes.ts` | Get/update `models_dir` + UI prefs; legacy JSON config ↔ DB prefs migration. |
| Studio diagnostics | `modules/studio/routes.ts` | CPU/GPU/runtime/disks/config snapshot. |
| Model storage mgmt | `modules/studio/routes.ts` | `/studio/storage` (per-model sizes), `/studio/models/delete`, `/studio/models/move` (with cross-device copy fallback). |
| Starter presets | `modules/studio/configs.ts` + presets route | Recommended recipe presets filtered by VRAM/platform. |
| Provider management | `modules/studio/provider-routes.ts` | CRUD remote OpenAI-compatible providers (persisted in config JSON), list provider models. |
| Rig management | `modules/studio/rig-routes.ts`, `rig-store.ts`, `rig-detection.ts` | Multi-node "rig" records; auto-detect local node/accelerator (DGX Spark, RTX…); CRUD rigs/nodes. Marked for future multi-node compute. |
| Bundled model index | `modules/studio/model-index.ts` | Serve validated model-index JSON (override file or bundled source). |
| System status/compat/config | `modules/system/routes.ts` | `/status`, `/gpus`, `/compat` (compatibility report), `/config` (services + env + runtime). |
| VRAM calculator | `modules/system/routes.ts` | POST `/vram-calculator` — reads model config.json, estimates weights/KV cache/activations fit. |
| GPU + host platform probes | `modules/system/platform/*` | nvidia-smi, amd-smi, rocm-smi, Intel sysfs, torch info; compatibility report. |
| Metrics collection | `modules/system/metrics-collector.ts`, `engine-metrics-scrape.ts` | Scrape `/metrics` from running engines (+vLLM), GPU snapshot, runtime summary, 5s/30s intervals. |
| Metrics store & peaks | `modules/system/metrics-store.ts`, `metrics-peaks.ts` | Lifetime + per-session peak metrics (TTFT, prefill/generation TPS), benchmark endpoint. |
| Logs & log lifecycle | `modules/system/logs-routes.ts`, `core/log-files.ts`, `core/log-redaction.ts` | List/tail/stream/delete logs by session; retention cleanup; redact secrets before sending to clients; SSE log streaming. |
| Events (SSE) | `modules/system/event-manager.ts` | Typed event bus (`CONTROLLER_EVENTS` contract) → `/events` SSE stream; launch progress, log lines, download events, rig events. |
| Usage aggregation | `modules/system/usage-routes.ts`, `stores/inference-request-store.ts` | Aggregated usage stats (+ controller request counts), optional 15s cache. |
| Controller request telemetry | `core/function-observability.ts`, `stores/controller-request-store.ts` | Record every HTTP request + internal function call (duration, success, error class). |
| Config & env | `config/env.ts`, `config/persisted-config.ts` | Env-driven config with Effect Schema validation; persisted JSON config (models_dir, providers, selected_runtime_target_ids); UI prefs live in the sqlite `controller_settings` table, not the JSON. |
| Auth & rate limiting | `http/security-middleware.ts` | API-key auth + mutating/read rate limiting. |
| OpenAPI + Swagger | `http/app.ts` + `hono-openapi` | Auto-generated `/api/spec` + `/api/docs`. |

---

## 5. HTTP API registry (by module)

### 5.1 Compute (`modules/compute/routes.ts`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/compute/engines` | Engines this host supports + runtimes. |
| GET | `/compute/devices` | Accelerator/host/storage/thermal snapshot. |
| GET | `/compute/instances` | Running instance records + derived state. |
| POST | `/compute/launch` | Low-level launch (direct compute input). |
| POST | `/compute/instances/:name/stop` | Stop & free an instance. |
| POST | `/compute/instances/:name/cancel` | Cancel a launch. |

### 5.2 Engines (`modules/engines/routes.ts` → 4 sub-registrars)

**Recipes** (`recipe-routes.ts`): `GET /recipes`, `GET /recipes/:recipeId`, `POST /recipes`, `PUT /recipes/:recipeId`, `DELETE /recipes/:recipeId`

**Lifecycle** (`lifecycle-routes.ts`): `POST /launch/:recipeId`, `POST /launch/:recipeId/cancel`, `POST /evict`, `GET /wait-ready`

**Downloads** (`download-routes.ts`): `GET /studio/downloads`, `GET /studio/downloads/:downloadId`, `POST /studio/downloads`, `POST /studio/downloads/:downloadId/cancel`, `POST /studio/downloads/:downloadId/pause`, `POST /studio/downloads/:downloadId/resume`

**Runtimes** (`runtime-routes.ts`): `GET /runtime/vllm`, `GET /runtime/vllm/config`, `GET /runtime/sglang`, `GET /runtime/llamacpp`, `GET /runtime/llamacpp/config`, `GET /runtime/mlx`, `GET /runtime/rocm`, `GET /runtime/cuda`, `POST /runtime/:backend/upgrade`, `GET /runtime/targets`, `POST /runtime/targets/:targetId/select`, `POST /runtime/jobs`, `GET /runtime/jobs`, `GET /runtime/jobs/:jobId`, `POST /runtime/jobs/:jobId/cancel`

### 5.3 Models (`modules/models/routes.ts`)
`GET /v1/models`, `GET /v1/models/:modelId`, `GET /v1/studio/models`, `GET /v1/huggingface/models`

### 5.4 Proxy (`modules/proxy/routes.ts`)
`POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`, `POST /v1/count-tokens`, `POST /v1/tokenize-chat-completions`

`/v1/responses` (OpenAI Responses API) and `/v1/messages` (Anthropic Messages API) are pass-throughs: the body is forwarded verbatim to the engine — which serves these dialects itself — after the model field is resolved (provider-routed `provider/model` ids go to that provider with its key; anything else is canonicalized to the recipe's served model name). Streams pass through byte-for-byte. Auth middleware already accepts `x-api-key`, so Anthropic SDKs work by pointing `ANTHROPIC_BASE_URL` at the controller.

### 5.5 Studio (`modules/studio/routes.ts` + sub-registrars)
`GET/POST /studio/settings`, `GET /studio/diagnostics`, `GET /studio/storage`, `GET /studio/presets`, `POST /studio/models/delete`, `POST /studio/models/move`
Providers: `GET/POST /studio/providers`, `PUT/DELETE /studio/providers/:id`, `GET /studio/provider-models`
Rigs: `GET/POST /studio/rigs`, `PUT/DELETE /studio/rigs/:rigId`, `POST /studio/rigs/:rigId/nodes`, `PUT/DELETE /studio/rigs/:rigId/nodes/:nodeId`
Model index: `GET /studio/model-index`

### 5.6 System (`modules/system/routes.ts` + sub-registrars)
`GET /status`, `GET /gpus`, `GET /compat`, `POST /vram-calculator`, `GET /config`
Metrics: `GET /v1/metrics/vllm`, `GET /peak-metrics`, `POST /benchmark`
Logs: `GET /logs`, `GET /logs/:sessionId`, `GET /logs/:sessionId/stream`, `DELETE /logs/:sessionId`, `GET /events`
Usage: `GET /usage`

### 5.7 Global
`GET /health` (public), `GET /api/spec` (OpenAPI), `GET /api/docs` (Swagger UI)

---

## 6. Data stores (SQLite — all via `bun:sqlite` on `controller.db`)

| Store | File | Table(s) | Responsibility |
|---|---|---|---|
| `RecipeStore` | `models/recipes/recipe-store.ts` | recipes (JSON column or columns) | Persisted model recipes + CRUD/import. |
| `DownloadStore` | `engines/downloads/download-store.ts` | `model_downloads` | Persistent download records/status. |
| `PeakMetricsStore` | `system/metrics-store.ts` | `peak_metrics` | Peak benchmark metrics per model (prefill/generation TPS, TTFT). |
| `LifetimeMetricsStore` | `system/metrics-store.ts` | lifetime metrics tables | Cumulative token/request counters. |
| `InferenceRequestStore` | `stores/inference-request-store.ts` | `inference_requests` | Per-inference usage records + aggregation. |
| `ControllerSettingsStore` | `stores/controller-settings-store.ts` | `controller_settings` | UI preferences. |
| `ControllerRequestStore` | `stores/controller-request-store.ts` | `controller_requests`, `controller_function_calls` | Request + internal-function telemetry. |
| `RigStore` | `stores/rig-store.ts` | `rigs` | Persisted rig/node records. |
| `openSqliteDatabase` | `stores/sqlite.ts` | (shared) | DB open with busy_timeout and chmod 600. (The old drop-obsolete-tables sweep was removed; legacy tables from earlier eras persist in existing databases untouched.) |

Additionally, compute instance records are persisted as **one JSON file per instance** in the data dir (write-then-rename), and `config/persisted-config.ts` handles JSON config (models_dir, providers, UI prefs).

Shared DB helper: `openInitializedDatabase`, `repositoryEffect`, `makeDatabaseCloser`, `RepositoryError` — all in `stores/sqlite.ts`.

---

## 7. Line-of-code inventory

### 7.1 Totals (`src` = 128 files, 18,429 LOC; `contracts` = 9 files, 1,360 LOC; combined = 19,789 LOC)

| Area | Files | LOC |
|---|---|---|
| `src/main.ts` + `src/app-context.ts` | 2 | 326 |
| `src/http/` | 8 | 667 |
| `src/core/` | 8 | 809 |
| `src/modules/` total | 102 | 15,254 |
| — compute | 26 | 2,989 |
| — engines | 35 | 4,498 |
| — models | 6 | 1,171 |
| — proxy | 10 | 2,055 |
| — studio | 7 | 1,183 |
| — system | 18 | 3,358 |
| `src/services/` | 1 | 51 |
| `src/stores/` | 5 | 1,058 |
| `src/config/` | 2 | 264 |
| **`src` total (128 files)** | **128** | **18,429** |
| `src` + `contracts` total | 137 | **19,789** |
| `contracts/` | 9 | 1,360 |

Top contributors (300+ LOC): `download-manager.ts` (649), `runtime-targets.ts` (538), `inference-request-store.ts` (421), `logs-routes.ts` (416), `metrics-store.ts` (412), `models/routes.ts` (401), `controller-request-store.ts` (360), `tool-call-stream.ts` (360), `studio/routes.ts` (359), `engine-jobs.ts` (340), `openai-routes.ts` (331), `reasoning.ts` (326), `amd-gpu.ts` (323), `compute/lifecycle.ts` (318), `compute/bridge.ts` (316), `system/routes.ts` (314), `metrics-collector.ts` (310).

### 7.2 Contracts (1,360 LOC)

| File | LOC | Content |
|---|---|---|
| `engine-args.ts` | 281 | Engine argument keys/schema shared with frontend. |
| `usage.ts` | 184 | Usage types. |
| `system.ts` | 181 | Runtime/system types (EngineBackend, RuntimeTarget, CompatibilityReport…). |
| `observability.ts` | 174 | GPU / process / observability types. |
| `controller-events.ts` | 132 | Event names/schemas for SSE. |
| `rigs.ts` | 126 | Rig types + create/update schemas. |
| `model-capabilities.ts` | 123 | Vision capability resolution. |
| `recipes.ts` | 114 | Recipe base types + downloads. |
| `model-index.ts` | 45 | Model index schema (with bundled JSON source). |

---

## 8. Responsibilities by package

### `src/core/` (framework-shared primitives)
- `command.ts` — sync/async process execution, binary resolution (`resolveBinary`), abstract `ProcessRunner` (testable seam).
- `effect-runtime.ts` — `ManagedRuntime` over `AppContextService`.
- `errors.ts` — `HttpStatus` tagged error + `notFound`/`badRequest`/`serviceUnavailable` helpers.
- `validation.ts` — `decodeJsonBody` (Effect Schema), `parseBooleanFlag`.
- `logger.ts` / `log-files.ts` / `log-redaction.ts` — leveled logger (file + onLine), log file enumeration/cleanup, secret redaction for HTTP/SSE surfaces.
- `function-observability.ts` — `observeControllerFunction` wraps Effect calls, records success/failure/duration into `controllerRequestStore`.

### `src/stores/` (SQLite repositories)
Persistent, Effect-wrapped repositories described in §6.

### `src/services/`
- `provider-routing.ts` — parses `providerId/model` strings, resolves provider config → base URL + API key, `DEFAULT_CHAT_PROVIDER`.

### `src/config/`
- `env.ts` — Effect-Schema-validated env config, `.env` loading, CORS origin parsing, startup guard (API key required on non-loopback unless opt-out), persisted-config override of models_dir/providers.
- `persisted-config.ts` — JSON config load/save (models_dir, providers, UI prefs).

---

## 9. Key design invariants (worth knowing)

1. **Engines are pure.** `ComputeEngineSpec.plan()` is a total function of its `LaunchRequest` — no clock/env/fs — making the launch path golden-testable.
2. **The instance record is the lease.** A GPU is "held" iff a live `InstanceRecord` claims it; deleting the record *is* the release. No registry can drift.
3. **Status is derived, never stored.** `stateOf()` reads liveness → health → deadline each time; there is no stale status field.
4. **Ownership checks before signaling.** Launchers verify pid nonce / container name before stop/logTail — never act on something that isn't provably ours (pid-recycle safety).
5. **One active model.** The bridge pins the active model to instance `"llm"` on the legacy inference port, preserving the proxy/metrics/speech contract.
6. **Boundary validation everywhere.** Config, request bodies, persisted JSON — all validated with Effect Schema; tagged error unions avoid substring-matching error messages.
7. **Secret discipline.** Logs are redacted before reaching HTTP/SSE clients; raw files stay on disk; the API key is required for non-loopback binds.
8. **Crash-loop protection.** `launch-failure-budget` (3 fails / 10 min) gates recipe launches with 429s.
9. **Obsolete-state cleanup.** Instance JSON uses write-then-rename. (sqlite.ts no longer drops legacy tables on open — old databases keep them.)

---

## 10. Notable gaps / observations (from this review)

- The controller `README.md` references an `modules/audio` module and a `Runtime["runtime process coordination"]` responsibility, but **no audio module and no `compute/runtimes` directory exists** in `modules/compute` today (engine runtimes live under `modules/engines/runtimes/`; the compute module keeps engine logic under `modules/compute/engines/`). Those README references are stale.
- `exllamav3` is registered in `compute/engines/` (a `ComputeEngineSpec`) but is **not yet launchable** — `bridge.ts` narrows it to `"unknown"` backend and it has no install path in `modules/engines`. It's scaffolding for a future backend.
- The `ComputeBridge` deliberately preserves the legacy one-active-model design; multi-engine concurrency exists in the compute layer (`/compute/launch`, named instances) but the **legacy `/launch` surface and proxy assume a single inference_port / single active model**. The rigs feature (`/studio/rigs`) points toward future multi-node, but the compute layer's "remote" handle kind and node concept are not yet wired to it end-to-end.
- Two engine stacks coexist (`modules/engines` vs `modules/compute`). This is a deliberate migration path (documented in the compute layer), but it doubles the conceptual surface area until `engines` is absorbed.

---

*Report generated from a full source review of `controller/`. LOC are `wc -l` counts of `.ts` files and are approximate; route registries reflect `app.get/post/put/delete` calls in each registrar.*
