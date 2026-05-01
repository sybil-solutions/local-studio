# vLLM Studio Refactor — Phase 1: Engines Module

**Branch:** `refactor/engines-module`
**Start date:** 2026-04-27
**Status:** planning

## Migration Status

| Domain       | Phase | Controller Old Dir                          | Controller New Dir | Frontend Old Dir        | Frontend New Dir |
|-------------|-------|---------------------------------------------|--------------------|------------------------|-----------------|
| engines     | 🟢 done | lifecycle/ + downloads/                     | engines/           | —                      | app/engines/    |
| system      | 🔴 old | lifecycle/ + monitoring/                    | system/            | usage/ + logs/         | app/system/    |
| models      | 🔴 old | models/ + lifecycle/recipes/                | models/            | discover/ + recipes/   | app/models/    |
| chat        | 🔴 old | chat/ + agent-files/                        | chat/              | app/chat/ (159 files)  | app/chat/      |
| pass-through| 🔴 old | proxy/                                      | api-proxy/         | —                      | app/api-proxy/ |

---

## Phase 1 Scope: `engines/` Module

### What moves in

| From                                       | Lines | Goes to                               |
|--------------------------------------------|-------|---------------------------------------|
| `lifecycle/engines/backends.ts`            | ~580  | `engines/layers/backend-builder.ts`   |
| `lifecycle/runtime/vllm-runtime.ts`        | ~90   | `engines/layers/vllm-runtime.ts`     |
| `lifecycle/runtime/llamacpp-runtime.ts`    | ~65   | `engines/layers/llamacpp-runtime.ts`  |
| `lifecycle/runtime/vllm-python-path.ts`    | ~90   | `engines/layers/vllm-python-path.ts`  |
| `lifecycle/runtime/runtime-info.ts`        | ~50   | `engines/layers/runtime-info.ts`     |
| `lifecycle/runtime/runtime-upgrade.ts`     | ~180  | `engines/layers/runtime-upgrade.ts`   |
| `lifecycle/runtime/runtime-upgrade-config.ts`| ~60 | `engines/layers/upgrade-config.ts`   |
| `lifecycle/runtime/configs.ts`             | ~30   | `engines/configs.ts`                 |
| `lifecycle/process/process-manager.ts`     | ~370  | `engines/layers/process-manager.ts`   |
| `lifecycle/process/process-utilities.ts`   | ~350  | `engines/layers/process-utilities.ts` |
| `lifecycle/state/launch-state.ts`          | ~40   | `engines/layers/launch-state.ts`     |
| `lifecycle/state/lifecycle-coordinator.ts` | ~200  | refactored into state machine below   |
| `downloads/manager.ts`                     | ~390  | `engines/layers/download-manager.ts`  |
| `downloads/store.ts`                       | ~120  | `engines/layers/download-store.ts`    |
| `downloads/huggingface-api.ts`             | ~80   | `engines/layers/huggingface-api.ts`   |
| `downloads/download-paths.ts`              | ~40   | `engines/layers/download-paths.ts`    |
| `downloads/download-math.ts`              | ~20   | `engines/layers/download-math.ts`     |
| `downloads/download-globs.ts`             | ~20   | `engines/layers/download-globs.ts`    |
| `downloads/types.ts`                       | ~50   | `engines/types.ts` (re-exported)      |
| `downloads/configs.ts`                     | ~15   | `engines/configs.ts` (merged)         |
| `lifecycle/routes/lifecycle-routes.ts`     | ~140  | `engines/routes.ts` (partial)         |
| `lifecycle/routes/runtime-routes.ts`       | ~40   | merged into `engines/routes.ts`       |
| `downloads/routes.ts`                      | ~80   | merged into `engines/routes.ts`       |

### What stays behind (moves to `system/` in Phase 2)
- `lifecycle/platform/` (GPU detection, hardware)
- `lifecycle/metrics/` (monitoring metrics collector)

