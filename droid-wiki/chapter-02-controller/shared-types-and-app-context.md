# Shared types, AppContext, contracts, and core helpers

This page covers the cross-cutting wiring: `app-context.ts`, `types/`,
`contracts/`, `core/`, and the **new** `controller/src/modules/shared/`
which absorbed the dissolved `shared/` workspace package.

## `controller/src/app-context.ts` (82 LoC)

The single dependency container. It is the only file that constructs
the controller's services and stores. Notable changes vs `origin/main`:

- Imports come from the **new module locations**:

  ```ts
  import { createEventManager }       from "./modules/system/event-manager";
  import { createLaunchState }        from "./modules/engines/layers/launch-state";
  import { createMetrics }            from "./modules/system/metrics";
  import { createProcessManager }     from "./modules/engines/layers/process-manager";
  import { DownloadManager }          from "./modules/engines/layers/download-manager";
  import { createEngineCoordinator }  from "./modules/engines/layers/engine-coordinator";
  import { DownloadStore }            from "./modules/engines/layers/download-store";
  import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
  import { RecipeStore }              from "./modules/models/recipes/recipe-store";
  ```

- A new public service: `engineService = createEngineCoordinator({...})`
  is exposed as the canonical lifecycle surface. `processManager` and
  `downloadManager` remain on `AppContext` for legacy access but every
  new consumer flows through `engineService`.

- `abortRunsForModel: () => 0` — a deliberate no-op. Previously this
  was wired to a chat run-manager that no longer exists.

- `lifetimeMetricsStore.ensureFirstStarted()` is called at boot so the
  Studio "first started" timestamp is set before any metric is read.

- `JobManager` is constructed last (it captures the rest of the
  context), then merged in:

  ```ts
  const jobManager = new JobManager(baseContext as AppContext, jobStore);
  return { ...baseContext, jobManager };
  ```

## `controller/src/types/context.ts`

Defines `AppContext` — the public shape of the dependency container:

```ts
export interface AppContext {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchState: LaunchState;
  metrics: ControllerMetrics;
  metricsRegistry: MetricsRegistry;
  processManager: ProcessManager;
  downloadManager: DownloadManager;
  engineService: EngineCoordinator;
  jobManager: IJobManager;
  stores: {
    recipeStore: RecipeStore;
    downloadStore: DownloadStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    jobStore: JobStore;
  };
}
```

Two notable changes vs `origin/main`:

1. `engineService: EngineCoordinator` is **new** and replaces
   `lifecycleCoordinator: LifecycleCoordinator` plus several ad-hoc
   passings of the download manager.
2. `jobManager` is typed as the narrow `IJobManager` interface (3
   methods), **not** the concrete `JobManager` class. This allows the
   `JobManager` constructor to receive an `AppContext` that is later
   self-referential without circular dependency on its own concrete
   type.

The diff for this file is **+34 / −34 lines** — a near-total rewrite of
import paths plus the swap above.

## `controller/src/contracts/controller-events.ts` (16 LoC)

A pure re-export shim:

```ts
export {
  CONTROLLER_BROWSER_EVENT_CHANNEL,
  CONTROLLER_EVENTS,
  CONTROLLER_STREAM_EVENT_TYPES,
  getBrowserEventChannelForControllerEvent,
  getControllerEventDomain,
  isControllerStreamEventType,
} from "../modules/shared/controller-events";

export type {
  ControllerBrowserEventChannel,
  ControllerEventDomain,
  ControllerEventType,
  ControllerStreamEventType,
} from "../modules/shared/controller-events";
```

This file used to import from the deleted `shared/` workspace package
(`@vllm-studio/shared/controller-events`). The shim ensures existing
imports of `controllers/src/contracts/controller-events.ts` continue
to work post-Phase-5 without rippling through every consumer.

## `controller/src/modules/shared/` — the absorbed workspace package

The branch dissolved the top-level `shared/` workspace package.
Its contents now live in `controller/src/modules/shared/`:

```
shared/
├── controller-events.ts   # 133 LoC — CONTROLLER_EVENTS table + domain map + helpers
├── recipe-types.ts        #  82 LoC — Backend, RecipeBase, RecipePayload, ModelDownload, …
├── state-machine.ts       #  45 LoC — generic FSM helper (legacy holder)
└── system-types.ts        # 121 LoC — RuntimeInfo, SystemConfig, CompatibilityReport, …
```

### `controller-events.ts`

The single source of truth for event identifiers used both inside the
controller and for SSE wire format. It declares:

- `CONTROLLER_EVENTS` — an `as const` map of every event type
  (`STATUS`, `GPU`, `METRICS`, `RUNTIME_SUMMARY`, `LAUNCH_PROGRESS`,
  `MODEL_SWITCH`, `DOWNLOAD_PROGRESS`, `DOWNLOAD_STATE`,
  `RECIPE_CREATED/UPDATED/DELETED`, `MCP_*`, `RUNTIME_*_UPGRADED`,
  `JOB_UPDATED`, `LOG`).
- `CONTROLLER_STREAM_EVENT_TYPES` — the subset that goes over SSE.
- `getBrowserEventChannelForControllerEvent(event)` — maps a
  controller event to the BroadcastChannel name the frontend
  subscribes to (e.g. `vllm.recipe`, `vllm.runtime`, `vllm.controller`).
- `getControllerEventDomain(event)` — returns one of `"recipe"`,
  `"runtime"`, `"controller"`, `"mcp"`.

Every `EventManager.publish(new Event(CONTROLLER_EVENTS.X, {...}))`
call in the controller goes through this table.

### `recipe-types.ts`

`Backend` (the union of supported inference backends), `RecipeBase`
(the wire-shape recipe — `id` is plain string here so the frontend can
share this type), `RecipePayload` (the create/update DTO with most
fields optional), and the download types (`DownloadStatus`,
`DownloadFileStatus`, `DownloadFileInfo`, `ModelDownload`).

### `system-types.ts`

`RuntimeInfo`, `SystemConfig`, `CompatibilityCheck`,
`CompatibilityReport`, and the runtime/platform descriptor types
(NVIDIA / AMD / CUDA / ROCm). These types are re-exported from
`modules/models/types.ts` for convenience.

### `state-machine.ts`

A small generic FSM helper. **No longer used by the new
`download-machine.ts`** (which is hand-rolled), but kept because
nothing else has migrated off it yet — Chapter 7 candidate for
deletion.

## `controller/src/types/`

```
types/
├── brand.ts          # branded types (RecipeId, etc.)
├── chat.ts           # +16 LoC — chat message shapes still consumed by proxy
└── context.ts        # AppContext (above)
```

`types/chat.ts` survived even though the chat *runtime* was deleted —
the proxy still needs `ChatCompletionMessage`, `ToolCall`, etc. shapes
to do its work. The +16 lines are field additions
(`reasoning_content`, `session_id`).

## `controller/src/core/`

The grab-bag of cross-cutting helpers. Notable changes:

### `core/async.ts` (+26 LoC)

`AsyncLock` and `AsyncQueue<T>` (capacity 100, drops oldest on
overflow, supports `signal?: AbortSignal` on `shift()`). `EventManager`
relies on this for backpressure-bounded subscribers. New on this
branch: explicit eviction tracking (`evictions`, `evictOldest()`)
which lets the system module monitor SSE backpressure.

### `core/utf8.ts` (renamed from `proxy/proxy-parsers.ts`)

```ts
export const decodeUtf8Chunked: (input: Uint8Array, decoder: TextDecoder) => string;
export const splitSseFrames: (buffer: string) => { frames: string[]; remainder: string };
```

The cross-module home for SSE decoding helpers; previously hidden in
`proxy/`.

### Other core files

`logger.ts`, `errors.ts` (`HttpStatus`, `badRequest`, `notFound`,
`serviceUnavailable`), `command.ts` (`runCommand`, `resolveBinary`),
`log-files.ts` (`primaryLogPathFor`, `tailFileLines`,
`listLogFiles`, `resolveExistingLogPath`) — all stable, only import
path adjustments.

## HTTP wiring — `controller/src/http/app.ts` (+13 / −108 LoC)

The big change: **net −95 lines**. Removed:

- `registerAllLifecycleRoutes(app, context)` (Phase 1)
- `registerDownloadsRoutes(app, context)` (Phase 1)
- `registerAllChatRoutes(app, context)` (Phase 4 — chat tree deleted)
- A 90-LoC inline 499 helper

Added:

- `registerEngineRoutes(app, context)` (Phase 1 successor)
- A condensed, hardened `app.onError` that swallows
  `AbortError` / `ERR_STREAM_PREMATURE_CLOSE` / `EPIPE` /
  `ECONNRESET` / `ECONNABORTED` as 499s rather than 500s.

## Net effect

The wiring layer is **simpler and narrower**: one container
(`AppContext`), one lifecycle service (`engineService`), one event bus
(`EventManager`), one event-name table (`CONTROLLER_EVENTS`), and one
flat `registerXRoutes(app, context)` pattern for HTTP.
