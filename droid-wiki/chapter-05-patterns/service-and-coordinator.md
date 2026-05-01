# Pattern 2 — Service-as-contract / coordinator-as-orchestrator

The PR replaces the previous "lifecycle module touches everything" wiring
with a strict two-layer split:

1. A TypeScript **interface** that names every operation external code is
   allowed to perform (the *service*).
2. One concrete **coordinator** class that implements the interface, owns
   the in-process state, and orchestrates effects (spawn / kill / download
   / publish event / probe runtime).

Routes, tests, and other modules depend on the **interface only**. They do
not import the coordinator class.

## The canonical example

| Role | File | LoC |
|------|------|-----|
| Service interface | `controller/src/modules/engines/services/engine-service.ts` | 98 |
| Coordinator (impl) | `controller/src/modules/engines/layers/engine-coordinator.ts` | 578 |
| Public barrel | `controller/src/modules/engines/index.ts` | 9 |

The barrel re-exports `createEngineCoordinator`, the type
`EngineService`, and a few state-machine internals — *and nothing else*.

```ts
// controller/src/modules/engines/services/engine-service.ts
export interface EngineService {
  setActiveRecipe(recipe: Recipe | null, options?: SetActiveRecipeOptions): Promise<SetActiveRecipeResult>;
  ensureActive(recipe: Recipe, options?: EnsureActiveOptions): Promise<EnsureActiveResult>;
  getCurrentRecipe(): Recipe | null;
  getCurrentProcess(): Promise<ProcessInfo | null>;
  startDownload(request: DownloadRequest): Promise<ModelDownload>;
  pauseDownload(downloadId: string): ModelDownload;
  resumeDownload(downloadId: string, hfToken?: string | null): ModelDownload;
  cancelDownload(downloadId: string): ModelDownload;
  listDownloads(): ModelDownload[];
  getDownload(downloadId: string): ModelDownload | null;
  searchHuggingFace(query: string, hfToken?: string | null): Promise<HfModel[]>;
  listRuntimes(): Record<string, RuntimeInfo>;
  upgradeRuntime(runtime: RuntimeType, options?): Promise<UpgradeResult>;
  getRuntimeHelp(runtime: "vllm" | "llamacpp"): Promise<{ config: string | null; error: string | null }>;
}
```

```ts
// controller/src/modules/engines/layers/engine-coordinator.ts
export class EngineCoordinator implements EngineService { ... }
```

## Where else the pattern shows up

- `controller/src/modules/system/` — `EventManager` (a service-like class),
  `MetricsCollector`, `MetricsStore`. Routes consume `EventManager`
  publish/subscribe and never see the underlying `AsyncQueue` machinery.
- `controller/src/modules/models/recipes/recipe-store.ts` — pure CRUD
  service over SQLite. Routes import the class type, not the schema.
- `frontend/src/lib/agent/pi-runtime.ts` — the `PiRuntimeManager` is the
  only public surface; route handlers never touch the inner `PiRpcSession`.
- `controller/src/modules/jobs/` — `JobManager` is the orchestrator;
  individual workflows (`workflows/*`) are the layer it composes.

## Why this pattern

- **Routes stay thin.** `controller/src/modules/engines/routes.ts` (327
  LoC) is mostly `app.get/post(...)` blocks that destructure the request
  and call one method on `engineService`. There is no business logic in the
  HTTP layer.
- **Test seam.** Tests can substitute a hand-rolled fake that implements
  `EngineService` with in-memory data — see
  `controller/src/modules/engines/routes.test.ts` for exactly this. No
  Bun-native process spawning is required to test a route.
- **Replaceable implementation.** The barrel commits to "an
  `EngineService`", not to "an `EngineCoordinator`". A future refactor
  could swap the implementation (e.g., split it across processes) without
  touching consumers.
- **Compilation as documentation.** The interface tells you, in 50 lines,
  every operation the engines module exposes. You don't need to read 578
  lines of coordinator to know what you can call.

## Trade-offs

- **Some duplication of types.** Public types (`Recipe`, `ProcessInfo`,
  `ModelDownload`) are re-exported from the service file. This is mostly
  cosmetic but means you have to keep the re-export list in sync.
- **The implementation is large.** `engine-coordinator.ts` at 578 LoC is a
  Chapter 7 candidate. The interface protects callers, but the
  implementation itself is unsplit.
- **Tight coupling to `CoordinatorDeps`.** The constructor takes a single
  bag of seven dependencies (config, logger, eventManager, processManager,
  recipeStore, downloadManager, abortRunsForModel). Testing a single method
  often requires constructing the bag with stubs.
- **Routes can still escape.** Nothing in the type system forbids a route
  from importing a `layers/*` file directly. The convention is enforced by
  code review, not the compiler.

## Cross-references

- [Chapter 2 — `engines-module.md`](../chapter-02-controller/engines-module.md) — the engines module deep-read.
- [Chapter 2 — `system-module.md`](../chapter-02-controller/system-module.md) — `EventManager` as a service.
- [Chapter 1 — `pi-runtime.md`](../chapter-01-frontend/pi-runtime.md) — the frontend equivalent (`PiRuntimeManager`).
- [Pattern 1 — State machines + effects](./state-machines-and-effects.md) — what the coordinator's state actually models.
- [Pattern 6 — Module layout](./module-layout.md) — where `services/` and `layers/` sit in the file tree.
