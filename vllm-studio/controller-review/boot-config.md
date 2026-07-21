# Controller Review — boot + config slice

Scope: `src/main.ts`, `src/app-context.ts`, `src/config/env.ts`, `src/config/persisted-config.ts`
(all paths below are relative to `/Users/sero/projects/vllm-studio/controller`)

## 1. Purpose

This slice is everything that happens before the first HTTP request is served and everything
that decides *how* the process is configured. It resolves environment/persisted configuration
(with a fail-fast auth guard), builds the shared `AppContext` (logger, event bus, eight SQLite
stores, engine/download/speech services) as an Effect `Layer` with deterministic teardown
order, boots the Hono server under `Bun.serve`, forks the metrics collector, and wires
SIGINT/SIGTERM to a graceful, finalizer-driven shutdown.

## 2. File-by-file walkthrough

### `src/main.ts` (105 lines) — process lifecycle

- `ControllerStartupError` (`main.ts:9-12`) — a `Schema.TaggedErrorClass`, Effect-4's idiom for
  typed errors. It doubles as a runtime value (`new ControllerStartupError({...})`) and a
  Schema (decodable/serializable). `startupError()` (`main.ts:14-15`) is the constructor helper.
- `metricsDisabled()` (`main.ts:17-18`) — reads `LOCAL_STUDIO_DISABLE_METRICS` through
  `parseBooleanFlag` (`src/core/validation.ts:21-26`, accepts `1/true/yes/on`).
- `logBootSummary()` (`main.ts:20-41`) — after the server is up, detects the GPU monitoring
  tool and logs one line with listen address, data dir, db path, models-dir state, auth mode,
  and GPU tool. Note it logs only `api-key` vs `unauthenticated` (`main.ts:26`) — the key
  itself is never logged (redaction-by-omission).
- `serve()` (`main.ts:43-58`) — `Effect.try` around `createApp(context, runtime)` +
  `Bun.serve`. `idleTimeout: 120` (`main.ts:54`) matters: it keeps long-lived SSE and streaming
  chat-completion connections from being killed by Bun's default (~10 s) idle timeout.
- Module-level boot (`main.ts:60-86`):
  - `createControllerRuntime()` (`main.ts:60`) builds a `ManagedRuntime` over `AppContextLive`
    (`src/core/effect-runtime.ts:13`). The layer is built lazily — nothing runs yet.
  - `program` (`main.ts:61-85`) is `Effect.scoped(Effect.gen(...))`. Key steps:
    1. `yield* AppContextService` (`main.ts:63`) — forces the `AppContextLive` layer to build
       inside this scope (all stores/services constructed).
    2. `Effect.forkScoped(startMetricsCollector(context))` (`main.ts:67`) — the metrics loop is
       a child fiber whose lifetime is bound to the scope; closing the scope interrupts it.
    3. `Effect.acquireRelease(serve(...), release)` (`main.ts:69-80`) — the Bun server is a
       scoped resource. Its finalizer calls `server.stop()` and, via `Effect.catch`, *logs
       instead of propagating* a stop failure — a shutdown must never throw.
    4. `yield* Effect.never` (`main.ts:83`) — parks the program forever; the process lives
       until interrupted.
- Failure path (`main.ts:89-94`) — `fiber.addObserver` watches the root fiber. On any
  non-success `Exit` (and not already shutting down), it prints `Cause.pretty(exit.cause)` —
  Effect's structured error/cancellation/interruption trace — disposes the runtime, exits 1.
- Signal path (`main.ts:96-105`) — `shutdown()` is idempotent (`shuttingDown` flag), interrupts
  the root fiber (`Fiber.interrupt` triggers scope closure, which runs *all* finalizers in
  reverse acquisition order), then `runtime.disposeEffect`, then `process.exit(0)`. Registered
  for both SIGINT and SIGTERM.

### `src/app-context.ts` (251 lines) — dependency assembly as an Effect Layer

- `AppContext` interface (`app-context.ts:34-55`) — the single bag of shared dependencies:
  `config`, `logger`, `eventManager`, engine machinery (`launchState`, `launchFailureBudget`,
  `processManager`, `downloadManager`, `engineService`, `gpuLeaseRegistry`), `speechService`,
  and `stores` (eight SQLite-backed stores, all sharing one db file).
- `AppContextInitializationError` (`app-context.ts:57-64`) — same TaggedErrorClass idiom;
  every boot failure gets an `operation` tag (e.g. `"recipe-store.open"`).
- **Module-global `modelsDirectoryState`** (`app-context.ts:66-70`) — mutable module-level
  variable written during layer build and read later by `main.ts`'s boot summary. A hidden
  side-channel; see "noteworthy" below.
