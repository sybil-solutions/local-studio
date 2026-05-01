# Engines module — `controller/src/modules/engines/`

The engines module is the **Phase-1** consolidation. It absorbs the four
sibling directories that lived under `lifecycle/` on `origin/main`
(`engines/`, `process/`, `runtime/`, `state/`) plus the entire
`downloads/` module, and re-exposes them behind a single
`EngineService` interface.

## Layout

```
controller/src/modules/engines/
├── configs.ts                # 21 LoC — merged lifecycle + downloads configs
├── index.ts                  #  6 LoC — public exports
├── routes.ts                 # 327 LoC — Hono routes
├── routes.test.ts            # 167 LoC
├── services/
│   └── engine-service.ts     # 98 LoC — the public contract (interface only)
├── types.ts                  # re-exports from models/types
└── layers/                   # 19 files
    ├── engine-coordinator.ts        # 578 LoC — the orchestrator
    ├── engine-coordinator.test.ts   # 171 LoC
    ├── download-machine.ts          # 277 LoC — pure FSM
    ├── download-machine.test.ts     # 144 LoC
    ├── download-manager.ts          # 387 LoC
    ├── download-manager.test.ts     # 161 LoC
    ├── download-store.ts, download-paths.ts, download-math.ts, download-globs.ts
    ├── huggingface-api.ts
    ├── process-manager.ts           # 372 LoC
    ├── process-utilities.ts         # 309 LoC
    ├── backend-builder.ts           # 578 LoC
    ├── runtime-info.ts              # 240 LoC
    ├── vllm-runtime.ts              # 199 LoC
    ├── llamacpp-runtime.ts          #  23 LoC
    ├── runtime-upgrade.ts           #  92 LoC
    ├── upgrade-config.ts            #  27 LoC
    ├── vllm-python-path.ts          #  39 LoC
    └── launch-state.ts              # 116 LoC
```

## Public contract — `EngineService`

`controller/src/modules/engines/services/engine-service.ts:73-99` defines a
single, narrow interface:

```ts
export interface EngineService {
  // Lifecycle
  setActiveRecipe(recipe: Recipe | null, options?: SetActiveRecipeOptions): Promise<SetActiveRecipeResult>;
  ensureActive(recipe: Recipe, options?: EnsureActiveOptions): Promise<EnsureActiveResult>;

  // State queries
  getCurrentRecipe(): Recipe | null;
  getCurrentProcess(): Promise<ProcessInfo | null>;

  // Downloads
  startDownload(request: DownloadRequest): Promise<ModelDownload>;
  pauseDownload(downloadId: string): ModelDownload;
  resumeDownload(downloadId: string, hfToken?: string | null): ModelDownload;
  cancelDownload(downloadId: string): ModelDownload;
  listDownloads(): ModelDownload[];
  getDownload(downloadId: string): ModelDownload | null;

  // HuggingFace
  searchHuggingFace(query: string, hfToken?: string | null): Promise<HfModel[]>;

  // Runtimes
  listRuntimes(): Record<string, RuntimeInfo>;
  upgradeRuntime(runtime: RuntimeType, options?: { version?: string; args?: string[] }): Promise<UpgradeResult>;
  getRuntimeHelp(runtime: "vllm" | "llamacpp"): Promise<{ config: string | null; error: string | null }>;
}
```

This interface is the **only** thing that other modules and HTTP routes
should reach for. It replaces the previous `LifecycleCoordinator` plus
`DownloadManager` plus runtime helpers — three concerns, one surface.

## `engine-coordinator.ts` (578 LoC) — the orchestrator

`createEngineCoordinator(deps): EngineCoordinator` is constructed in
`app-context.ts` with the following dependencies:

```ts
{
  config, logger, processManager, downloadManager, eventManager,
  recipeStore, downloadStore, peakMetricsStore, lifetimeMetricsStore,
  abortRunsForModel: () => 0
}
```

Notable internals:

- **A `LaunchState` machine** (`layers/launch-state.ts`, 116 LoC) tracks
  the in-flight launch lifecycle: `idle → launching(recipe) → ready`.
- **`setActiveRecipe(recipe, { signal })`** kills any currently active
  recipe (via `processManager.kill(pid)`), starts the new one (via
  `processManager.spawn(recipe, args)` with args from `backend-builder`),
  and polls `/health` until the inference server reports ready or the
  configurable `LIFECYCLE_READY_TIMEOUT_MS = 300_000` elapses. Aborting
  the supplied `AbortSignal` triggers a clean shutdown.
