# Chapter 2 — Controller

This chapter documents the Bun + Hono controller (`controller/src/`) as it
exists on `feat/plop-t3code-with-pi` (HEAD `7e40ffd9`) compared to
`origin/main` (`1205004e`). The controller has undergone a full five-phase
domain refactor — see [`MIGRATION.md`](../../MIGRATION.md), the design notes
in [`CONTROLLER_SCOPE.md`](../../CONTROLLER_SCOPE.md), and the broader scope
in [`scope.md`](../../scope.md).

## Top-level diff stats

```
173 files changed, 4,153 insertions(+), 10,011 deletions(-)
```

Net **−5,858 LoC** across the controller and the (now-removed) `shared/`
workspace package. Most of that delta is the deletion of the in-controller
agent runtime (`controller/src/modules/chat/`), the elimination of three
nested `lifecycle/`, `downloads/`, and `monitoring/` trees, and the
breakup of the 863-line `proxy/tool-call-core.ts`.

## The five phases (from `MIGRATION.md`)

| Phase | Domain | Outcome |
|------:|--------|---------|
| 1 | **engines** | `lifecycle/{engines,process,runtime,state}` + `downloads/` collapsed into `engines/` behind a single `EngineService` interface (`engines/services/engine-service.ts`). New state machines: `engine-coordinator.ts`, `download-machine.ts`. |
| 2 | **system** | `monitoring/`, `lifecycle/platform/`, `lifecycle/metrics/`, `lifecycle/routes/system-routes.ts` consolidated under `system/`. SSE bus + metrics + GPU/runtime probing live here. |
| 3 | **models** | `lifecycle/recipes/` moved to `models/recipes/`. `lifecycle/types.ts` merged into `models/types.ts`. `lifecycle/` directory deleted. |
| 4 | **chat** | The `chat-run-factory.ts` orchestrator was split into services… **and then the entire `controller/src/modules/chat/` tree was deleted on this branch.** The controller no longer hosts a chat/agent surface — that work is delegated to the external `pi` binary running in the frontend. |
| 5 | **proxy** | `tool-call-core.ts` (863 lines) split into 4 files (`tool-call-parser.ts`, `tool-call-stream.ts`, `content-normalizer.ts`, `reasoning-extractor.ts`). `proxy/proxy-parsers.ts` moved to `core/utf8.ts`. |

The `shared/` workspace package was also dissolved. Its files moved into
`controller/src/modules/shared/` (controller-internal). See
[`shared-types-and-app-context.md`](shared-types-and-app-context.md).

## Before vs after directory tree

### Before (`origin/main`)

```
controller/src/
├── app-context.ts
├── main.ts
├── http/{app,openapi-spec,security-middleware,security-middleware.test,sse,...}.ts
├── modules/
│   ├── audio/
│   ├── chat/                          ← 56 files, full pi-agent runtime
│   │   ├── agent/                       (30 files: run-manager, tool-registry-*, …)
│   │   ├── agent-files/
│   │   ├── chat-routes, store, store-runs, store-schema, compaction, …
│   ├── downloads/                     ← Phase 1 absorbed
│   ├── jobs/
│   ├── lifecycle/                     ← Phase 1/2/3 absorbed
│   │   ├── engines/, process/, runtime/, state/
│   │   ├── platform/, metrics/, recipes/
│   │   └── routes/{lifecycle-routes,runtime-routes,system-routes,...}.ts
│   ├── models/
│   ├── monitoring/                    ← Phase 2 absorbed
│   │   ├── event-manager.ts, metrics*.ts, logs-routes.ts, usage/{...}.ts
│   ├── proxy/
│   │   ├── tool-call-core.ts          ← 863 LoC monolith (Phase 5 split)
│   │   └── proxy-parsers.ts           ← Phase 5 moved
│   └── studio/
shared/                                 ← workspace package, dissolved
└── src/{agent,downloads,index,controller-events,recipe,state-machine,system}.ts
```

### After (`feat/plop-t3code-with-pi`)

