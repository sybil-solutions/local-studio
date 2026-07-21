# Engines module — core slice (routes, coordinator, specs)

Scope: `src/modules/engines/` top level — `routes.ts`, `lifecycle-routes.ts`, `recipe-routes.ts`,
`engine-coordinator.ts`, `engine-spec.ts`, `types.ts`, `configs.ts`, `argument-utilities.ts`, plus
`specs/{vllm,sglang,llamacpp,mlx}-spec.ts`. Paths below are relative to
`/Users/sero/projects/vllm-studio/controller`.

Tests: there are **no test files in this slice**. The engines module's tests live in the
neighboring sub-slices (`downloads/download-manager.test.ts`, `downloads/huggingface-api.test.ts`,
`runtimes/runtime-info.test.ts`, `runtimes/runtime-target-factory.test.ts`) — the coordinator and
the four engine specs are untested directly.

---

## 1. Purpose

This slice is the "one model at a time" brain of Local Studio. It exposes the HTTP API for
recipe CRUD and model lifecycle (launch / cancel / evict / wait-ready), and it contains
`EngineCoordinator`, the stateful object that serializes all launch/evict operations, manages GPU
leases, watches liveness of the spawned inference process, and enforces a crash-loop budget. The
`specs/` directory holds per-backend "strategy" objects (vLLM, SGLang, llama.cpp, MLX) that know
how to turn a recipe into a CLI command line, how to recognize that backend in a running process's
argv, and how to install/probe the runtime.

---

## 2. File-by-file walkthrough

### `src/modules/engines/routes.ts` (14 lines)

The module's front door. `registerEngineRoutes` is a `defineRoutes` registrar that merges four
sub-registrars: recipe routes, lifecycle routes (this slice), download routes, and runtime routes
(neighboring slices). Mounted directly on the root Hono app — **no URL prefix** — in
`src/http/app.ts:92`. So the lifecycle endpoints really are `POST /launch/:recipeId`,
`POST /evict`, etc., at the server root.

Key detail: `mergeRoutes` (`src/http/route-registrar.ts:22-26`) is a type-level trick. Every
registrar mutates the *same* Hono `app` instance and returns it; `mergeRoutes` literally returns
`routes[0]` and casts it to `UnionToIntersection<Routes[number]>` so TypeScript accumulates the
route types for OpenAPI generation. There is no runtime merging at all.

### `src/modules/engines/lifecycle-routes.ts` (137 lines)

HTTP layer for launch/evict. Four endpoints:

- **`POST /launch/:recipeId`** (`lifecycle-routes.ts:11-91`). The most complex handler in the
  slice. Flow: look up recipe → determine caller "source" from `x-vllm-source` / `x-source` /
  `user-agent` headers (for log attribution, `:21-25`) → reject with **409** if
  `context.launchState` is not `idle` (`:27-43`; message differs depending on whether it's the
  same recipe re-launching or a different one queued) → reject with **409** if a *different* model
  is already listening on the inference port (`:44-60`, matched via `isRecipeRunning` with
  `allowEitherPathContains: true`) → otherwise mark launch state, register an `AbortController`
  in the local `launchAbortControllers` map (`:8, :62`), and delegate to
  `context.engineService.setActiveRecipe(recipe, { signal })`.
  Cleanup is in `Effect.ensuring` (`:77-89`): only runs its body if `ownsLaunch` is true, and
  carefully checks identity (`launchAbortControllers.get(recipeId) === controller`,
  `launchState.getLaunchingRecipeId() === recipeId`) before deleting/marking idle — so a newer
  launch for the same recipe can't be clobbered by an older handler's cleanup.
  Failure mapping at `:68-74`: if the coordinator's error string contains "cancelled" → 400,
  otherwise 503.
- **`POST /launch/:recipeId/cancel`** (`:93-108`). Aborts the per-recipe `AbortController` and
  then calls `context.engineService.cancelActiveLaunch()`. Note the asymmetry: the 404 check is
  per-recipe (the map), but `cancelActiveLaunch` cancels *whatever* launch is globally active —
  there is only ever one, so it works, but the endpoint's recipe scoping is cosmetic.
- **`POST /evict`** (`:110-120`). `setActiveRecipe(null)` — the same code path as launch, with a
  null recipe. Always returns `evicted_pid: null` (`:117`); the field exists for API shape
  compatibility but carries no information (dead-ish).