### What stays behind (moves to `models/` in Phase 3)
- `lifecycle/recipes/` (recipe store, matching, serializer)

### What stays behind (not part of engines)
- `lifecycle/types.ts` — becomes `shared/types.ts` or stays until Phase 2/3

---

## Target Directory Structure

```
controller/src/modules/
  engines/
    index.ts                    # re-exports Service interface + factory
    configs.ts                  # timeout constants, default ignore patterns
    types.ts                    # re-exports all types needed by consumers
    routes.ts                   # Hono routes (launch, evict, download, upgrade, HF search)

    services/
      engine-service.ts         # EngineService interface (the contract)

    layers/
      # State machines
      engine-lifecycle-machine.ts   # idle → evicting → launching → waiting → ready | error | cancelled
      download-machine.ts           # queued → downloading → verifying → ready | error

      # Engine lifecycle
      engine-coordinator.ts         # orchestrates state machine, calls process/download managers
      backend-builder.ts            # build CLI commands for vllm/sglang/llamacpp
      process-manager.ts            # spawn/kill/evict OS processes
      process-utilities.ts          # PID detection, backend detection, process trees
      launch-state.ts               # tracks current launching recipe ID

      # Runtimes
      vllm-runtime.ts               # vLLM binary paths, python venv
      vllm-python-path.ts           # resolve python for vLLM
      llamacpp-runtime.ts           # llama.cpp binary paths
      runtime-info.ts               # detect installed runtimes
      runtime-upgrade.ts            # upgrade engine runtimes
      upgrade-config.ts             # upgrade URL constants

      # Downloads
      download-manager.ts           # HuggingFace model download orchestration
      download-store.ts             # persistent download state (JSON file)
      huggingface-api.ts            # HuggingFace API client
      download-paths.ts             # resolve download root, sanitize paths
      download-math.ts              # sum bytes, progress calculation
      download-globs.ts             # pattern matching for file filtering
```

---

## Step-by-Step Execution

### Step 1: Define the `EngineService` interface

Create `controller/src/modules/engines/services/engine-service.ts`.

This is the **single public contract** for the engines module. All consumers (HTTP routes, other modules, tests) use this interface.

```typescript
export interface EngineService {
  // Lifecycle
  launch(recipe: Recipe): Promise<LaunchResult>;
  evict(force?: boolean): Promise<EvictResult>;
  cancelLaunch(recipeId: string): Promise<CancelResult>;

  // State queries
  getState(): EngineLifecycleState;
  getCurrentRecipe(): Recipe | null;

  // Downloads
  startDownload(request: DownloadRequest): Promise<DownloadHandle>;
  cancelDownload(downloadId: string): void;
  listDownloads(): DownloadStatus[];
  getDownload(downloadId: string): DownloadStatus | null;

  // HuggingFace
  searchHuggingFace(query: string): Promise<HfModel[]>;

  // Runtimes
  listRuntimes(): RuntimeInfo[];
  upgradeRuntime(runtime: RuntimeType): Promise<UpgradeResult>;
}
```

### Step 2: Implement state machines

Create **two** state machines using `shared/state-machine.ts`:

**`engine-lifecycle-machine.ts`**

```
States: idle, evicting, launching, waiting, cached, ready, error
Events:
  LAUNCH { recipe }
  EVICT { force }
  CANCEL
  PROCESS_STARTED { pid }
  HEALTH_PASS
  HEALTH_FAIL { reason }
  PROCESS_DIED { pid }
  PREEMPT { recipeId }
Transitions produce effects: [START_PROCESS, KILL_PROCESS, EMIT_EVENT, LOG]
```

**`download-machine.ts`**

```
States: idle, queued, downloading, verifying, ready, error
Events:
  START { downloadId, modelId, destination }
  PROGRESS { bytes, total }
  VERIFY_START
  VERIFY_PASS
  VERIFY_FAIL { reason }
  CANCEL
Transitions produce effects: [FETCH_FILE_LIST, DOWNLOAD_FILE, VERIFY_CHECKSUM, EMIT_EVENT, STORE_PROGRESS]
```