- Error-wrapping helpers (`app-context.ts:72-85`) — `initialize` (for Effects) and
  `initializeSync` (for plain throws) tag any failure with an operation name, so a boot crash
  says *what* was being constructed.
- `releaseSafely()` (`app-context.ts:87-96`) — the standard finalizer wrapper: run the cleanup
  effect, and on error just `logger.error(...)`. Every finalizer in this file uses it (except
  the logger's own, which has nothing to log to yet... it uses the raw `resource.shutdown()`).
- `ensureModelsDirectory()` (`app-context.ts:98-107`) — non-fatal mkdir: returns
  `"exists" | "created" | "missing"` instead of failing; `main.ts` and the warning at
  `app-context.ts:134-138` turn `"missing"` into a logged warning, not a crash.
- `makeAppContext` (`app-context.ts:109-245`) — the heart of the slice. Build order, each step
  annotated with its resource-cleanup registration:
  1. Config load (`:110`) — plain sync call wrapped by `initializeSync`.
  2. Data dir mkdir (`:111-117`) — fatal if it fails.
  3. `EventManager` constructed directly (`:119`) — a plain class, not effectful.
  4. Logger via `acquireRelease` (`:120-128`) — file logger at
     `primaryLogPathFor(config.data_dir, "controller")`; the `onLine` callback forwards every
     line into `eventManager.publishLogLineUnsafe`, which is how log lines reach SSE clients.
  5. EventManager shutdown registered *after* the logger (`:129-131`) — finalizers run in
     reverse order, so the event bus dies before the logger; the logger survives to the very
     end of shutdown. This ordering is deliberate and worth noticing.
  6. Eight stores, each `acquireRelease`'d (`:140-171`) — all opened against the same resolved
     `dbPath` (`:118`). Two open styles coexist: `RecipeStore.open`/`DownloadStore.make` return
     Effects (wrapped with `initialize`), the rest are sync constructors (wrapped with
     `initializeSync`).
  7. `lifetimeMetricsStore.ensureFirstStartedEffect()` (`:172-175`) — one-time DB seed of the
     "first started" timestamp.
  8. Engine machinery (`:177-207`) — `launchState`, `launchFailureBudget`, `gpuLeaseRegistry`,
     `processManager`, `downloadManager`, `EngineCoordinator` (the facade other modules call
     `engineService`). Note the `Effect.acquireRelease(Effect.void, ...)` trick at `:187-189`
     and `:202-204`: acquiring `void` purely to *register a finalizer* for module-level
     singletons (`shutdownRuntimeInfo`, `shutdownEngineJobs`) at a precise point in the
     teardown sequence.
  9. `SpeechService` (`:208-221`) — constructed last because it depends on the engine
     coordinator and GPU leases.
  10. Returns the record `satisfies AppContext` (`:223-244`).
- `AppContextService` (`app-context.ts:247-249`) — `Context.Service<...>()("local-studio/AppContext")`
  creates the Effect *service tag*: a key in Effect's dependency-injection context. Route
  handlers `yield* AppContextService` to get this bag.
- `AppContextLive` (`app-context.ts:251`) — `Layer.effect(AppContextService, makeAppContext)`:
  a Layer is a recipe for building a service; because `makeAppContext` uses scoped
  acquisition, the Layer also carries the full teardown program. `ManagedRuntime.make` in
  `core/effect-runtime.ts` is the only consumer.

### `src/config/env.ts` (182 lines) — environment → `Config`

- `Config` interface (`env.ts:12-28`) — listen/inference addresses, paths, optional engine
  binary overrides, `strict_openai_models`, and `providers: ProviderConfig[]`.
- `loadDotEnvironment()` (`env.ts:30-42`) — looks for `.env` in cwd, its parent, and its
  grandparent; first hit wins. Lets you run from the repo root *or* the controller package.
- `defaultModelsDirectory()` (`env.ts:44-45`) — `/models` on POSIX (container-friendly),
  `~/models` on Windows.
- `createConfig()` (`env.ts:47-182`) — the resolution pipeline, in precedence order:
  1. **Path anchoring** (`:50-53`) — defaults are anchored to the package root via
     `fileURLToPath(import.meta.url)`, so `data_dir` lands at `<repo>/data` regardless of cwd.
  2. **CORS parsing** (`:60-87`) — `normalizeOrigin` reduces each entry to `new URL(v).origin`
     (drops paths, rejects `"null"` origins); defaults are localhost:3000/3001 plus
     `host.docker.internal` variants; deduped via `Set`.
  3. **Schema validation** (`:89-125`) — an `environmentSchema` (`Schema.Struct`) with
     `positiveIntegerSchema` (`:10`) for both ports. Defaults are merged into the raw env map
     *before* decoding, so required fields in the schema actually mean "must exist after
     defaults". `Schema.decodeUnknownSync` **throws synchronously** on bad input (e.g.
     `LOCAL_STUDIO_PORT=abc` → `NaN` → fails the int check); the throw is caught upstream by
     `initializeSync` in app-context.
  4. **Auth guard** (`:155-160`) — fail-fast: binding to a non-loopback host without
     `LOCAL_STUDIO_API_KEY` throws, unless `LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true`. This is
     the one hard security invariant of the boot sequence.
  5. **Engine overrides** (`:162-170`) — optional python/binary paths for SGLang, llama.cpp,
     MLX; only set on the config if present.
  6. **Persisted overlay** (`:172-179`) — `studio-settings.json` is loaded *last* and
     overrides `models_dir` and `providers`. So precedence for `models_dir` is:
     persisted settings > env var > default. (This means a value changed via the settings API
     survives an env var on the next boot.)