- **`GET /wait-ready?timeout=...`** (`:122-135`). Polls `engineService.waitForHealthy(timeout *
  1000)` (default 300 s) and reports elapsed seconds. Pure pass-through; no state changes.

The `launchAbortControllers` map is scoped to the registrar closure (`:8`), so all four routes
share it. `launchState` itself is a tiny two-field state machine created in
`src/modules/engines/process/launch-state.ts:13-25` and shared via `AppContext`.

### `src/modules/engines/recipe-routes.ts` (112 lines)

Recipe CRUD. `RecipePayloadSchema = Schema.Record(Schema.String, Schema.Unknown)` (`:12`) is
deliberately permissive — the real validation happens in `parseRecipe`
(`src/modules/models/recipes/recipe-serializer`), wrapped in `Effect.try` and mapped to 400
(`:59-62`).

- **`GET /recipes`** (`:19-37`). The interesting one: recipe **status is derived at read time,
  never stored**. For each recipe: `error` if the crash-loop budget is blocked, `starting` if it's
  the currently-launching id, `running` if `isRecipeRunning` matches the observed inference
  process, else `stopped` (`:27-33`). The `crash_loop` budget snapshot is attached to the response.
  `getObservedProcess` comes from `observed-process.ts:4-11`, a thin wrapper that adds
  `observeControllerFunction` telemetry around `engineService.getCurrentProcess()`.
- **`GET /recipes/:recipeId`** (`:39-51`). Straight store get + 404.
- **`POST /recipes` / `PUT /recipes/:recipeId`** (`:53-92`). Parse → save to SQLite-backed
  `recipeStore` → `engineService.resetLaunchFailureBudget(id)` (editing a recipe clears its
  crash-loop block, `:66, :87`) → publish `RECIPE_CREATED` / `RECIPE_UPDATED` SSE event. PUT
  forces the URL id into the body (`parseRecipe({ ...body, id: recipeId })`, `:81`), so clients
  can't rename a recipe via PUT body.
- **`DELETE /recipes/:recipeId`** (`:94-110`). Delete → reset budget → publish `RECIPE_DELETED`.
  Note: deleting does **not** stop a running model for that recipe.

### `src/modules/engines/engine-coordinator.ts` (570 lines)

The heart of the slice. A plain class (not an Effect service) constructed with a `CoordinatorDeps`
bag (`:30-42`) — everything injectable, including `processExists` and `healthProbe` seams clearly
meant for tests that were never written. Constructed in `src/app-context.ts:190-197` and its
`shutdown()` is registered as an `Effect.acquireRelease` finalizer (`app-context.ts:199-201`).

**Mutable state** (`:60-66`):

- `switchLock = Semaphore.makeUnsafe(1)` — mutual exclusion for lifecycles.
- `activeLifecycleAbort` / `activeLaunchPid` — handle on the in-flight launch.
- `lifecycleIntentSerial` — a monotonically increasing counter implementing *intent preemption*.
- `livenessFiber` / `livenessSerial` — handle on the background liveness monitor fiber.
- `leaseState: "unknown" | "held" | "released"` — local cache of GPU lease status.

**`setActiveRecipe(recipe | null, options)`** (`:70-89`) is the single entry point for both launch
and evict. Three things happen *before* the lock is taken:

1. `intentSerial = ++this.lifecycleIntentSerial` — every call bumps the serial.
2. `this.activeLifecycleAbort?.abort()` — the previous lifecycle's AbortController is fired
   immediately.
3. If this is an evict while a launch is mid-flight, `killOwnedProcess(activeLaunchPid)` runs
   *outside* the lock as a "preempt" (`:78-82`).

Then `switchLock.withPermit(runLifecycle(...))` serializes the actual work. Any older lifecycle
still waiting on or holding the lock detects preemption via
`isAborted() = lifecycleAbort.signal.aborted || intentSerial !== this.lifecycleIntentSerial`
(`:107-108`) — the serial check catches preemption even for evictions (which have no abort
controller). This is the key idiom of the whole file: **cooperative cancellation by comparing a
captured serial against a shared counter, checked at every suspension point.**

**`runLifecycle`** (`:91-251`) is the state machine. Read it as a linear script with abort checks
between steps:

1. Serial re-check on entry (`:142-144`) — may have been preempted while waiting for the lock.
2. Stop any old liveness monitor; find what's currently on the inference port (`:145-148`).
3. No-op fast paths: evict with nothing running (`:151-155`); launch when the requested recipe is
   *already* running — re-acquire the lease, restart liveness, succeed (`:156-163`).
4. If something else is running: `killCurrent` (`:253-276`, publishes "stopping"/"stopped"
   progress events keyed to the *evicted* recipe), then `releaseLlmGpuLeaseAfterStop`
   (`:492-504`) — if the port isn't confirmed free, it starts a liveness monitor and fails with
   "Inference workers are still stopping" rather than releasing the GPU lease early.
5. Acquire the GPU lease: `prepareRecipeGpuLease` (`:432-477`) resolves the recipe's GPU
   selectors to UUIDs, refuses an implicit all-GPU launch when NVIDIA leases can't be verified
   (`:447-456`), and calls `gpuLeaseRegistry.replace("llm", uuids)`. `GpuLeaseConflict` is mapped
   to the user-facing message "The selected model GPU is reserved by local speech" (`:466-468`).
6. Crash-loop gate: `launchFailureBudget.isBlocked(recipe.id)` → relinquish lease, publish error,
   fail (`:183-189`). Budget = **3 failures in 10 minutes**
   (`process/launch-failure-budget.ts:18-19`), kept as a pruned timestamp list per recipe.
7. `processManager.launchModel(recipe, lease.launchOptions)` spawns the process (`:196-201`).
   Spawn failure → relinquish lease, `recordFailure`, publish error with "N/3 launch failures in
   the current window" (`:202-212`).
8. `waitForReady` (`:315-344`): polls the backend-specific `healthPath` every 2 s
   (`pollHealthy`, `:290-307`) up to `LIFECYCLE_READY_TIMEOUT_MS`. The `failure` callback checks
   two early-exit conditions each tick: abort signal, and **process death** — if the pid vanished,
   it reads the last 500 bytes of the launch log and embeds the last 200 chars in the crash
   message (`:327-329`).
9. Ready → `launchFailureBudget.reset`, publish "ready", start an *owned* liveness monitor, set
   `retainLease = true` (`:225-231`). Not ready → same failure path as spawn failure.

Resource safety is handled by two combinators on the whole gen block (`:241-250`):
`Effect.onExit` relinquishes the GPU lease unless `retainLease` was set, and `Effect.ensuring`
clears the coordinator's handles (with identity checks) and removes the abort listener.
`relinquishLease` (`:110-120`) itself is subtle: it kills the spawned pid, and only releases the
lease if the kill succeeded — otherwise it hands the pid to the liveness monitor so the lease is
released when the process finally dies.

**Liveness monitor** (`:506-551`). `Effect.forkDetach` spawns a fiber that loops on a 1 s
(default) `Effect.sleep`. Two modes: `"owned"` waits for the ProcessManager to confirm the
spawned process is gone (with a `killOwnedProcess` retry if the pid disappeared but the manager
still tracks it); `"observed"` waits until nothing is on the inference port. When the loop breaks,
the fiber checks its serial is still current (`:531`) and releases the `"llm"` GPU lease — this
is what frees the GPU when a model crashes *outside* any lifecycle operation. `livenessSerial`
protects against a stale fiber releasing a lease a newer monitor owns.

**Other public methods**: `waitForHealthy` (`:309-313`) polls `/health` generically;
`cancelActiveLaunch` (`:364-374`) and `shutdown` (`:389-417`) follow the same
bump-serial → abort → preempt-kill → take-lock pattern; `getCurrentRecipe` (`:380-387`)
reverse-matches the running process to a recipe with errors swallowed to `null`.

### `src/modules/engines/engine-spec.ts` (87 lines)

The strategy interface. `EngineSpec` (`:49-67`) declares everything the rest of the system needs
from a backend: `id`, `healthPath`, `cliBinary`, `buildCommand(recipe, config) → string[]`,
`managedPackageSpec(version)`, `install(options)`, and the argv-introspection trio
`detectInvocation` / `extractModelPath` / `extractServedModelName` (used to classify *foreign*
processes found on the port), plus optional `probeBinary` / `resolvePythonPath` /
`getRuntimeInfo` / `getConfigHelp` for the runtime-management UI. `InstallOptions` (`:14-22`)
carries progress/spawn callbacks so install jobs can stream output and expose the child process
for cancellation.

