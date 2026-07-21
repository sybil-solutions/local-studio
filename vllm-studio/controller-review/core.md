# Core Utilities Slice — `controller/src/core/`

Deep-read walkthrough of the eight small modules that form the shared foundation of the
Local Studio controller. All paths below are relative to `/Users/sero/projects/vllm-studio/controller`.

---

## 1. Purpose

`src/core/` is the lowest layer of the controller: it has no business logic and (with one
exception) no dependencies on the rest of the app. It provides the Effect **runtime**
that hosts the dependency-injected `AppContext`, a **typed HTTP error** used as the
failure channel across all routes, a dual-sink **logger** (console + append-only file),
**log-file management** (naming, scanning, retention, tailing) for inference-engine logs,
**secret redaction** for log lines leaving the process, **process spawning** primitives
(sync, async-with-timeout, detached) with an injectable runner interface, **request-body
validation** helpers bridging Hono and Effect Schema, and a **function-level
observability** wrapper that records call durations into a SQLite store.

---

## 2. File-by-file walkthrough

### `src/core/effect-runtime.ts` (13 lines)

The tiniest file, but it anchors the whole process.

- `ControllerRuntime` (effect-runtime.ts:8-11) — a type alias for
  `ManagedRuntime.ManagedRuntime<AppContextService, AppContextInitializationError>`. A
  `ManagedRuntime` is Effect's way of pre-building a dependency layer (`AppContextLive`)
  once and then running many effects against it without re-supplying requirements. Every
  HTTP handler eventually runs through this runtime.
- `createControllerRuntime()` (effect-runtime.ts:13) — `ManagedRuntime.make(AppContextLive)`.
  Called once at module top level in `src/main.ts:60`. The runtime is later torn down via
  `runtime.dispose()` / `runtime.disposeEffect` on SIGINT/SIGTERM (`src/main.ts:93,100`),
  which is what triggers all the `Effect.acquireRelease` cleanup inside `app-context.ts`.

### `src/core/errors.ts` (15 lines)

The single typed error that routes use to fail with a specific HTTP status.

- `HttpStatus` (errors.ts:3-6) — declared with `Schema.TaggedErrorClass`. Decode this if
  you're new to Effect: it creates an `Error` subclass whose instances carry a `_tag`
  (`"HttpStatus"`) plus schema-validated fields (`status: number`, `detail: string`).
  Because it is a *schema* error, it can also be serialized/decoded, not just thrown.
  Because it is *tagged*, Effect's `Effect.catchTag("HttpStatus", ...)` can select it out
  of a union error channel.
- `isHttpStatus` (errors.ts:8) — plain `instanceof` guard, used by the two places that
  translate failures into HTTP responses (see §3).
- `notFound` / `badRequest` / `serviceUnavailable` (errors.ts:10-15) — thin constructors.
  Only three statuses exist; anything else becomes a 500 upstream.

### `src/core/logger.ts` (140 lines)

A hand-rolled structured logger, deliberately not Effect-native: the call sites
(`logger.info(...)` etc.) are synchronous fire-and-forget so it can be used from
non-Effect code (e.g. process-manager callbacks).

- `createLogger(level, options)` (logger.ts:21) — the factory. Notable pieces:
  - **File sink setup** (logger.ts:22-32): if `options.filePath` is given, it
    `mkdirSync`s the parent and opens an append-mode `WriteStream`. Any failure is
    swallowed and logging degrades to console-only. The stream's own `"error"` event is
    deliberately ignored (logger.ts:27) so a disk error can never crash the process.
  - **Level gating** (logger.ts:34-41): numeric priorities, `shouldLog` compares against
    the configured level.
  - **Line format** (logger.ts:43-58): file lines are
    `ISO_TIMESTAMP LEVEL message {json-details}`; console lines omit the timestamp/level
    prefix (console already adds its own).
  - **Dual write** (logger.ts:60-74): `tryWrite` writes to the file stream *and* invokes
    the optional `onLine` callback — both wrapped in try/catch so a subscriber exception
    can't kill logging. `onLine` is how log lines reach the SSE event bus (see §3).
  - **Graceful shutdown** (logger.ts:76-103): the interesting Effect part.
    `Effect.callback` bridges the stream's `"close"`/`"error"` events into an
    `Effect<void>` that resumes when the stream finishes flushing after `stream.end()`.
    The registration function returns a *canceler Effect* (logger.ts:93-96) that removes
    listeners and destroys the stream if the waiting fiber is interrupted.
    `Effect.timeoutOrElse({ duration: 2_000, ... })` (logger.ts:98-101) guarantees
    shutdown can't hang more than 2 s — on timeout it force-`destroy()`s.