- **`ensureActive(recipe)`** returns `{ switched: false, error: null }`
  when the desired recipe is already running (via
  `isRecipeRunning(recipe, currentProcess)`); otherwise it calls
  `setActiveRecipe`. The proxy uses this to swap models on first request.
- **Event emission**: each lifecycle stage publishes a typed event on the
  `EventManager` SSE bus (`recipe_launched`, `recipe_evicted`,
  `model_loading_progress`, `model_load_failed`, …) using string keys
  re-exported from `contracts/controller-events.ts`.
- **`abortRunsForModel`** dependency is now `() => 0`. Previously this
  was wired to `chat-run-manager.abortAllRunsForModel(modelId)` to cancel
  in-flight chat completions when a model was evicted; that runtime no
  longer exists.

`engine-coordinator.test.ts` (171 LoC) uses an in-process `Bun.serve()`
to fake the inference `/health` endpoint and verifies the
`switched=true|false` semantics, the abort path, and the
`abortRunsForModel` invocation count (zero in the new world).

## `download-machine.ts` (277 LoC) — pure FSM

A side-effect-free state machine for downloads. The states are:

```ts
type DownloadState =
  | "idle" | "queued" | "downloading"
  | "verifying" | "ready" | "error" | "canceled" | "paused";
```

The only public surface is:

```ts
const machine = createDownloadMachine(initialState);
machine.dispatch({ type: "BEGIN" });   // returns DownloadMachineEffect[]
machine.snapshot();                    // returns DownloadMachineSnapshot
```

Each transition returns an explicit list of side-effect descriptors
(`{ type: "PERSIST", record }`, `{ type: "EMIT_EVENT", event }`, …). The
`download-machine.test.ts` (144 LoC) exhaustively walks every legal
transition and asserts that **no side effect is mutated inside the
machine** — effects are only described, never run. The
`download-manager.ts` then interprets those effects.

## `download-manager.ts` (387 LoC) — HF downloader

Implements the actual HTTP/Range-resumable download from HuggingFace
into `${data_dir}/models/<model_id>/`. Key behaviours:

- Resumes on partial files using `Range: bytes=<offset>-`.
- Honours `allow_patterns` / `ignore_patterns` (default ignores
  `.gitattributes`, `.gitignore` from `configs.ts`).
- Throttles `EVENT_DOWNLOAD_PROGRESS` events to once every
  `DOWNLOAD_PROGRESS_THROTTLE_MS = 750` ms.
- Caps concurrent downloads at `DOWNLOADS_MODULE_DEFAULTS.concurrentDownloads = 2`.
- Persists state via `DownloadStore` (SQLite) so progress survives
  controller restarts.
- Bridges the pure `download-machine` FSM to the real world: each
  emitted `DownloadMachineEffect` becomes a DB write, an SSE publish,
  or a fetch call.

## `process-manager.ts` (372 LoC)

Spawns the inference subprocess (`vllm serve`, `python -m sglang.launch_server`,
`./llama-server`, `./tabbyAPI`, …) and tracks it. It:

- Uses `Bun.spawn` and pipes both `stdout` and `stderr` line-by-line into
  `EventManager.publish(new Event(LOG_LINE, { session_id, line }))` so
  the frontend sees real-time logs through `/events` SSE and can replay
  via `/logs/sessions/:id`.
- Owns `ProcessRegistry`: PID → backend, model_path, port,
  served_model_name. `getCurrentProcess()` reconciles this in-memory
  view with `ps`-detected processes via `process-utilities.ts`.
- On `kill(pid)`: SIGTERM with a 10-second timeout, then SIGKILL.

## `backend-builder.ts` (578 LoC)

A single file with one exported function per backend that converts a
`Recipe` into the argv array for that backend's CLI:

- `buildVllmArgs(recipe, config)` — handles `--tensor-parallel-size`,
  `--gpu-memory-utilization`, `--max-model-len`, quantization flags,
  speculative decoding, draft model, KV cache options, …
- `buildSglangArgs(recipe, config)`
- `buildLlamacppArgs(recipe, config)` — ggml/gguf-specific flags.
- `buildExllamav3Args(recipe, config)`
- `buildEnvironmentVisibleDevices(recipe)` — produces
  `CUDA_VISIBLE_DEVICES` / `ROCR_VISIBLE_DEVICES` strings from the
  recipe's `gpu_indexes` or `gpu_count`. Tested in
  `controller/src/tests/build-environment-visible-devices.test.ts`.