- Also exported: `ProviderConfig` is re-exported indirectly — routes import it from
  `persisted-config.ts` directly.

### `src/config/persisted-config.ts` (82 lines) — `studio-settings.json`

- `ProviderConfig` (`persisted-config.ts:11-17`) — remote provider entries **including
  plaintext `api_key`**. Mitigation is filesystem permissions, not encryption (see below).
- `PersistedConfig` (`persisted-config.ts:19-23`) — `models_dir`, `providers`, and
  `selected_runtime_target_ids` (per-runtime chosen build/target for vllm/sglang/llamacpp/mlx).
- `getPersistedConfigPath()` (`:25-27`) — always `<data_dir>/studio-settings.json`.
- `loadPersistedConfig()` (`:29-41`) — total swallow: missing file, unreadable file, or
  corrupt JSON all return `{}`. Boot never fails because of this file — but corruption also
  silently resets settings (the comment at `:69-71` calls this out).
- `savePersistedConfig()` (`:47-82`) — read-modify-write merge with a deletion protocol:
  passing `null` for a key *deletes* it (`:60-63`), `undefined` leaves it untouched
  (`:64-66`). Then:
  - `mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })` (`:68`)
  - **Atomic write** (`:72-74`): write to `studio-settings.json.tmp-<pid>`, then `renameSync`
    over the target. A crash mid-write can never leave a truncated file at the real path.
  - **Permission hardening** (`:75-80`): `chmod` dir `0o700`, file `0o600` (protects the
    plaintext provider keys), wrapped in try/catch for filesystems that don't support chmod.

## 3. How data/control flows

**Boot (happy path):**
`main.ts:60` creates the `ManagedRuntime` → `main.ts:86` `runFork(program)` →
`main.ts:63` `yield* AppContextService` triggers `AppContextLive`
(`app-context.ts:251`) → `makeAppContext` (`app-context.ts:109`): config (`env.ts:47`,
itself reading `persisted-config.ts:29`) → data dir → logger + event manager → models dir →
8 stores → engine/download/speech services → context record. Back in `main.ts`: metrics
collector forked (`main.ts:67`) → Hono app + `Bun.serve` acquired (`main.ts:69-80` via
`http/app.ts:42`) → boot summary logged (`main.ts:82`) → `Effect.never` parks.

**Graceful shutdown:**
SIGINT/SIGTERM (`main.ts:104-105`) → `shutdown()` (`main.ts:96`) → `Fiber.interrupt(fiber)`
→ the `Effect.scoped` at `main.ts:61` closes → finalizers run in **reverse acquisition
order**: speech service → engine jobs → engine coordinator → runtime-info → stores (rig …
recipe) → event manager → logger → server stop → metrics fiber interrupted →
`runtime.disposeEffect` → `process.exit(0)`.

**Boot failure:**
any `initialize*` step fails → layer build fails → root fiber exits with
`ControllerStartupError`/`AppContextInitializationError` → observer at `main.ts:89-94` prints
`Cause.pretty` (shows the `operation` tag, e.g. `"recipe-store.open"`) → exit 1.

**Config resolution:**
`.env` search (`env.ts:30`) → defaults merged (`env.ts:115-125`) → Schema decode (throws on
bad ports) → auth guard (`env.ts:155`) → persisted JSON overlay (`env.ts:172`,
`persisted-config.ts:29`).

**Runtime settings writes (neighbor modules):**
studio routes (`modules/studio/routes.ts:145`, `modules/studio/provider-routes.ts:54`) and
runtime-target selection (`modules/engines/runtimes/runtime-targets.ts:501-502`) call
`savePersistedConfig`; the new `models_dir`/providers are re-read from disk at next boot by
`env.ts:172-179`.

## 4. Key patterns & idioms