```
controller/src/
├── app-context.ts                     # 82 LoC, one container
├── main.ts                            # 70 LoC, server entrypoint
├── contracts/controller-events.ts     # 16 LoC re-export shim → modules/shared
├── core/{async,utf8,...}.ts
├── http/{app,openapi-spec,security-middleware,...}.ts
└── modules/
    ├── audio/                         # untouched (still here, scope says move out)
    ├── engines/                       # Phase 1 — the big consolidation
    │   ├── configs.ts
    │   ├── index.ts, types.ts, routes.ts, routes.test.ts
    │   ├── services/engine-service.ts # the single public contract (98 LoC)
    │   └── layers/                    # 19 files, ~4.2K LoC
    │       ├── engine-coordinator.ts  # 578 LoC — the orchestrator
    │       ├── download-machine.ts    # 277 LoC — pure state machine
    │       ├── download-manager.ts    # 387 LoC — HF downloader
    │       ├── download-store.ts, download-paths.ts, download-math.ts, download-globs.ts
    │       ├── huggingface-api.ts
    │       ├── process-manager.ts     # 372 LoC — spawn/track/kill
    │       ├── process-utilities.ts   # 309 LoC — ps/backend detect/env build
    │       ├── backend-builder.ts     # 578 LoC — vLLM/SGLang/llama.cpp arg builders
    │       ├── runtime-info.ts        # 240 LoC — system runtime probe
    │       ├── vllm-runtime.ts        # 199 LoC
    │       ├── llamacpp-runtime.ts    # 23 LoC
    │       ├── runtime-upgrade.ts     # 92 LoC
    │       ├── upgrade-config.ts      # 27 LoC
    │       ├── vllm-python-path.ts    # 39 LoC
    │       └── launch-state.ts        # 116 LoC (typed state machine)
    ├── jobs/                          # auto/memory/AutoOrchestrator, JobManager, workflows/
    ├── models/
    │   ├── routes.ts (314), model-browser.ts (200), types.ts (93)
    │   └── recipes/                   # Phase 3 — moved from lifecycle/
    │       ├── recipe-store.ts (179), recipe-matching.ts (60), recipe-serializer.ts (149)
    │       └── recipe-store.test.ts
    ├── proxy/                         # Phase 5 — split & cleaned
    │   ├── routes.ts                  # 14 LoC composition
    │   ├── openai-routes.ts           # 385 LoC — the proxy
    │   ├── tokenization-routes.ts     # 265 LoC
    │   ├── tool-call-parser.ts        # 181 LoC
    │   ├── tool-call-stream.ts        # 423 LoC
    │   ├── reasoning-extractor.ts     # 159 LoC
    │   └── content-normalizer.ts      # 71 LoC
    ├── shared/                        # Phase 5 — absorbed shared/ workspace pkg
    │   ├── controller-events.ts (133)
    │   ├── recipe-types.ts (82)
    │   ├── state-machine.ts (45)
    │   └── system-types.ts (121)
    ├── studio/
    └── system/                        # Phase 2 — the consolidation
        ├── routes.ts (292), event-manager.ts (229)
        ├── metrics.ts (166), metrics-store.ts (227), metrics-routes.ts (140)
        ├── logs-routes.ts (264)
        ├── usage-routes.ts (39)       # NEW thin shim
        ├── metrics-collector/         # was lifecycle/metrics/
        ├── platform/                  # was lifecycle/platform/ (gpu, amd-gpu, rocm, …)
        └── usage/
            ├── chat-database.ts (531)
            ├── pi-sessions.ts (290)   # NEW — reads ~/.pi/agent/sessions/*.jsonl
            └── usage-utilities.ts
```

The `lifecycle/`, `downloads/`, `monitoring/`, and `chat/` directories no
longer exist. So does `shared/` (the workspace package).

## Wiring change at the top of `app-context.ts`

`controller/src/app-context.ts` (now 82 LoC) wires the new domains:

```ts
const recipeStore        = new RecipeStore(dbPath);
const downloadStore      = new DownloadStore(dbPath);
const peakMetricsStore   = new PeakMetricsStore(dbPath);
const lifetimeMetricsStore = new LifetimeMetricsStore(dbPath);
const jobStore           = new JobStore(dbPath);
const eventManager       = createEventManager();
const launchState        = createLaunchState();
const processManager     = createProcessManager(config, logger, eventManager);
const downloadManager    = new DownloadManager(config, downloadStore, eventManager, logger);
const engineService      = createEngineCoordinator({ ...deps, abortRunsForModel: () => 0 });
const jobManager         = new JobManager(baseContext as AppContext, jobStore);
```

`engineService: EngineCoordinator` replaces the previous
`lifecycleCoordinator`. `processManager` and `downloadManager` are still
exposed on `AppContext` for legacy consumers, but every new consumer goes
through `engineService` (`EngineService`).