### Step 3: Wire the coordinator

Create `engine-coordinator.ts` which:
1. Instantiates the engine lifecycle state machine
2. Implements `EngineService` by dispatching events to the state machine
3. Handles effects produced by state transitions (spawn process, kill process, emit SSE event)
4. Integrates `process-manager` for OS process control
5. Integrates `download-manager` for model downloads
6. Emits `CONTROLLER_EVENTS` for every state transition (MODEL_SWITCH, LAUNCH_PROGRESS, DOWNLOAD_PROGRESS)

**Key change from current code:** The current `lifecycle-coordinator` uses async locks, cancel controllers, and manual state tracking (`markLaunching`, `markIdle`). The new coordinator dispatches events to the state machine, which **returns** the new state + effects. The coordinator executes effects, never mutates state directly.

### Step 4: Move and clean up layer files

For each layer file being moved:
1. Copy file to new location under `engines/layers/`
2. Update imports to new paths
3. Remove code that's made redundant by state machines (e.g., manual flag tracking)
4. Do NOT delete old file yet — keep both until Step 7

### Step 5: Create routes

Create `engines/routes.ts` with Hono routes that call `EngineService`:

```
GET    /recipes              → engineService.getState() + list available recipes
POST   /launch/:id           → engineService.launch(recipe)
POST   /evict                → engineService.evict()
POST   /launch/:id/cancel    → engineService.cancelLaunch(recipeId)
GET    /studio/downloads     → engineService.listDownloads()
POST   /studio/downloads     → engineService.startDownload(body)
DELETE /studio/downloads/:id → engineService.cancelDownload(id)
GET    /runtimes              → engineService.listRuntimes()
POST   /runtimes/upgrade     → engineService.upgradeRuntime(body)
GET    /huggingface/search    → engineService.searchHuggingFace(q)
```

Route handlers are thin: parse request → call service → return JSON.

### Step 6: Register routes and wire context

Update `controller/src/http/app.ts`:
- Replace `registerAllLifecycleRoutes(app, context)` with `registerEngineRoutes(app, context.engineService)`
- Replace `registerDownloadsRoutes(app, context)` with no separate call (downloads are part of engines)
- Remove `registerAllLifecycleRoutes` and `registerDownloadsRoutes` imports

Update `controller/src/types/context.ts`:
- Replace `processManager: ProcessManager` with `engineService: EngineService`
- Replace `downloadManager: DownloadManager` with (removed — part of EngineService)
- Replace `launchState: LaunchState` with (removed — internal to engine state machine)
- Keep `lifecycleCoordinator: LifecycleCoordinator` temporarily (Phase 2 removes it)

Update `controller/src/app-context.ts`:
- Create `engineService = createEngineService({ config, logger, eventManager, processManager, downloadStore, recipeStore })`
- Wire into `AppContext`

### Step 7: Update consumers and delete old code

Files that import from lifecycle or downloads:

| Consumer | What changes |
|----------|-------------|
| `app-context.ts` | Updated in Step 6 |
| `http/app.ts` | Updated in Step 6 |
| `types/context.ts` | Updated in Step 6 |
| `main.ts` | No change (uses AppContext) |
| `proxy/openai-routes.ts` | Change `context.processManager.findInferenceProcess()` to `context.engineService.getState()` |
| `studio/routes.ts` | Change lifecycle/process imports to engines imports |
| `studio/routes.test.ts` | Same |
| `models/routes.ts` | Change lifecycle imports to engines imports |
| `monitoring/logs-routes.ts` | May use lifecycle types — check |
| `monitoring/metrics-routes.ts` | May use lifecycle types — check |
| `audio/routes.test.ts` | May use lifecycle types — check |