- **Effect 101 for this slice**: an `Effect<A, E, R>` is a lazy description of a computation
  producing `A`, failing with `E`, needing services `R`. Nothing runs until `runFork`/
  `runPromise`. `Effect.gen(function* () { ... })` is do-notation; `yield* X` runs `X`.
- **`Effect.scoped` + `Effect.acquireRelease`** is RAII: resources acquired inside the scope
  get their release effects run on scope exit (success, failure, or interruption), in reverse
  order. The entire controller's teardown logic is encoded by *acquisition order in
  `makeAppContext`* — read that file top-to-bottom to learn build order, bottom-to-top to
  learn teardown order.
- **`Layer`/`Context.Service`** is dependency injection: `AppContextService` is the key,
  `AppContextLive` the factory, `ManagedRuntime` the container that memoizes the built layer
  and hands it to every request handler (`http/effect-handler.ts:6` types all route effects as
  requiring `AppContextService`).
- **`Schema.TaggedErrorClass`** gives typed, pattern-matchable errors with a `_tag` field —
  this codebase's replacement for `class X extends Error`.
- **Finalizer safety**: `releaseSafely` (`app-context.ts:87`) embodies the rule "cleanup never
  throws"; errors during shutdown are logged and swallowed.
- **`Effect.acquireRelease(Effect.void, finalizer)`** (`app-context.ts:187, 202`) — registering
  a teardown hook with no resource, purely for ordering.
- **Fail-fast validation at the boundary**: config is decoded through a Schema at process
  start (`env.ts:115`), so the rest of the codebase can trust `Config` types.
- **Atomic file writes**: write-tmp-then-rename (`persisted-config.ts:72-74`) — the standard
  crash-safety idiom.
- **dotenv discovery up the tree** (`env.ts:30-42`) and **import.meta anchoring**
  (`env.ts:52`) make the process cwd-independent.

## 5. Connections

**Depends on (outbound):**
- `main.ts` → `app-context`, `core/effect-runtime`, `core/validation` (`parseBooleanFlag`),
  `http/app` (`createApp`), `modules/system/metrics-collector` (`startMetricsCollector`),
  `modules/system/platform/gpu` (`detectGpuMonitoringTool`).
- `app-context.ts` → `config/env`, `core/logger`, `core/log-files`, and most of `modules/`
  (engine coordinator/process/download machinery, event manager, GPU leases, metrics stores,
  speech service) plus all eight `stores/`.
- `env.ts` → `dotenv`, `config/persisted-config`, `core/validation`.
- `persisted-config.ts` → `node:fs` only (leaf module).

**Depended on by (inbound):**
- `core/effect-runtime.ts:13` — wraps `AppContextLive` into the `ManagedRuntime` shared by
  `main.ts` and the HTTP layer (`controllerRuntimeMiddleware` in `http/app.ts:49` lets every
  request run Effects against the same memoized context).
- `http/effect-handler.ts:6` — `ControllerEffect` requires `AppContextService`; every route
  module consumes the context through it.
- `env.ts`'s `Config` is read by ~30 modules (engine specs, proxy, security middleware,
  metrics, etc.).
- `persisted-config.ts` is written by `modules/studio/routes.ts`, `modules/studio/provider-routes.ts`,
  and `modules/engines/runtimes/runtime-targets.ts`.

**Tests:** none — no `*.test.ts` exists for `main`, `app-context`, `env`, or
`persisted-config` in this repo (verified by glob).

## 6. How to read this code

1. **`src/config/persisted-config.ts` first** — 82 lines, zero dependencies, one clever trick
   (atomic rename). It teaches you what state survives restarts.
2. **`src/config/env.ts` next** — read `createConfig` top to bottom as a precedence pipeline:
   defaults → env → schema validation → auth guard → persisted overlay. The auth guard at
   `:155` is the one must-not-miss detail.
3. **`src/app-context.ts`** — read `makeAppContext` (`:109`) as two programs in one: build
   order top-down, teardown order bottom-up. Before diving in, understand
   `Effect.acquireRelease` and `releaseSafely` (`:87`); everything else is repetition of that
   one pattern across ~15 resources.
4. **`src/main.ts` last** — with the Layer mental model loaded, the whole file reduces to:
   build runtime → run scoped program → park on `Effect.never` → two exit paths (observer for
   failure, signal handler for shutdown). Check your understanding by tracing what
   `Fiber.interrupt` sets in motion.

First things to look for in any new file of this codebase afterward: the `TaggedErrorClass`
definitions, which `acquireRelease` pairs exist (that tells you the resource lifecycle), and
whether a module takes `AppContext` as a plain function argument or `yield*`s
`AppContextService` (this slice uses both — the layer builds the value, `main.ts` yields it).