- `resolveLogLevel(fallback)` (logger.ts:134-140) — reads `LOCAL_STUDIO_LOG_LEVEL`,
  validates against the four known levels, else falls back.

The one production instance is created in `src/app-context.ts:120-128` with
`Effect.acquireRelease` so `shutdown()` runs when the runtime disposes.

### `src/core/log-files.ts` (251 lines)

Pure synchronous `node:fs` utilities for the per-session inference-engine log files.
All functions are total — every failure path returns an empty value instead of throwing.

- **Naming scheme** (log-files.ts:14-16): files are `vllm_<sessionId>.log`, in either
  `<data_dir>/logs/` (primary) or the OS temp dir (fallback, used when the data dir
  isn't writable).
- `getLogCleanupDefaultsFromEnvironment()` (log-files.ts:33-56) — parses three env vars
  (`LOCAL_STUDIO_LOG_RETENTION_DAYS` default 30, `LOCAL_STUDIO_LOG_MAX_FILES` default
  200, `LOCAL_STUDIO_LOG_MAX_TOTAL_BYTES` default 1 GB) with clamping; `0` means
  "unlimited" for each dimension (encoded as `Infinity` / `MAX_SAFE_INTEGER`).
- `sanitizeLogSessionId` (log-files.ts:58-63) — strips everything outside
  `[a-zA-Z0-9._-]`. This is the path-traversal guard: a hostile `sessionId` like
  `../../etc/passwd` becomes `etcpasswd` before it's ever joined into a path.
- Path resolution (log-files.ts:65-87): `primaryLogPathFor` (creates the dir eagerly),
  `fallbackLogPathFor`, and `resolveExistingLogPath` which checks primary-then-fallback
  and returns `null` if neither exists.
- `scanLogDirectory` (log-files.ts:89-111, private) — `readdirSync` + `statSync`,
  filtered by prefix/suffix, returning `LogFileEntry { sessionId, path, mtimeMs,
  sizeBytes, source }`. Wrapped in try/catch → `[]`.
- `listLogFiles` (log-files.ts:113-130) — scans both directories, **dedupes by session
  id keeping the newest mtime** (so a session that migrated from tmp to data-dir shows
  once), sorted newest-first. This backs the `GET /logs` listing endpoint.
- `cleanupLogFiles` (log-files.ts:132-184) — three-pass retention, oldest-first:
  1. age-based deletion (log-files.ts:158-161),
  2. file-count cap after recomputing survivors (log-files.ts:163-170),
  3. total-bytes cap, deleting oldest until under budget (log-files.ts:172-181).
  `excludePaths` lets the caller protect files currently being written (the process
  manager passes the active session's log path, `process-manager.ts:488-490`). Deletion
  is best-effort (`safeUnlink`, log-files.ts:149-156). Note `deletedPaths.includes`
  makes the survivor recomputation O(n²) — fine at ≤100k files, but worth knowing.
- `readFileTailBytes` (log-files.ts:186-205) — reads the last `maxBytes` of a file via
  `openSync`/`readSync` at a negative offset. Used by the engine coordinator to grab the
  tail of a crashed engine's log for diagnostics.
- `tailFileLines` (log-files.ts:207-251) — the clever one. Reads **backwards in 64 KB
  chunks** (log-files.ts:222-240), counting `0x0A` bytes, and stops as soon as it has
  `limit + 1` newlines or hits `maxBytes` (default 10 MB, log-files.ts:210). So tailing
  the last 200 lines of a 2 GB log touches at most ~10 MB of I/O. Chunks are reversed,
  concatenated, split on `\r?\n`, and the trailing empty element is popped
  (log-files.ts:242-247).

### `src/core/log-redaction.ts` (80 lines)

One exported pure function, `redactLogLine(line)` (log-redaction.ts:29-80), applying six
anchored regex substitutions in sequence. The module header (log-redaction.ts:1-8) states
the contract: **raw log files on disk keep secrets; redaction happens only at the
HTTP/SSE serialization boundary**. The regexes are intentionally conservative — anchored
to known secret markers so ports, paths, and throughput numbers survive.

The six patterns, in order:
1. `Authorization: Bearer <tok>` (log-redaction.ts:33-36)
2. `X-Api-Key: <tok>` header lines (log-redaction.ts:39-42) — anchored to `^`/`[\r\n]`
   because it's applied per-line
3. Env assignments `KEY=value` / `export KEY=value` for explicit names (`HF_TOKEN`,
   `OPENAI_API_KEY`, …) plus generic `*_API_KEY` / `*_TOKEN` (log-redaction.ts:46-54);
   handles quoted values
4. JSON-ish pairs `"api_key": "..."` / `'token': '...'`, preserving quote style via
   backreference `\2` (log-redaction.ts:58-61)
5. CLI long flags `--api-key <v>`, `--hf-token <v>`, `--token <v>`, etc.
   (log-redaction.ts:64-71)
6. URL query params `?api_key=...&token=...` (log-redaction.ts:74-77)

The shared `TOKEN` fragment (log-redaction.ts:16) is `[^\s;,"']+` — a token stops at
separators so surrounding log punctuation isn't eaten. Replacement is always
`[redacted]`, keeping the key/flag visible.

### `src/core/command.ts` (250 lines)

The process-spawning toolkit. Three layers, plus binary resolution.

**Layer 1 — injectable runner** (command.ts:21-62):
- `SpawnedProcess` / `ProcessRunner` interfaces (command.ts:21-34) abstract `spawnSync` /
  `spawn` so the process manager can be tested with a fake runner
  (`buildProcessManager(..., runner = realProcessRunner)`, `process-manager.ts:193`).
- `realProcessRunner.runSync` (command.ts:37-55) — `spawnSync` wrapper that never throws:
  spawn errors become `{ status: null, stdout: "", stderr: message }`.
- `realProcessRunner.spawnDetached` (command.ts:56-61) — `spawn(..., { detached: true })`
  so inference engines form their own process group and survive controller restarts;
  `stdio` is either `["ignore","pipe","pipe"]` or `"ignore"`. Note it does **not** call
  `unref()` itself — the interface exposes `unref()` (command.ts:28) and callers decide.

**Layer 2 — Effect wrappers**:
- `runCommandEffect` (command.ts:100-105) — trivial `Effect.sync` around `runSync`, for
  quick probes (`--version` checks).
- `runCommandAsyncEffect` (command.ts:107-215) — the workhorse; ~25 call sites. Read it
  as a state machine inside `Effect.callback`:
  - **Output bounding**: `boundedTail` (command.ts:93-98) keeps only the *last*
    `maxOutputBytes` (default 256 KB, command.ts:84) of stdout and stderr. This is a
    deliberate memory backpressure policy: a runaway `pip install` can't OOM the
    controller, but you lose the *beginning* of the output.
  - **Timeout & kill ladder**: the timer at command.ts:164-167 sets `timedOut` and calls
    `terminate` (command.ts:143-163): `SIGTERM` → after 5 s (`TIMEOUT_KILL_GRACE_MS`)
    `SIGKILL` → after another 5 s (`TERMINATION_CONFIRM_GRACE_MS`) give up and complete
    with `exitConfirmed: false` and `CommandTerminationError`'s message as stderr.
    Callers (e.g. `speech/runtime.ts`) import `CommandTerminationError` to detect this.
  - **Settling**: `complete` (command.ts:134-142) is idempotent (`settled` flag), clears
    all timers, detaches the abort listener, and resumes the callback with
    `Effect.succeed` — note failures like spawn `"error"` (command.ts:181-189) are
    reported as *data* (`status: null`), not as Effect failures. The error channel of
    this Effect is effectively empty.
  - **External cancellation**: an optional `AbortSignal` (command.ts:200-201) triggers
    the same kill ladder — used by SSE log routes to kill `docker logs` when the client
    disconnects.
  - **Interruption safety**: the registration function returns a canceler Effect
    (command.ts:202-214) — if the surrounding fiber is interrupted, it terminates the
    child and waits for `"close"`, dying with `CommandTerminationError` if the child
    won't die within 10 s.
  - `onSpawn` / `onOutput` hooks (command.ts:77-78) let callers capture the
    `ChildProcess` or stream chunks live.

**Layer 3 — binary resolution** (command.ts:217-250):
- `binarySearchPath` (command.ts:232-241) builds a PATH from
  `LOCAL_STUDIO_RUNTIME_BIN` (or `./runtime/bin` under Snap, command.ts:217-219), the
  ambient `PATH` (with quotes stripped per entry, command.ts:230), and
  `~/.local/bin`, `~/bin` (command.ts:221-228) — needed because GUI-launched controllers
  often have a minimal PATH.
- `resolveBinary` (command.ts:246-250) — explicit paths (containing `/` or `\`) are
  resolved absolutely first; otherwise delegates to `Bun.which` with the augmented PATH.
  (`Bun.which` makes this file Bun-only, which is fine — the controller only runs on Bun.)

### `src/core/validation.ts` (26 lines)

Bridges Hono request objects into Schema-decoded values inside the Effect error channel.

- `readJsonBody` (validation.ts:6-10) — `Effect.tryPromise` around `ctx.req.raw.json()`.
  Two subtleties: (a) a JSON *parse* failure is mapped to `badRequest("Invalid payload")`,
  but then `Effect.catch(() => Effect.succeed({}))` **swallows that failure and yields
  `{}`** — so a missing/malformed body becomes an empty object, and it's the *schema*
  decode that actually rejects it. (b) `Effect.catch` with a predicate-less function is
  the effect@4 name for `catchAll`.
- `decodeJsonBody` (validation.ts:12-19) — `Schema.decodeUnknownEffect(schema)` then
  `mapError(() => badRequest("Invalid payload"))`. Every validation failure collapses to
  the same generic 400 (deliberate: no schema internals leak to clients).
- `parseBooleanFlag` (validation.ts:21-26) — lenient query/env boolean:
  `"1"/"true"/"yes"/"on"` (case-insensitive) are true, everything else false. Used for
  env config (`config/env.ts:8`) and query params (`modules/models/routes.ts:44`).

### `src/core/function-observability.ts` (54 lines)

The only core file that imports from outside (`../app-context`), which is why it sits at
the top of the intra-slice dependency order.

- `observeControllerFunction(context, functionName, call)` (function-observability.ts:17-46)
  — a decorator for Effects. `Effect.suspend(call)` defers running `call` so the
  `performance.now()` timestamp is taken lazily inside the effect, not at call time.
  `Effect.onExit` runs a finalizer on success *or* failure: success records
  `{ function_name, duration_ms, success: true }`; failure extracts the first
  `Cause.prettyErrors` entry (function-observability.ts:34) and also records
  `error_class` / `error_message`. Both writes go to
  `context.stores.controllerRequestStore.recordFunctionCallEffect(...)` and are wrapped
  in `Effect.ignore` (function-observability.ts:32,43) — telemetry can never fail the
  observed operation. The wrapped effect's `A, E, R` type parameters pass through
  unchanged, so it's transparent at call sites.
- `findObservedInferenceProcess(context, label)` (function-observability.ts:48-54) — a
  pre-baked instance for the most common observation: probing whether an inference
  process listens on `config.inference_port`. The `label` (e.g. `"logs"`, `"metrics"`)
  namespaces the recorded function name as `<label>.findInferenceProcess`. Used by five
  route modules.
- Duplication note: `errorClass`/`errorMessage` (function-observability.ts:8-15) are
  near-copies of the ones in `src/http/observability-middleware.ts:20-29` — the
  middleware version additionally special-cases `HttpStatus`.

---

## 3. How data/control flows

**A. HTTP request → typed failure → HTTP response.** A route handler runs inside
`effectHandler` (`src/http/effect-handler.ts:31-36`), which calls
`runtime.runPromiseExit` (effect-handler.ts:24). On failure it pulls the first
`HttpStatus` out of the `Cause` (effect-handler.ts:26-28) and *throws* it, so Hono's
`onError` in `src/http/app.ts:132-135` can pattern-match with `isHttpStatus` and emit
`{ detail }` with the right status. So `errors.ts` values travel: created in routes →
Effect error channel → unwrapped to a thrown JS exception → Hono error handler → JSON.

**B. Body validation.** `POST /x` → route calls `decodeJsonBody(ctx, SomeSchema)`
(validation.ts:12) → raw `Request.json()` → `{}` on parse failure → Schema decode →
either the typed value or `Effect.fail(badRequest(...))` → flows into flow A as a 400.

**C. Logging pipeline.** Any module calls `logger.info(msg, details)` → console + append
to `<data_dir>/logs/vllm_controller.log` + `onLine` callback →
`eventManager.publishLogLineUnsafe("controller", line)` (`app-context.ts:124`) → SSE
`/events` subscribers. Inference-engine logs bypass the logger: engines write their own
`vllm_<session>.log` files, and `logs-routes.ts` serves them via `tailFileLines` →
`redactLogLine` → JSON or SSE (`logs-routes.ts:280-286, 347-351`). **Redaction is applied
only at that last step** — disk files stay raw.

**D. Command execution.** e.g. GPU probe: `amd-gpu.ts` → `runCommandAsyncEffect("rocm-smi",
args, { timeoutMs })` → `spawn` → chunks appended via `boundedTail` → on close, complete
with `{ status, stdout, stderr, timedOut, signal }` → caller inspects `status`/`timedOut`.
Client-disconnect kills: SSE route passes `ctx.req.raw.signal` as `AbortSignal` → abort →
SIGTERM/SIGKILL ladder (`command.ts:143-167, 200-201`).

**E. Process lifecycle (detached engines).** `process-manager.ts:507` →
`runner.spawnDetached(entry, args, { env, stdio: "pipe" })` → returns a `SpawnedProcess`
whose stdout/stderr streams the manager tees into the session log file (written by
`log-files.ts` naming) → PID tracked in `ownedProcessGroups` for later eviction.

**F. Boot/shutdown.** `main.ts:60` `createControllerRuntime()` → `ManagedRuntime` builds
`AppContextLive` (which acquires the logger, stores, etc. via `Effect.acquireRelease`) →
`runtime.runFork(program)` (main.ts:86) → on SIGINT: `Fiber.interrupt(fiber)` then
`runtime.disposeEffect` (main.ts:99-101) → finalizers run in reverse acquisition order,
including `logger.shutdown()`'s flush-with-2s-timeout.

**G. Function observability.** Route code wraps a probe:
`findObservedInferenceProcess(context, "metrics")` → `observeControllerFunction` times it
→ on exit, fire-and-forget insert into the `controllerRequestStore` SQLite table → read
back by usage/observability endpoints.

---

## 4. Key patterns & idioms

- **Effect for newcomers**: an `Effect<A, E, R>` is a lazy description of a computation
  producing `A`, failing with `E`, needing environment `R`. Nothing runs until a runtime
  executes it. In this slice you'll repeatedly see:
  - `Effect.sync(thunk)` — wrap an impure synchronous call (command.ts:105).
  - `Effect.tryPromise / Effect.try` — wrap async/throwing code with a typed `catch`
    mapper (validation.ts:7, logs-routes usage).
  - `Effect.callback` — bridge event-emitter APIs into Effects; the registration
    function receives `resume` and **returns a canceler Effect** run on interruption
    (logger.ts:78-96, command.ts:112-214). This is the codebase's main interop idiom.
  - `Effect.timeoutOrElse({ duration, orElse })` — deadline without failing
    (logger.ts:98, command.ts:209).
  - `Effect.onExit` — finalizer that sees success/failure (function-observability.ts:24).
  - `Effect.suspend` — defer effect *construction* (function-observability.ts:23).
  - `Effect.ignore` — discard result and swallow failures (telemetry writes).
  - `Effect.catch(fn)` — effect@4's `catchAll` (validation.ts:10).
  - `Effect.acquireRelease(acquire, release)` — scoped resource; release runs on scope
    close (app-context.ts:120-128). The `ManagedRuntime` owns the root scope.
- **`Schema.TaggedErrorClass`** — one declaration gives you: Error subclass, `_tag`
  discriminant, schema validation, and serializability. `HttpStatus` (errors.ts:3) is the
  canonical example; the same pattern is used for domain errors elsewhere in the app.
- **ManagedRuntime as app-wide DI**: dependencies are built once at boot
  (effect-runtime.ts:13); request handlers pull the runtime from Hono context
  (`c.get("controllerRuntime")`) and `runPromiseExit` their per-request effects
  (effect-handler.ts:13-29).
- **Errors as values vs. data**: routes fail with typed `HttpStatus` in the `E` channel,
  but `runCommandAsyncEffect` reports failures as *success data* (`status: null`,
  `timedOut: true`) — callers must inspect the result, and the `E` channel stays empty.
  Two different philosophies; watch which one a function uses.
- **Dependency injection by interface**: `ProcessRunner`/`SpawnedProcess`
  (command.ts:21-34) let tests substitute a fake runner; production default is a
  parameter default (`runner = realProcessRunner`).
- **Total, best-effort utilities**: every fs/process helper here swallows errors into
  empty strings/arrays/`null` (log-files.ts, command.ts runSync) — the philosophy is that
  diagnostics and cleanup must never crash the controller. The flip side: silent failure
  is the norm; check return values, not exceptions.
- **Bounded memory by design**: `boundedTail` for process output, `tailFileLines`'s
  backward capped read, the 2 s logger shutdown timeout, the SIGTERM→SIGKILL ladder —
  this slice is where the codebase's resource-safety policies live.
- **Sync logger in an async world**: `logger.*` methods are plain void functions so they
  can be called from event handlers and non-Effect code; only `shutdown()` is an Effect.
- **Security boundaries**: `sanitizeLogSessionId` (path traversal), `redactLogLine`
  (secret exfiltration via logs), generic `badRequest("Invalid payload")` (no schema
  leakage) — all three are single-purpose chokepoints worth remembering.

---

## 5. Connections

**Depends on (outside the slice):**
- `../app-context` — `effect-runtime.ts` (imports `AppContextLive`) and
  `function-observability.ts` (imports the `AppContext` type for the stores). This makes
  those two files the top of the slice; everything else in `core/` is import-free of the
  app.
- `effect` (`ManagedRuntime`, `Schema`, `Effect`, `Cause`, `Exit`), `node:fs`,
  `node:child_process`, `node:path`, `node:os`, and `Bun.which` (Bun-only API in
  command.ts:248-249).

**Depended on by:**
- `src/main.ts` — `createControllerRuntime`, `parseBooleanFlag`.
- `src/app-context.ts` — `createLogger`, `resolveLogLevel`, `primaryLogPathFor`.
- `src/http/app.ts`, `src/http/effect-handler.ts`, `src/http/observability-middleware.ts`
  — `ControllerRuntime`, `isHttpStatus`.
- Nearly every route module (`modules/engines/*`, `modules/system/*`, `modules/models/*`,
  `modules/proxy/*`, `modules/studio/*`, `modules/audio/*`, `modules/speech/*`) —
  `badRequest`/`notFound`/`serviceUnavailable`, `decodeJsonBody`, `parseBooleanFlag`,
  `findObservedInferenceProcess`, `observeControllerFunction`.
- `modules/engines/process/process-manager.ts` — the heaviest consumer: `Logger`,
  `ProcessRunner`/`realProcessRunner`/`SpawnedProcess`, log path + cleanup functions.
- GPU/platform probes (`modules/system/platform/*.ts`), runtime managers
  (`modules/engines/runtimes/*.ts`), audio (`services/tts.ts`, `services/stt.ts`,
  `modules/speech/*`) — `resolveBinary`, `runCommandEffect`, `runCommandAsyncEffect`,
  `CommandTerminationError`.
- `modules/system/logs-routes.ts` — all of log-files.ts and log-redaction.ts.

**Tests:** no `*.test.ts` exists under `src/core/`. The controller's four test files
(`runtime-target-factory`, `runtime-info`, `huggingface-api`, `download-manager`) sit in
`modules/engines/`; `runtime-info.test.ts` exercises `runCommand*` indirectly through the
`ProcessRunner` seam, but the core slice itself is untested directly.

---

## 6. How to read this code

Suggested order, bottom-up by dependency:

1. **`errors.ts`** (15 lines) — learn `Schema.TaggedErrorClass` here; everything else
   assumes you know what a tagged error is.
2. **`validation.ts`** — see the tagged error used in an Effect pipeline, plus the
   `Effect.tryPromise` + `catch` idiom.
3. **`logger.ts`** — your first `Effect.callback` bridge; note the sync-call-site design
   and the canceler + `timeoutOrElse` shutdown.
4. **`effect-runtime.ts`** + skim `src/http/effect-handler.ts` and `src/main.ts:60-101` —
   understand `ManagedRuntime`, `runPromiseExit`, and where failures become thrown
   exceptions. This is the conceptual key to the whole controller.
5. **`command.ts`** — the meatiest file. Read the types (21-34), then `runSync`, then
   trace one full `runCommandAsyncEffect` execution including timeout and interrupt paths,
   then the PATH-resolution tail.
6. **`log-files.ts`** — straightforward fs code; pay attention to `sanitizeLogSessionId`,
   the dedup rule in `listLogFiles`, and the backward read in `tailFileLines`.
7. **`log-redaction.ts`** — read alongside `modules/system/logs-routes.ts:280-286` to see
   *where* it's applied; the regexes themselves are secondary to the "redact at the
   boundary, never on disk" contract.
8. **`function-observability.ts`** — read last, once `AppContext` and the stores make
   sense; then compare with `src/http/observability-middleware.ts` to see the request-level
   twin.

First things to look for in any new file of this slice: (a) does it report errors in the
Effect `E` channel, as result data, or swallow them? (b) is there a canceler/finalizer,
and what does it guarantee? (c) what is the resource bound (bytes, time, file count)?