After all consumers are updated, delete old directories:
- `controller/src/modules/lifecycle/engines/`
- `controller/src/modules/lifecycle/process/`
- `controller/src/modules/lifecycle/runtime/`
- `controller/src/modules/lifecycle/state/lifecycle-coordinator.ts`
- `controller/src/modules/lifecycle/state/launch-state.ts`
- `controller/src/modules/downloads/`
- `controller/src/modules/lifecycle/routes/lifecycle-routes.ts`
- `controller/src/modules/lifecycle/routes/runtime-routes.ts`

Keep for Phase 2/3:
- `lifecycle/platform/` → Phase 2 (system)
- `lifecycle/metrics/` → Phase 2 (system)
- `lifecycle/recipes/` → Phase 3 (models)
- `lifecycle/types.ts` → Phase 2 (shared or system)

### Step 8: Frontend domain store

Create `frontend/src/app/engines/`:

```
engines/
  page.tsx              # Engines dashboard page
  store.ts              # Zustand store subscribing to SSE events
  hooks/
    use-engines.ts      # useEnginesStore hook
    use-engine-events.ts # SSE subscription hook
  components/
    engines-dashboard.tsx
    launch-panel.tsx
    download-queue.tsx
    runtime-list.tsx
    upgrade-panel.tsx
  api/
    engines-api.ts      # fetch wrappers for controller endpoints
```

The store:
- Listens to SSE events: `MODEL_SWITCH`, `LAUNCH_PROGRESS`, `DOWNLOAD_PROGRESS`, `DOWNLOAD_STATE`, `RUNTIME_*_UPGRADED`
- Holds state for: current engine state, download queue, available runtimes, upgrade status
- Components only read from store selectors and dispatch store actions

### Step 9: Tests

Test the state machines in isolation first (pure functions, no IO):

```typescript
// engine-lifecycle-machine.test.ts
test("launch from idle transitions to evicting", () => {
  const result = dispatch("idle", {}, { type: "LAUNCH", recipe: mockRecipe });
  expect(result.state).toBe("evicting");
  expect(result.effects).toContainEqual({ type: "EVICT_CURRENT" });
});
```

Then test the coordinator with mocked process-manager and download-manager.

Then test routes with a test Hono app and mocked EngineService.

### Step 10: Update MIGRATION.md

After each step is complete, update the migration status table at the top of this file from `🔴 old` to `🟡 in-progress` and finally `🟢 done`.

---

## Rules of Engagement

1. **Every commit updates MIGRATION.md if phase status changes.**
2. **State is always advanced via `dispatch(event, context)`, never `setState()`.**
3. **Routes never call layer code directly. Routes → EngineService → coordinator → state machine → layers.**
4. **All state transitions emit a CONTROLLER_EVENT. The frontend never polls for engine state.**
5. **Old code is only deleted in Step 7, after all consumers are migrated and verified.**
6. **No feature changes during refactor. If a bug is found in old code, fix it in the old code, then port the fix to new code.**

---

## Verification Checklist

- [ ] `bun test` passes (controller)
- [ ] `bun typecheck` passes (controller)
- [ ] `npm run build` passes (frontend)
- [ ] `curl localhost:8080/recipes` returns expected data
- [ ] `curl localhost:8080/studio/downloads` returns expected data
- [ ] Model launch via `POST /launch/:id` works end-to-end
- [ ] SSE events fire for launch progress
- [ ] Model eviction works
- [ ] Download with `POST /studio/downloads` starts correctly
- [ ] Download progress SSE events fire
- [ ] Download cancellation works
- [ ] Runtime upgrade endpoint works
- [ ] HuggingFace search endpoint works
- [ ] Frontend engines page renders (if built)
- [ ] Dead code removed (no imports to old lifecycle/engines, lifecycle/process, lifecycle/runtime, downloads/)
- [ ] MIGRATION.md shows engines as `🟢 done`