`abortRunsForModel: () => 0` is a deliberate no-op now that the in-process
chat runtime is gone — there are no in-controller runs to abort when a
model is evicted.

## HTTP wiring

`controller/src/http/app.ts` (now 106 LoC) registers a flat list of route
modules, in this order:

```ts
registerSystemRoutes(app, context);
registerEngineRoutes(app, context);
registerModelsRoutes(app, context);
registerStudioRoutes(app, context);
registerAudioRoutes(app, context);
registerJobsRoutes(app, context, context.jobManager);
registerAllProxyRoutes(app, context);
```

The two registrations that were in `origin/main` and are gone:

- `registerAllLifecycleRoutes` → replaced by `registerEngineRoutes` (Phase 1).
- `registerDownloadsRoutes`     → folded into `registerEngineRoutes` (Phase 1).

There is no `registerChatRoutes` anymore.

The 499 (client closed request) error handler in `app.ts` is significantly
hardened to swallow `AbortError`, `ERR_STREAM_PREMATURE_CLOSE`, and similar
client-side aborts as 499s rather than as 500 "Internal Server Error".

## Diff stats per module

Net per-module deltas (`+/−` lines) computed from the file rename map and
the `git diff --stat` for `controller/`:

| Module                                          | Delta (LoC) | Notes |
|-------------------------------------------------|-------------|-------|
| `controller/src/modules/chat/`                  | **−5,666**  | Entire tree deleted (56 files). The pi-agent runtime is gone. |
| `controller/src/modules/lifecycle/`             | **−2,200** ish | Tree deleted; contents moved to `engines/` and `system/` and `models/recipes/`. |
| `controller/src/modules/downloads/`             | **−1,000** ish | Tree deleted; absorbed into `engines/layers/`. |
| `controller/src/modules/monitoring/`            | **−400** ish | Tree deleted; renamed to `system/`. |
| `controller/src/modules/proxy/`                 | **+150 / −880** | `tool-call-core.ts` (863 LoC) replaced by 4 focused files; tests added. |
| `controller/src/modules/system/usage/`          | **+343**    | New `pi-sessions.ts` (290), `chat-database.ts` re-rewrite (+359/-180), thin `usage-routes.ts` (39). |
| `controller/src/modules/engines/`               | **+1,200** ish | New `engine-coordinator.ts` (578), `download-machine.ts` (277), `routes.ts` (327), tests, `engine-service.ts` (98). |
| `controller/src/modules/shared/`                | **+381**    | Absorbed from the deleted `shared/` workspace package. |
| `controller/src/modules/jobs/`                  | minor       | unchanged in behaviour. |
| `controller/src/modules/studio/`                | tiny        | one import path fix. |
| `controller/src/modules/audio/`                 | tiny        | one import path fix. |
| Top-level `shared/`                             | **−103**    | Whole package deleted. |
| `controller/scripts/`                           | **−**       | `delete-test-chat-sessions.ts`, `retitle-chats.ts`, `utilities/compare-controllers.ts` deleted. |

## High-level architecture diagram

```mermaid
graph LR
  Frontend[Frontend / Electron] -- HTTP+SSE --> Hono[Hono App]
  CLI[CLI vllm-studio] -- HTTP --> Hono

  Hono --> SystemR[System routes /status /gpus /events /logs /usage /metrics]
  Hono --> EnginesR[Engine routes /recipes /launch /evict /studio/downloads /runtime/*]
  Hono --> ModelsR[/v1/models /v1/studio/models /v1/huggingface/models]
  Hono --> ProxyR[/v1/chat/completions /v1/tokenize /api/title]
  Hono --> StudioR[/studio/settings /studio/diagnostics /studio/providers]
  Hono --> AudioR[/v1/audio/transcriptions /v1/audio/speech]
  Hono --> JobsR[/jobs]

  EnginesR --> ES[EngineService - EngineCoordinator]
  ES -- spawn/kill --> PM[ProcessManager]
  ES -- HF downloads --> DM[DownloadManager]
  ES -- args --> BB[backend-builder]
  ES -- runtime probes --> RI[runtime-info / vllm-runtime / llamacpp-runtime]
  ES -- emits --> EM[EventManager - SSE bus]

  ProxyR -- ensureActive --> ES
  ProxyR --> Inference[vLLM / SGLang / llama.cpp / TabbyAPI]
  ProxyR -- usage --> LM[LifetimeMetricsStore]

  SystemR --> EM
  SystemR --> Stores[(SQLite stores: recipe, download, peak, lifetime, job)]

  PM -- log lines --> EM
```