`EngineOperationError` (`:41-47`) is the module's typed error (`Schema.TaggedErrorClass`), with
`operation` + `message` fields. `SPECS` (`:69-74`) is the static registry; `getEngineSpec` is a
dictionary lookup. `detectEngineFromArguments` (`:80-85`) asks each spec in order until one
recognizes the argv — order matters only if two specs could match the same argv (in practice
llamacpp's substring matching, `llamacpp-spec.ts:94-104`, is the loosest and is checked third).

### `src/modules/engines/specs/vllm-spec.ts` (255 lines)

The richest spec. Highlights:

- **Extra-args guardrail** (`:42-89`): `appendVllmExtraArguments` filters
  `recipe.extra_args` against a known-key allowlist from the contracts package
  (`getUnknownVllmExtraArgKeys`). Unknown keys are *dropped* with a warning; keys that look like
  someone misusing extra_args as a notes field get a tailored hint. Escape hatches:
  `LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS=true` bypasses filtering;
  `LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS=true` only escalates the log level — it never fails the
  launch.
- **Command building** (`:107-191`): `buildVllmRecipeArguments` maps recipe fields to flags, with
  defaults from `process/model-runtime-defaults` for tool-call and reasoning parsers
  (`:131-140`) and an expert-parallel heuristic (`:118-121`). Invocation head selection
  (`:150-177`): managed venv → sibling `vllm` binary if present, else `python -m
  vllm.entrypoints.openai.api_server`; a runtime ref that looks like a python executable gets the
  same treatment. `buildVllmCommand` then appends the model path positionally for `serve` or as
  `--model` for the module form (`:184-188`), and wraps everything in `docker run` when
  `recipe.runtime.kind === "docker"` (`:91-105, :190`) with a per-recipe named volume
  (`local-studio-jit-<recipe>`) for Triton/CUDA/vLLM JIT caches.
- **Detection**: `-m vllm.entrypoints.openai.api_server` or a `vllm serve` CLI (`:196-200`);
  model path from `--model` / `--model-path` / first positional after `serve` (`:202-208`).
- Install/probe/runtime-info delegate to `runtimes/vllm-runtime` and `runtimes/managed-venv`.

### `src/modules/engines/specs/sglang-spec.ts` (254 lines)

Same shape as vLLM with backend-specific quirks:

- Flag mapping translates generic recipe fields to SGLang names: `max_model_len` →
  `--context-length`, `gpu_memory_utilization` → `--mem-fraction-static`, `max_num_seqs` →
  `--max-running-requests` (`:59-63`). `--enable-metrics` is injected by default unless the user
  set it in extra_args (`:76-78`) — the only spec that force-enables a flag.
- `stripForeignFlagKeys("sglang", ...)` (`:91`) removes extra_args keys known to belong to other
  backends, so a copied recipe doesn't pass vLLM-only flags to SGLang.
- Head selection (`:94-108`) prefers a `sglang` CLI binary next to the resolved python, falling
  back to `python -m sglang.launch_server`.
- `probeBinary` (`:131-152`) runs `--version` then `--help` with 5 s timeouts, parsing the version
  with a regex and treating a runnable `--help` as "installed, version unknown".
- `resolvePythonPath` (`:154-168`) checks env → managed venv → two hardcoded `/opt/venvs/...`
  paths → python resolved from a `sglang` script on PATH. `installSglang` (`:223-238`) honors an
  env-configured upgrade command before falling back to a managed-venv pip install of
  `sglang[all]`.

### `src/modules/engines/specs/llamacpp-spec.ts` (156 lines)

- **Binary hardening** (`:25-53`): a `llama_bin` override (recipe extra_args or config) must be a
  `llama-server` (or `.exe`) basename and must not contain `..` path segments — both violations
  throw, which surfaces as a launch failure. This is the only spec that validates the executable
  path, presumably because the binary path is user-configurable.
- `serializeLlamacppArgument` (`:55-65`) defines how extra_args values become flags: booleans
  toggle presence, arrays repeat the flag, objects are JSON-stringified.
- `served_model_name` maps to llama.cpp's `--alias` (`:75-77`); `--ctx-size` comes from
  `max_model_len` unless overridden (`:78-81`).
- `detectInvocation` (`:94-104`) is loose substring matching on the joined argv
  (`llama-server`, `llama.cpp`, or a llama-ish argv[0] with `-m `) — the least precise detector
  of the four.
- No `probeBinary`; `getConfigHelp` runs `llama-server --help` with the 15 s
  `LLAMACPP_HELP_TIMEOUT_MS`. Install prefers an env upgrade command, else
  `installManagedLlamacpp` (managed download of prebuilt binaries, in `runtimes/`).

### `src/modules/engines/specs/mlx-spec.ts` (101 lines)

The minimal spec. `python -m mlx_lm.server` with `--model/--host/--port` (`:13-22`); Apple
Silicon only, so no parallelism/quantization mapping. Notably: `healthPath` is **`/v1/models`**
(`:91`), not `/health` — the coordinator's readiness polling uses whatever the spec declares, so
this asymmetry is absorbed transparently. `extractServedModelName` always returns `null`
(`:39-41`) — mlx_lm has no alias flag. No `getConfigHelp`. `upgrade_command_available: false`
hardcoded in runtime info (`:71`).

### `src/modules/engines/types.ts` (32 lines)

Pure re-export barrel: download types and system/runtime contract types from
`@local-studio/contracts`, plus `LaunchResult` / `ProcessInfo` / `Recipe` / `GpuInfo` from
`../models/types`. Exists so sibling modules can import engine-adjacent types from one place.
Nothing executes.

### `src/modules/engines/configs.ts` (20 lines)

Module-level constants. The only dynamic one is `LIFECYCLE_READY_TIMEOUT_MS` (`:4-9`), parsed
once at import time from `LOCAL_STUDIO_READY_TIMEOUT_MS` (default 300 000 ms) — the comment
explains why: large MoE models in Docker can exceed 5 minutes. Timeouts for runtime operations:
help 15 s, vLLM command 10 s, upgrades 10 min, first-time engine install 30 min (`:14-20`).

### `src/modules/engines/argument-utilities.ts` (58 lines)

Shared argv/extra_args parsing primitives, extracted (per the header comment) to break a circular
dependency between `engine-spec.ts` and `process/process-utilities.ts`:

- `extractFlag(args, flag)` (`:7-14`) — value after an exact flag token.
- `getExtraArgument(obj, key)` (`:16-27`) — looks up a key in snake_case, kebab-case, or as-is,
  using `hasOwnProperty` so prototype keys can't collide. Recipes accept either naming style.
- `hasModuleInvocation(args, module)` (`:34-44`) — matches both `-m <module>` and a bare module
  token.
- `hasCliServeInvocation(args, cliName)` (`:46-49`) — finds an argv element whose *basename*
  (cross-platform, lowercased) equals the CLI name, then checks the next token is `serve`.
- `positionalAfterServe(args)` (`:52-58`) — first non-dash token after `serve`; how the model
  path is recovered from `vllm serve <model>` / `sglang serve <model>` argv.

---

## 3. How data/control flows

**Launch flow** (the main one):

```
POST /launch/:recipeId                         lifecycle-routes.ts:11
  → recipeStore.get(recipeId)                  lifecycle-routes.ts:19
  → launchState guard (409 if busy)            lifecycle-routes.ts:27
  → processManager.findInferenceProcess(port)  lifecycle-routes.ts:44   (409 if other model running)
  → launchState.markLaunching + AbortController lifecycle-routes.ts:62-63
  → EngineCoordinator.setActiveRecipe(recipe)  engine-coordinator.ts:70
      bump intentSerial, abort previous, preempt-kill
      → switchLock.withPermit(runLifecycle)    engine-coordinator.ts:85
          → findInferenceProcess               engine-coordinator.ts:146
          → killCurrent(other model)           engine-coordinator.ts:164-173
          → prepareRecipeGpuLease              engine-coordinator.ts:180, 432-477
          → launchFailureBudget.isBlocked      engine-coordinator.ts:183
          → publishLaunchProgress("launching") engine-coordinator.ts:190
          → processManager.launchModel         engine-coordinator.ts:196
              → spec.buildCommand(recipe)      process/backend-builder.ts:278 → specs/*.ts
          → waitForReady (poll spec.healthPath engine-coordinator.ts:216, 315-344
              every 2s; fail early on pid death
              with log tail)
          → budget.reset + startLivenessMonitor engine-coordinator.ts:225-231
  ← { success: true }                          lifecycle-routes.ts:75
  (ensuring: cleanup controller + launchState) lifecycle-routes.ts:77-89
```

**Evict flow**: `POST /evict` → `setActiveRecipe(null)` (`lifecycle-routes.ts:115`) → same lock,
kill current, confirm port free, release lease (`engine-coordinator.ts:151-155, 176-179`). Evict
also preempts any in-flight launch via the abort + preempt-kill at `engine-coordinator.ts:76-82`.

**Cancel flow**: `POST /launch/:recipeId/cancel` → abort per-recipe controller +
`cancelActiveLaunch()` (`lifecycle-routes.ts:103-104`) → coordinator bumps serial, aborts,
preempt-kills the spawned pid, drains the lock (`engine-coordinator.ts:364-374`). The in-flight
`runLifecycle` notices at its next `abortIfNeeded` checkpoint, relinquishes the lease, and
publishes "cancelled" (`engine-coordinator.ts:121-139`).

**Crash-outside-lifecycle flow**: liveness fiber notices pid gone → confirms port free →
releases `"llm"` GPU lease (`engine-coordinator.ts:513-533`). Recipe status on the next
`GET /recipes` flips from `running` to `stopped` because status is derived, not stored
(`recipe-routes.ts:27-33`).

**Process classification flow** (incoming, from `process/`): a foreign process on the port →
`detectEngineFromArguments(args)` (`engine-spec.ts:80-85` → each spec's `detectInvocation`) →
`extractModelPath` / `extractServedModelName` populate `ProcessInfo`
(`process/process-manager.ts:274-275`) → `isRecipeRunning` matches it against recipes.

---

## 4. Key patterns & idioms

- **Effect, for the newcomer**: an `Effect<A, E, R>` is a lazy description of a computation that
  succeeds with `A`, fails with typed error `E`, and needs context `R`. Nothing runs until a
  runtime executes it. `Effect.gen(function* () { ... })` is do-notation: `yield*` unwraps an
  Effect, and a failed Effect short-circuits the generator like a thrown exception — but typed.
  In route handlers, the Effect is executed by `effectHandler`
  (`src/http/effect-handler.ts:31-36`), which runs it on the app's `ControllerRuntime` and
  re-throws failures as JS exceptions for Hono's error middleware; `HttpStatus` typed errors
  (`src/core/errors.ts:3-15`) become HTTP responses there.
- **Route registration idiom**: `defineRoutes((app, context) => mergeRoutes(app.get(...),
  app.post(...)))`. Hono registrars mutate one shared `app`; `mergeRoutes` is pure type-level
  (see §2 routes.ts). `documentRoute` (`route-registrar.ts:8-10`) is a `hono-openapi` middleware
  that gives every route a default 200 response in the generated spec at `/api/spec`.
- **`Schema.TaggedErrorClass`**: `EngineOperationError` / `HttpStatus` are error *classes* with a
  `_tag` discriminant, so `Effect.catch` / `instanceof` can match them precisely. Contrast with
  the coordinator's *result-union* style: `setActiveRecipe` returns
  `{ ok: true } | { ok: false; error: string }` (`:24`) instead of failing, because callers want
  the error as a displayable string, not a typed channel.
- **Cancellation**: Effect interruption is *not* used for launch cancellation. Instead the
  coordinator uses web-standard `AbortController`s plus the `lifecycleIntentSerial` counter,
  checked manually at checkpoints. Reason: the things being cancelled are OS processes and HTTP
  polls driven by `Date.now()` loops, not Effect-native structures. `Effect.ensuring` (always,
  like `finally`) and `Effect.onExit` (success or failure, sees the exit) are used for cleanup
  with identity checks to avoid clobbering newer owners.
- **Semaphore as a mutex**: `Semaphore.makeUnsafe(1)` + `.withPermit(...)` is Effect's
  compare-and-swap-free mutex. "Unsafe" here means the semaphore is created synchronously outside
  an Effect — fine at class-field initialization.
- **Fibers**: `Effect.forkDetach({ startImmediately: true })` (`:543`) starts the liveness monitor
  as a daemon fiber; it's stopped by `Fiber.interrupt` and by serial-invalidation, and swallows
  all errors (`Effect.catch(() => Effect.void)`).
- **Error-channel erosion**: note `Effect.catch(() => Effect.succeed(...))` at
  `:286, :462-472, :489, :535` — the coordinator deliberately converts failures into values
  (`false`, `{ok:false,...}`) at every boundary where a route would rather show a message than
  propagate a typed error. This codebase uses `Effect.catch` (Effect v4 beta naming; v3 called
  this `catchAll`/`catchTags` depending on shape).
- **Derived state over stored state**: recipe status, "is this process ours", and current recipe
  are all recomputed from the process table on every read. The only persisted lifecycle state is
  the recipe rows themselves.
- **Dependency injection by constructor bag**: `CoordinatorDeps` makes every side effect
  replaceable (`healthProbe`, `processExists`, `livenessPollIntervalMs` at `:38-41`) — the design
  is test-ready even though tests for this file don't exist.

---

## 5. Connections

**Depends on:**

- `../models` — `RecipeStore` (SQLite), `Recipe`/`ProcessInfo`/`GpuInfo` types, `isRecipeRunning`
  and `parseRecipe` (recipe-routes, coordinator).
- `../system` — `EventManager` / `publishLaunchProgress` (SSE events), `GpuLeaseRegistry` /
  `GpuLeaseConflict` / `resolveRecipeGpuUuids` (GPU leasing shared with the speech module),
  `resolveNvidiaSmiBinary` (platform probing, `engine-coordinator.ts:568`).
- `./process` (sibling sub-slice) — `ProcessManager` (spawn/kill/find), `LaunchFailureBudget`,
  `launch-state`, `backend-builder` (which calls back into `getEngineSpec(...).buildCommand`),
  `model-runtime-defaults`, `process-utilities` (uses `detectEngineFromArguments` and
  `argument-utilities`).
- `./runtimes` (sibling sub-slice) — everything install/probe/venv-related the specs delegate to;
  `runtimes/engine-jobs.ts`, `runtime-targets.ts`, `runtime-info.ts` are the main consumers of
  `getEngineSpec`.
- `@local-studio/contracts` — event names, engine-args allowlists, system types.
- `../../core` — `errors` (HttpStatus), `validation.decodeJsonBody`, `command` (`resolveBinary`,
  `runCommandAsyncEffect`), `log-files` (`readFileTailBytes`), `logger`.
- `../../http` — `effect-handler`, `route-registrar`, `local-fetch` (health probes).

**Depended on by:**

- `src/http/app.ts:92` mounts `registerEngineRoutes`.
- `src/app-context.ts:190` constructs `EngineCoordinator` as `context.engineService`; speech
  service also receives it (`app-context.ts:215`).
- `runtime-routes.ts` and `download-routes.ts` (same directory, other slices) are merged under
  `routes.ts` and use `getEngineSpec` / `observed-process`.
- `runtimes/*` and `process/*` consume `engine-spec.ts`, `configs.ts`, and
  `argument-utilities.ts` heavily — `argument-utilities.ts` explicitly exists to keep that
  dependency acyclic.

---

## 6. How to read this code

Suggested order:

1. **`engine-spec.ts`** first — it's short and defines the vocabulary (`EngineSpec`,
   `EngineBackend`, `EngineOperationError`) everything else uses. Then skim **one** spec,
   `specs/vllm-spec.ts`, focusing on `buildCommand` and `detectInvocation`; the other three specs
   are variations on the same shape (compare `healthPath`, flag naming, and which optional hooks
   each implements).
2. **`argument-utilities.ts`** — 58 lines that make the specs' `detectInvocation` /
   `extractModelPath` readable.
3. **`lifecycle-routes.ts`** — see the HTTP surface and the two guards (launch-state busy, port
   occupied) *before* the coordinator, so you know what the coordinator can assume.
4. **`engine-coordinator.ts`** — the payoff. Read `setActiveRecipe` (`:70`) to understand the
   serial/abort preemption, then `runLifecycle` (`:91`) top to bottom as a linear script,
   checking off each `abortIfNeeded` checkpoint. Finish with `startLivenessMonitor` (`:506`) and
   the lease helpers (`:419-504`) to see how the GPU lease lifecycle mirrors the process
   lifecycle. Keep `process/launch-failure-budget.ts` and `process/launch-state.ts` open in
   tabs — they're tiny and explain the budget/state symbols.
5. **`recipe-routes.ts`** — quick; the one idea is derived status.
6. **`routes.ts`, `types.ts`, `configs.ts`** — a two-minute sweep at the end.

What to look for first: the two `409` guards in the launch route, and the
`intentSerial`/`isAborted` mechanism in the coordinator — those two decisions (reject early at
HTTP, preempt cooperatively in the coordinator) define the whole slice's concurrency model.