This is one of the largest files in the controller and is a strong
**Chapter 7** candidate: a single-file ENUM-of-strings switch on
`recipe.backend` is hard to extend without touching the whole file.

## `runtime-info.ts` (240 LoC)

The system runtime probe used both by the engines module and by the
`metrics-collector`. Exports:

- `getSystemRuntimeInfo(config)` → returns
  `{ vllm: {...}, sglang: {...}, llamacpp: {...}, exllamav3: {...}, cuda: {...}, rocm: {...} }`
  describing what's installed and at what version.
- `getLlamacppRuntimeInfo()`, `getSglangRuntimeInfo()`,
  `getExllamav3RuntimeInfo()`, `getCudaInfo()` — granular probes.

`vllm-runtime.ts` (199 LoC) handles the more complex `vllm` case
including Python path resolution
(`vllm-python-path.ts` → `DEFAULT_CANONICAL_PYTHON_PATH = "/opt/venvs/active/vllm-latest/bin/python"`).

## `runtime-upgrade.ts` (92 LoC) and `upgrade-config.ts` (27 LoC)

Implement `pip install -U <pkg>` style upgrade paths for vLLM, SGLang,
and llama.cpp using the `RUNTIME_UPGRADE_TIMEOUT_MS = 10 * 60_000` cap.
`runPlatformUpgrade` is a thin shell to run platform-level package
manager commands when needed.

## `routes.ts` (327 LoC) — HTTP surface

Endpoints registered (paths are root-level):

```
GET    /recipes
GET    /recipes/:recipeId
POST   /recipes
PUT    /recipes/:recipeId
DELETE /recipes/:recipeId

POST   /launch/:recipeId           # setActiveRecipe with AbortController in a Map
POST   /evict                      # setActiveRecipe(null)
POST   /launch/:recipeId/cancel    # aborts the in-flight controller for recipeId

GET    /studio/downloads
POST   /studio/downloads           # ensureActive triggers download via engineService.startDownload
GET    /studio/downloads/:downloadId
POST   /studio/downloads/:downloadId/pause
POST   /studio/downloads/:downloadId/resume
POST   /studio/downloads/:downloadId/cancel

GET    /v1/huggingface/models      # search HuggingFace, requires hf_token (header/body/env)
GET    /studio/runtimes
POST   /studio/runtimes/:runtime/upgrade
GET    /studio/runtimes/:runtime/help
```

`launchAbortControllers: Map<string, AbortController>` is owned by
`registerEngineRoutes` and is the mechanism by which a launch can be
cancelled mid-flight.

`resolveHfToken(ctx, body)` (top of `routes.ts`) reads, in order:
`body.hf_token`, `X-HF-Token` header, `X-Huggingface-Token` header, then
`VLLM_STUDIO_HF_TOKEN` / `HF_TOKEN` / `HUGGINGFACE_TOKEN` env vars.

## Key tests

| File | LoC |
|------|----:|
| `engine-coordinator.test.ts` | 171 |
| `download-machine.test.ts` | 144 |
| `download-manager.test.ts` | 161 |
| `routes.test.ts` | 167 |

The new `engines` tests collectively replace ~600 LoC of legacy
`lifecycle-coordinator.test.ts` + `lifecycle-routes.test.ts` +
`download-manager.test.ts` from `lifecycle/` and `downloads/`.

## Chapter 7 candidates

- **`engine-coordinator.ts` (578 LoC)** — orchestrator with too many
  responsibilities (launch + evict + ready-poll + event emission +
  download triggering). Could be split along the boundaries already
  modelled in `launch-state.ts`.
- **`backend-builder.ts` (578 LoC)** — one file per backend would scale
  better; the big switch is a smell.
- **`process-manager.ts` (372 LoC)** + **`process-utilities.ts` (309
  LoC)** — together ~680 LoC of subprocess plumbing. The boundary
  between "manager" and "utilities" is fuzzy.
- **`download-manager.ts` (387 LoC)** — interprets `download-machine`
  effects but also does HTTP, throttling, persistence; could be split
  along effect type.

The `EngineService` interface itself is a step **forward** from the
old direct-import mess — every consumer now flows through `context.engineService`.