## Page index

| Page | Scope |
|------|-------|
| [`engines-module.md`](engines-module.md) | Phase-1 deep read of `controller/src/modules/engines/`. |
| [`system-module.md`](system-module.md) | Phase-2 deep read of `controller/src/modules/system/`. |
| [`models-module.md`](models-module.md) | Phase-3 deep read of `controller/src/modules/models/` and `models/recipes/`. |
| [`proxy-module.md`](proxy-module.md) | Phase-5 deep read of `controller/src/modules/proxy/` (the 4-way split). |
| [`studio-audio-jobs-modules.md`](studio-audio-jobs-modules.md) | Brief read of touched-but-not-refactored modules. |
| [`shared-types-and-app-context.md`](shared-types-and-app-context.md) | `app-context.ts`, `types/`, `contracts/`, `core/`, and the new `modules/shared/`. |
| [`deletions-inventory.md`](deletions-inventory.md) | Every deleted file, grouped & one-line rationale per group. |
| [`modifications-inventory.md`](modifications-inventory.md) | Per-modified-file change summary. |

## Key file size highlights (Chapter 7 candidates)

| File                                                                  | LoC | Why it matters |
|-----------------------------------------------------------------------|----:|----------------|
| `controller/src/modules/engines/layers/engine-coordinator.ts`         | 578 | The lifecycle orchestrator. |
| `controller/src/modules/engines/layers/backend-builder.ts`            | 578 | vLLM/SGLang/llama.cpp/ExLLaMA arg builders in one file. |
| `controller/src/modules/system/usage/chat-database.ts`                | 531 | Big SQL aggregation; reads two SQLite DBs to merge usage. |
| `controller/src/modules/system/metrics-collector/metrics-collector.ts`| 513 | The 5-second poll loop that publishes `metrics`/`runtime_summary`. |
| `controller/src/modules/proxy/tool-call-stream.ts`                    | 423 | SSE rewriter — strips `<think>` and synthesizes `tool_calls`. |
| `controller/src/modules/audio/routes.ts`                              | 410 | STT/TTS — flagged in `CONTROLLER_SCOPE.md` to leave the controller. |
| `controller/src/modules/studio/routes.ts`                             | 398 | Studio settings + provider CRUD + storage. |
| `controller/src/modules/proxy/openai-routes.ts`                       | 385 | The OpenAI-compatible passthrough with abort handling and provider routing. |
| `controller/src/modules/engines/layers/process-manager.ts`            | 372 | Spawns the inference subprocess, captures stdout/stderr. |
| `controller/src/modules/engines/layers/download-manager.ts`           | 387 | HF downloader with resumable Range requests. |
| `controller/src/modules/engines/routes.ts`                            | 327 | Recipe CRUD + launch/evict/cancel + downloads + runtime upgrades. |
| `controller/src/modules/system/usage/pi-sessions.ts`                  | 290 | NEW — reads `~/.pi/agent/sessions/*.jsonl` for usage analytics. |
| `controller/src/modules/system/usage/chat-database.test.ts`           | 73  | NEW. |
| `controller/src/modules/system/usage/pi-sessions.test.ts`             | 53  | NEW. |
| `controller/src/modules/engines/layers/download-machine.ts`           | 277 | Pure state machine (idle → queued → downloading → verifying → ready/error/canceled/paused). |

## Things that disappeared (high-impact)

- The **whole pi-agent runtime in the controller** — see
  [`deletions-inventory.md`](deletions-inventory.md). 30+ files under
  `chat/agent/*` (run-manager, tool-registry, message-mapper, system-prompt-builder,
  tool-circuit-breaker, …) gone. The `pi`-style coding agent now lives in
  the frontend / external `pi` binary, not in the controller.
- `shared/` workspace package — README, `agent.ts`, `downloads.ts`,
  `index.ts`, plus the four files now in `modules/shared/`.
- `controller/scripts/{delete-test-chat-sessions,retitle-chats}.ts`,
  `controller/scripts/utilities/compare-controllers.ts`.
- `controller/src/http/security-middleware.test.ts` (the implementation
  remains; the test file was deleted).
- `.factory/security-config.json` (23 lines) and `.factory/threat-model.md`
  (600 lines) — flagged for Chapter 7 as a security-posture regression.

See [`deletions-inventory.md`](deletions-inventory.md) for the full list.
