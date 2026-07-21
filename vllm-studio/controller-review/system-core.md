# Code Review: `src/modules/system/` — system core slice

Scope: `routes.ts`, `event-manager.ts`, `metrics-collector.ts`, `metrics-store.ts`, `metrics-routes.ts`, `metrics-peaks.ts`, `logs-routes.ts`, `engine-metrics-scrape.ts`, `llamacpp-throughput.ts`, `gpu-leases.ts` in `/Users/sero/projects/vllm-studio/controller`. All `path:line` references below are relative to `controller/`.

## 1. Purpose

This slice is the controller's "nervous system": it owns the process-wide event bus (`EventManager`), a 5-second background metrics loop (`metrics-collector.ts`), the SQLite stores that persist lifetime and per-model peak metrics (`metrics-store.ts`), the HTTP/SSE surface for status/GPU/config/logs/metrics (`routes.ts`, `metrics-routes.ts`, `logs-routes.ts`), the scrapers that read throughput from Prometheus endpoints or llama.cpp logs (`engine-metrics-scrape.ts`, `llamacpp-throughput.ts`), and a filesystem-lock-based GPU lease registry (`gpu-leases.ts`) that arbitrates GPU ownership between the LLM engine and the speech service — including across separate OS processes.

## 2. File-by-file walkthrough

### `src/modules/system/routes.ts` (314 lines)

The HTTP entry point for the system module. Exports `registerSystemRoutes` (`routes.ts:51`), built with the codebase's `defineRoutes`/`mergeRoutes` helpers. Mounted at app root by `src/http/app.ts:91`, so paths here are served verbatim (`/status`, `/gpus`, ...).

- `checkService` (`routes.ts:52-84`) — TCP "is this port open" probe written as `Effect.callback`: it wraps `node:net.connect`, resumes exactly once via a `settled` flag, returns a cleanup effect (`Effect.sync(cleanup)`) that removes listeners and destroys the socket. Timeouts: 500 ms for `/compat`, 1 s default. This is the canonical pattern in this codebase for bridging Node callback APIs into Effect.
- `GET /status` (`routes.ts:87-102`) — returns whether an inference process is running, the observed `ProcessInfo`, `inference_port`, the currently-launching recipe id, and active launch-failure budget entries. Uses `findObservedInferenceProcess` from `core/function-observability`.
- `GET /gpus` (`routes.ts:104-110`) — thin wrapper over `getGpuInfo()` from `./platform/gpu`.
- `GET /compat` (`routes.ts:112-135`) — builds the frontend's compatibility report: observed process + runtime info + a port-open probe, fed into `buildCompatibilityReport` from `./platform/compatibility-report`.
- `POST /vram-calculator` (`routes.ts:137-235`) — the most logic-dense route. Validates the body with `VramCalculatorBodySchema` (`routes.ts:29-34`), then:
  - **Path containment check** (`routes.ts:150-155`): resolves the model path and requires it to start with `resolve(config.models_dir) + sep` — a simple traversal guard.
  - Reads the HF `config.json`, decoding it against `ModelConfigSchema` (`routes.ts:35-49`) which accepts *multiple vendor key spellings* (`num_hidden_layers`/`n_layer`/`num_layers`, `hidden_size`/`n_embd`/`d_model`/`dim`, ...). Note `ModelDimensionSchema` (`routes.ts:26`) accepts `NumberFromString` too, so quoted dimensions parse.
  - Computes KV cache bytes as `context × layers × kv_heads × head_dim × 2 (K+V) × bytes_per_value` (`routes.ts:191-196`), where fp8 KV uses 1 byte, everything else 2. Activations are a heuristic `max(0.5 GB, 10% of weights)` and overhead a flat 2 GB (`routes.ts:201-202`).
  - Divides by `tp_size` per GPU, compares against the *minimum* capacity of the first `tp_size` GPUs (`routes.ts:207-214`), returns a structured breakdown. Falls back to `fits: true` when GPU info is unavailable.
- `GET /config` (`routes.ts:237-308`) — assembles `SystemConfigResponse`: a hardcoded "Controller" service entry, inference-runtime status, a probe of the frontend on port 3000, redacted config (only `api_key_configured: Boolean`, never the key), environment URLs, and runtime info.
- Finally merges in the three sub-registrars (`routes.ts:310-313`): `registerMonitoringRoutes`, `registerLogsRoutes`, `registerUsageRoutes` (usage lives in `usage-routes.ts`, a neighbor outside this slice).

### `src/modules/system/event-manager.ts` (162 lines)

The in-process pub/sub hub. Two exports:

- `class Event` (`event-manager.ts:4-21`) — a dumb SSE-serializable record: `type`, `data`, ISO `timestamp`, and an `id` that is just `Date.now()` as a string (so ids are not unique under sub-millisecond bursts — harmless here). `toSse()` renders the `id:`/`event:`/`data:` wire format.
- `class EventManager` (`event-manager.ts:36-161`) — keyed channels (`"default"`, `"logs:<sessionId>"`), each holding an `Effect` `PubSub` plus a subscriber count. Key mechanics:
  - All channel-map mutations go through `channelsLock = Semaphore.makeUnsafe(1)` (`event-manager.ts:41`) — `makeUnsafe` builds the semaphore synchronously outside an effect; every `acquireChannel`/`releaseChannel`/`publish`/`shutdown` wraps its body in `channelsLock.withPermit(...)`.
  - `PubSub.sliding<Event>(100)` (`event-manager.ts:55`): bounded capacity 100, oldest events dropped under a slow consumer — deliberate backpressure so a stalled SSE client can't grow memory.
  - `subscribe` (`event-manager.ts:80-87`): `Effect.acquireRelease` ties the subscriber count to stream lifetime, `Stream.scoped` runs finalizers when the stream ends, and `Stream.interruptWhen(abortEffect(signal))` ends the stream when the HTTP request's `AbortSignal` fires. This is how a disconnected client tears down its subscription.
  - `publishMetrics` (`event-manager.ts:108-112`) additionally snapshots into `latestMetrics`, which backs the REST fallback in `metrics-routes.ts` via `getLatestMetrics()` (`event-manager.ts:114`).
  - `publishLogLine` (`event-manager.ts:122-127`) routes per-session logs onto `logs:<sessionId>` channels.
  - `publishLogLineUnsafe` (`event-manager.ts:129-137`) is the odd one out: a *synchronous* fire-and-forget used by the logger's `onLine` callback (`src/app-context.ts:124`) where no Effect runtime is available. It reaches into `PubSub` internals (`shutdownFlag.current`, `pubsub.slide()`) to force-drop the oldest element if the box is full — pragmatic but coupled to Effect-internal structure.
  - `shutdown()` (`event-manager.ts:150-161`) clears the map and shuts down every PubSub; wired into the app teardown in `app-context.ts:129-131`.

### `src/modules/system/metrics-collector.ts` (338 lines)

The background loop, forked at boot by `src/main.ts:67` (`Effect.forkScoped(startMetricsCollector(context))`). Exports `startMetricsCollector` (`metrics-collector.ts:26`), which returns `Effect<never>` — an infinite program: `collect` repeated every 5 s via `Effect.repeat(Schedule.spaced(...))` then `Effect.andThen(Effect.never)` (`metrics-collector.ts:334-337`).

All mutable state is plain closure `let`s (`metrics-collector.ts:27-37`): last scrape, session peaks, llama.cpp sample cache, and `metricsUnavailableUntil` (a 404-cooldown timestamp — if `/metrics` 404s, stop hammering it for 60 s, `metrics-collector.ts:43`).

Each `collect` tick (`metrics-collector.ts:48-325`):

1. Finds the observed inference process and GPU list (`:49-52`).
2. **Lifetime accounting** (`:54-61`): integrates energy as `Σ power_draw × 5s / 3600` Wh per tick and bumps `uptime_seconds` by 5 into `LifetimeMetricsStore`.
3. Publishes `status` and `gpu` SSE events (`:63-69`).
4. Every 30 s, publishes a runtime summary (platform, backends, lease holder) with failures swallowed to a debug log (`:71-98`).
5. Builds `baseMetrics` — lifetime tokens/requests, kWh, and kWh-per-million-tokens ratios with division-by-zero guards (`:100-118`).
6. **If a process is running** (`:124-307`):
   - Session identity: `sessionPeakId = "${modelId}:${Date.now()}"` regenerated whenever `modelId` changes (`:128-133`); session peaks reset with it.
   - **vLLM/SGLang branch** (`:144-197`): scrapes Prometheus metrics, derives throughput by *delta of cumulative counters over elapsed time* (`:160-165`), prefers engine-reported throughput gauges when present (`:168-170`), and computes average TTFT from histogram `_sum`/`_count` deltas (`:178-185`). Updates the all-time peak store only for positive values (`:190-197`).
   - **llama.cpp branch** (`:198-223`): delegates to `scrapeLlamacppThroughput` (log parsing), caches the last sample keyed by `sampleKey`, and zeroes reported throughput once the sample is older than `LLAMACPP_TPS_STALE_MS` (15 s) — a staleness gate (`:221-223`).
   - MLX/other (`:224-231`): resets all scrape state.
   - Bumps in-memory session peaks (`:233-239`), persists session peaks (`:241-249`), then reads back all-time/session/best-session peaks plus the request-store aggregate and publishes one big `metrics` event with ~40 fields (`:251-307`). Display values prefer scrape counters, falling back to the usage-store aggregate via `positiveOrUndefined(...) ?? ...` (`:262-267`).
7. **If nothing is running** (`:308-325`): publishes a stripped-down metrics payload with only lifetime + GPU fields.
8. The whole tick is wrapped in `Effect.catch` that logs and swallows errors (`:326-331`) so a single bad tick never kills the loop.

### `src/modules/system/metrics-store.ts` (412 lines)

Two SQLite repository classes sharing one DB file (both opened on `config.db_path` in `app-context.ts:148-155`). Both follow the codebase idiom: synchronous `bun:sqlite` methods, each paired with a `*Effect` wrapper via `repositoryEffect` from `stores/sqlite` (which tags errors as `RepositoryError`), plus a `close()` built by `makeDatabaseCloser`.

- `class PeakMetricsStore` (`metrics-store.ts:10-285`):
  - Two tables (`metrics-store.ts:19-45`): `peak_metrics` (all-time best per `model_id`: `prefill_tps`, `generation_tps`, `ttft_ms`, plus cumulative `total_tokens`/`total_requests`) and `peak_metric_sessions` (per-launch session peaks keyed by `session_id`), indexed on `(model_id, updated_at)`.
  - `updateIfBetter` (`metrics-store.ts:60-129`): read-modify-write in TypeScript — only overwrites when the new value beats the stored one (higher tps, *lower* TTFT), inserting on first sight.
  - `addTokens` (`metrics-store.ts:142-155`): atomic `INSERT ... ON CONFLICT DO UPDATE SET total = total + excluded.total` upsert — the SQL does the read-modify-write, unlike `updateIfBetter`.
  - `updateSessionPeak` (`metrics-store.ts:167-211`): pushes the max/min logic *into SQL* via `CASE WHEN ... END` clauses on conflict — null-tolerant keep-best semantics.
  - `getBestSession` (`metrics-store.ts:238-253`): best session = highest `peak_generation_tps`, tie-broken by `peak_prefill_tps` then recency.
  - `getAll` (`metrics-store.ts:261-276`) does an N+1: one `getBestSession` query per model row. Fine at local scale, but worth noticing.
- `class LifetimeMetricsStore` (`metrics-store.ts:287-412`):
  - Single key/value table (`metrics-store.ts:296-318`) with seeded defaults (`tokens_total`, `prompt_tokens_total`, `completion_tokens_total`, `energy_wh`, `uptime_seconds`, `requests_total`, `first_started_at`).
  - `increment` (`metrics-store.ts:357-366`) is an atomic SQL upsert; convenience wrappers (`addEnergy`, `addPromptTokens`, ... `metrics-store.ts:385-407`) are thin `incrementEffect` aliases.
  - `ensureFirstStarted` (`metrics-store.ts:372-377`) stamps first boot once; called during context init (`app-context.ts:172-175`).

### `src/modules/system/metrics-routes.ts` (291 lines)

REST + on-demand metrics, exported as `registerMonitoringRoutes` (`metrics-routes.ts:171`).

- `buildCurrentMetrics` (`metrics-routes.ts:48-167`) — an on-demand mirror of the collector's publish path: observed process + GPU rollup + lifetime counters + a live `/metrics` scrape (1.5 s timeout, `metrics-routes.ts:71`). Differences from the collector:
  - It can infer "something is serving" from the scrape alone (`hasVllm`/`hasSglang`, `metrics-routes.ts:72-83`) even when no managed process is observed — this covers externally-started engines.
  - vLLM throughput uses a **module-level `throughputSamples` Map** (`metrics-routes.ts:18-22`) for cross-request rate computation with a `MIN_RATE_INTERVAL_MS` of 1500 (`metrics-routes.ts:22`): too-frequent polls reuse the last computed rate instead of dividing by a near-zero interval. This Map is unbounded (one entry per model id — tiny in practice, but technically a leak).
  - TTFT here is lifetime-average (`sum/count`), not per-interval delta like the collector (`metrics-routes.ts:134-135`).
- `GET /v1/metrics/vllm` (`metrics-routes.ts:176-192`) — returns `buildCurrentMetrics`, republishes it on the event bus as a side effect (`Effect.tap`, `:182`), and on failure falls back to the collector's `latestMetrics` snapshot (`:183-188`) — good resilience story.
- `GET /peak-metrics` (`metrics-routes.ts:194-216`) — per-model or all-model peaks with a 15 s in-memory cache (`PEAK_METRICS_CACHE_TTL_MS`, `:169`). Cache key for "all" is `"\u0000all"` so it can't collide with a model id.
- `POST /benchmark` (`metrics-routes.ts:218-289`) — a synthetic benchmark: generates a "Please count: 0 1 2 ..." prompt sized to roughly `prompt_tokens` (query param validated 1–100 000 via `BenchmarkQuerySchema`, `:23-29`), fires one non-streaming chat completion through `fetchInference`, times it with `performance.now()`, derives generation tps from the response's `usage` (decoded via `BenchmarkResponseSchema`, `:30-37`), and records it into the peak store (`updateIfBetterEffect` + `addTokensEffect`, `:266-272`). Returns 200 with `{ error: "No model running" }` when idle — an error-in-200 idiom also used elsewhere in this codebase.

### `src/modules/system/metrics-peaks.ts` (51 lines)

Pure helpers, no imports — the only dependency-free file in the slice:

- `positiveOrUndefined` (`metrics-peaks.ts:1-4`) — coerce unknown → finite positive number or `undefined`; used everywhere display fallbacks chain with `??`.
- `SessionPeaks` interface + `emptyPeaks()` (`metrics-peaks.ts:6-24`) — the in-memory session accumulator.
- `bumpPeak` (`metrics-peaks.ts:26-28`) — max-with-current; `bumpBestLower` (`metrics-peaks.ts:30-37`) — min-with-current where 0 means "unset" (used for TTFT).
- `firstMetric` (`metrics-peaks.ts:45-51`) — first finite value across a prioritized list of Prometheus metric names; returns 0 when absent. This is what makes the vLLM/SGLang metric-name fallback arrays work.

### `src/modules/system/logs-routes.ts` (405 lines)

Log browsing + both SSE endpoints. Exported as `registerLogsRoutes` (`logs-routes.ts:83`).

Module-level machinery:

- `LogLimitQuerySchema` / `LogTailQuerySchema` (`logs-routes.ts:27-40`) — query params decoded from strings, bounded to ≤ 20 000.
- `abortEffect` (`logs-routes.ts:42-51`) — duplicate of the one in `event-manager.ts` and a third in `http/sse.ts`; a small triplicated helper.
- `waitForChildExit` + `terminateChild` (`logs-routes.ts:53-81`) — graceful child kill: SIGTERM, race against 1 s, SIGKILL, race again. Uses `Effect.raceFirst`, so the loser keeps running unless awaited — here both branches are bounded so it's safe.

Route-scope helpers:

- `maybeCleanup` (`logs-routes.ts:86-91`) — throttled (once/60 s) log-file garbage collection, triggered as a side effect of `GET /logs`.
- `decodeSessionId` (`logs-routes.ts:93-98`) — runs `sanitizeLogSessionId` (from `core/log-files`) to reject path-unsafe session ids with 400.
- `getDockerContainerForSession` (`logs-routes.ts:100-113`) — looks up the recipe and extracts a container name from `extra_args` under four accepted key spellings, validated against `/^[a-zA-Z0-9_.-]+$/` before being passed to the `docker` CLI — an injection guard.
- `readDockerLogLines` (`logs-routes.ts:115-127`) — one-shot `docker logs --tail N` via `runCommandAsyncEffect` with 30 s timeout and 10 MB output cap.
- `streamDockerLogLines` (`logs-routes.ts:129-192`) — the most intricate function in the slice: spawns `docker logs --follow`, pipes **both stdout and stderr** into a single `PassThrough` (counting `openStreams` so the PassThrough ends only when both pipes end), feeds it to `readline.createInterface`, and exposes the lines as `Stream.fromAsyncIterable`. Acquisition and release are paired with `Effect.acquireRelease` (`:136-189`); the release closes readline, unpipes, destroys the PassThrough, and `terminateChild`s the docker process. The stream is also cut by the request's `AbortSignal`.

Routes:

- `GET /logs` (`logs-routes.ts:195-250`) — lists log files, joins each against `recipeStore` to decorate with recipe name/backend, marks `status: "running"` when `isRecipeRunning` matches the observed process, and deliberately moves the `controller` session to the end (`:246`).
- `GET /logs/:sessionId` (`logs-routes.ts:252-289`) — one-shot tail. Docker-backed sessions prefer `docker logs`; every line passes through `redactLogLine` (`:265`, `:285`) from `core/log-redaction` before leaving the process. File path resolution goes through `resolveExistingLogPath` so a sanitized id can't escape `data_dir`.
- `DELETE /logs/:sessionId` (`logs-routes.ts:291-313`) — refuses `controller`, deletes primary and fallback log paths, 404 only when *neither* unlink succeeded.
- `GET /events` (`logs-routes.ts:315-329`) — **the global SSE stream.** Subscribes to the `"default"` channel, maps `Event.toSse()`, and responds with `toReadableByteStream(withSseHeartbeat(frames, 15_000, signal))` — heartbeats (`: keepalive` comments every 15 s) merged with `haltStrategy: "left"` (`src/http/sse.ts:21-34`) so the heartbeat dies with the main stream. Lives here rather than `routes.ts` for historical/cohesion reasons.
- `GET /logs/:sessionId/stream` (`logs-routes.ts:331-403`) — per-session SSE: `replay` (docker-follow stream or file tail) **concatenated with** `live` (subscription to `logs:<sessionId>`), each line redacted and wrapped in an `Event` frame; any stream failure is converted into a terminal error *frame* rather than dropping the connection (`:386-394`). Note: for docker sessions `live` is `Stream.empty` (`:368-369`) because docker's `--follow` is already live.

### `src/modules/system/engine-metrics-scrape.ts` (94 lines)

Prometheus text-format scraping for vLLM/SGLang.

- `EngineScrape` type + `emptyScrape()` (`engine-metrics-scrape.ts:4-18`).
- `parseEngineMetrics` (`engine-metrics-scrape.ts:20-38`) — a deliberately minimal parser: skips comments/empties, sniffs engine presence from `vllm:`/`sglang:` line prefixes, grabs the first `served_model_name="..."` label as `modelName`, and matches `name{labels} value` with one regex. **All labels are collapsed**: multiple label-sets of the same metric overwrite each other in `metrics[name]` — acceptable because the controller only reads aggregated counters.
- `scrapeEngineMetrics` (`engine-metrics-scrape.ts:40-50`) — `fetchLocal(port, "/metrics")`, parses only on 200, and swallows *all* errors into `emptyScrape()` (`:49`). Callers distinguish "engine absent" from "parse empty" via `status`.
- `EngineMetricNames` + `VLLM_METRIC_NAMES`/`SGLANG_METRIC_NAMES` (`engine-metrics-scrape.ts:52-94`) — per-engine name dictionaries with prioritized fallbacks (e.g. SGLang generation tokens has three candidate names), consumed by `firstMetric`.

### `src/modules/system/llamacpp-throughput.ts` (101 lines)

Throughput for llama.cpp, which exposes no Prometheus endpoint — parse it out of the log instead.

- Constants (`llamacpp-throughput.ts:7-11`): tail 240 lines; `LLAMACPP_TPS_STALE_MS = 15_000` (exported, used by the collector's staleness gate); regexes for `N tokens per second`, `prompt eval time =`, and `eval time =` (with `(^|\s)` so `prompt eval time` doesn't match the plain-eval pattern).
- `parseLlamacppThroughputFromLines` (`llamacpp-throughput.ts:27-54`) — scans the tail *backwards* for the newest prompt-eval and eval lines, extracts tps from each, and builds a `sampleKey` (`promptLine::evalLine`) the collector uses for dedup.
- `scrapeLlamacppThroughput` (`llamacpp-throughput.ts:71-101`) — find the running recipe to locate its log file; if none, heuristically pick a log file whose session id contains the served model name, else just the first non-controller log (`:83-93`); tail it and parse. That last-resort "first log file" fallback can attribute the wrong session's throughput when several logs exist — a known softness.

### `src/modules/system/gpu-leases.ts` (605 lines)

The largest and subtlest file. Two cooperating layers: an in-memory registry (per process) and a host-wide lock layer using the filesystem (across processes — e.g. controller vs. an external tool, or two controllers for the same user).

Public surface:

- Types: `GpuLeaseOwner = "llm" | "speech"` (`gpu-leases.ts:19`), `GpuLease`, `GpuVisibilityResolution`, and the registry interface `GpuLeaseRegistry` (`gpu-leases.ts:81-95`) with `claim` (additive), `replace` (swap owner's whole set), `release`, `snapshot`.
- Errors as plain `Error` subclasses with `_tag` (`gpu-leases.ts:38-73`) — `GpuLeaseConflict`, `InvalidGpuLeaseUuid`, `GpuLeaseLockFailure`. Note these are *not* `Schema.TaggedErrorClass`; they're hand-rolled but keep the `_tag` convention.
- `resolveRecipeGpuUuids` (`gpu-leases.ts:424-456`) — resolves a recipe's GPU selector (from `extra_args` visibility keys or `CUDA_VISIBLE_DEVICES` in env, `gpu-leases.ts:388-409`) against the observed GPU list. Selectors can be indexes (`"0,1"`) or UUIDs; unresolvable tokens are reported, not failed. Only GPUs with **full NVIDIA UUIDs** are leaseable (`leaseableUuid`, `gpu-leases.ts:415-418`) — AMD/Intel GPUs simply don't participate.
- `perUserGpuLeaseLockDirectory` (`gpu-leases.ts:379-382`) — `${tmpdir}/local-studio-<uid>/gpu-leases`, so locks are shared per OS user.
- `createGpuLeaseRegistry` (`gpu-leases.ts:496-605`) — the in-memory layer: a `Map<uuid, owner>` guarded by `Semaphore(1)`; `assign` (`:545-580`) validates UUIDs, canonicalizes case, checks in-memory conflicts, acquires host locks for additions, releases host locks for removals (with compensating rollback of the additions if removal fails, `:568-575`), all under `Effect.uninterruptible` so a lease can't be half-swapped.

Host lock layer (the interesting part):

- Lock record (`gpu-leases.ts:97-113`): JSON `{version, uuid, owner, pid, processStartToken, registryId}` — `registryId` is a per-process `randomUUID` (`:307`) identifying *this* registry instance.
- **Liveness without trusting pids** (`gpu-leases.ts:142-191`): on Linux, `/proc/<pid>/stat` field 22 (start time in jiffies, parsed at `:142-150` — the `[19]` index after splitting past the comm field) is compared against the recorded `processStartToken`, defeating pid reuse. Non-Linux falls back to `process.kill(pid, 0)` (`:171-178`).
- **Atomic claim via hard link** (`gpu-leases.ts:317-367`): write the record to a unique temp file (`flag: "wx"`), then `link(temp, lockPath)` — `link(2)` fails with `EEXIST` if the lock exists, giving a POSIX-atomic test-and-set. Up to `hostLockAttempts = 128` retries (`:135`).
- **Stale-lock reclamation with a mutex** (`gpu-leases.ts:261-300`): `reclaimStaleHostLock` creates a `${path}.reaper` *directory* (`mkdir` is atomic-exists) as a reclaim mutex so two processes don't delete/recreate the same lock concurrently; a reaper dir older than `staleReaperAgeMs = 5_000` (`:136`) is itself considered stale and force-removed. Only the reaper-claimant reads the lock, checks liveness, and unlinks it if dead.
- `withCleanup` (`gpu-leases.ts:250-259`) — hand-rolled `try/finally` for Effect: run the body restorably inside `Effect.uninterruptibleMask`, then always run cleanup, then re-emit the body's `Exit`. (Effect has `ensuring`; this version preserves the body's exit even when cleanup is typed with its own error channel.)
- `acquireHostLeases` (`gpu-leases.ts:500-526`) — all-or-nothing: on the first conflict, every lock acquired so far is released before returning the conflict; on any unexpected error, best-effort release of *all* requested uuids then re-fail.

No `*.test.ts` files exist under `src/modules/system/`; coverage for this slice lives elsewhere or not at all.

## 3. How data/control flows

**Boot wiring** — `src/app-context.ts:119-181`: construct `EventManager` → logger's `onLine` feeds `publishLogLineUnsafe("controller", ...)` (`app-context.ts:124`) → open `PeakMetricsStore`/`LifetimeMetricsStore` on the shared `db_path` → `createGpuLeaseRegistry({ lockDirectory: perUserGpuLeaseLockDirectory() })`. `src/main.ts:67` forks `startMetricsCollector`; `src/http/app.ts:91` mounts `registerSystemRoutes`.

**Continuous telemetry (the main flow)** — every 5 s:
`metrics-collector.ts:48` tick → `processManager.findInferenceProcess` + `getGpuInfo` → lifetime counters incremented in SQLite (`metrics-collector.ts:57-61`) → `publishStatus`/`publishGpu` → engine scrape (`engine-metrics-scrape.ts:40`) or llama.cpp log parse (`llamacpp-throughput.ts:71`) → session peaks bumped (`metrics-peaks.ts:26`) and persisted (`metrics-store.ts:167`) → one ~40-field `publishMetrics` event (`metrics-collector.ts:269`) → `EventManager.publish` → `PubSub` on channel `"default"` → every `GET /events` subscriber (`logs-routes.ts:315-329`) receives an SSE frame; heartbeats fill the gaps.

**Request-driven metrics** — `GET /v1/metrics/vllm` → `buildCurrentMetrics` (`metrics-routes.ts:48`) re-scrapes on demand (rate-limited sampling Map for vLLM throughput), side-effect republishes to SSE, falls back to the collector's last snapshot on failure.

**Log streaming** — engine process stdout is captured by `process-manager.ts:557` → `publishLogLine(recipeId, line)` → channel `logs:<sessionId>` → `GET /logs/:sessionId/stream` (`logs-routes.ts:331`) replays the file tail (or follows `docker logs`) then concatenates the live subscription, redacting every line.

**GPU arbitration** — launch path: `engine-coordinator.ts:460` calls `gpuLeaseRegistry.replace("llm", uuids)` with UUIDs from `resolveRecipeGpuUuids` (`backend-builder.ts:10` uses the same resolution for env rendering) → in-memory map + host lock files → conflict yields `GpuLeaseConflict` → launch aborts. Speech service does the same with owner `"speech"` (`speech/service.ts:772`); a conflict between them is how the UI learns a GPU is busy. Eviction: `engine-coordinator.ts:421`/`532` releases the `"llm"` leases.

## 4. Key patterns & idioms

- **Effect.gen everywhere**: route handlers and the collector are `Effect.gen(function* () { ... })` pipelines; `yield*` unwraps effects. `Effect.catch(() => ...)` converts failure channels into recoverable values — used for "optional" data (config.json parse at `routes.ts:182`, scrape failures at `engine-metrics-scrape.ts:49`).
- **`Effect.callback` for Node APIs**: TCP probes (`routes.ts:57`), child-process exit (`logs-routes.ts:54`), abort signals (`event-manager.ts:25`). The returned `Effect.sync(cleanup)` is the cancellation finalizer.
- **Dual sync/Effect API on stores**: every repository method has a `foo()` (sync `bun:sqlite`) and `fooEffect()` (wrapped, `RepositoryError`-tagged) variant — see `metrics-store.ts` passim. Route/collector code uses only the Effect variants.
- **`defineRoutes`/`mergeRoutes` typing trick** (`src/http/route-registrar.ts:18-26`): each registrar returns the Hono app with its routes' types attached; `mergeRoutes` casts the tuple to an intersection so the OpenAPI handler (`app.ts:109`) sees every route. At runtime `mergeRoutes` just returns `routes[0]` — the same mutated `app`.
- **`effectHandler`** (`src/http/effect-handler.ts:31-36`): runs the Effect on the controller runtime and rethrows the first error from the `Cause` — errors are translated to HTTP by global error middleware, so routes `yield* Effect.fail(badRequest(...))` instead of setting statuses.
- **Schema for boundaries only**: `Schema.Struct` + `Schema.FiniteFromString` validate HTTP bodies/query params; internal data flows as `Record<string, unknown>` with bracket access (e.g. `peakData?.["prefill_tps"]`).
- **Semaphore-per-resource**: both `EventManager` and the lease registry guard plain JS Maps with `Semaphore.makeUnsafe(1)` + `withPermit`. Critical sections are wrapped in `Effect.uninterruptible` when partial completion would corrupt state (`gpu-leases.ts:579`).
- **Acquire/release pairing**: SSE subscriptions (`event-manager.ts:82`), docker-log processes (`logs-routes.ts:136`), and app-level resources (`app-context.ts:140+`) all use `Effect.acquireRelease` so teardown is guaranteed on interruption (client disconnect, SIGTERM).
- **Backpressure by dropping, not blocking**: `PubSub.sliding(100)` in the event manager; 15 s SSE heartbeats; 60 s scrape-cooldown after a 404; 15 s peak-metrics cache.
- **Error-in-200 responses**: several routes (`/benchmark`, `/peak-metrics`) return `{ error: "..." }` with HTTP 200 for "nothing running" cases, while true request errors use typed failures. Frontend code expects both shapes.

## 5. Connections

**Depends on (outside the slice):**
- `./platform/gpu` (`getGpuInfo`), `./platform/compatibility-report`, `../engines/runtimes/runtime-info` — hardware/runtime probing.
- `../../core/*` — `errors` (typed HTTP errors), `validation.decodeJsonBody`, `function-observability.findObservedInferenceProcess`, `log-files` (path resolution, tailing, cleanup, session-id sanitization), `log-redaction.redactLogLine`, `command.runCommandAsyncEffect`.
- `../../http/*` — `route-registrar`, `effect-handler`, `local-fetch` (`fetchLocal`/`fetchInference`), `sse` helpers.
- `../../stores/sqlite` (`openInitializedDatabase`, `repositoryEffect`), `stores/inference-request-store` (usage aggregates), `stores/recipeStore` (via `AppContext`).
- `../models/recipes/recipe-matching.isRecipeRunning`, `../models/model-browser.estimateWeightsSizeBytes`, `../models/types`, `../engines/argument-utilities.getExtraArgument`.
- `@local-studio/contracts/controller-events` — the event-name constants shared with the frontend.

**Consumed by:**
- `src/app-context.ts` — constructs `EventManager`, both metrics stores, `createGpuLeaseRegistry`.
- `src/main.ts` — forks `startMetricsCollector`.
- `src/http/app.ts` — mounts `registerSystemRoutes`.
- `modules/engines` — `engine-coordinator.ts` (leases + launch-progress events), `process/process-manager.ts` (log-line publishing), `process/backend-builder.ts` (`resolveRecipeGpuUuids`), `downloads/download-manager.ts` (event bus), `recipe-routes.ts` (event bus).
- `modules/speech/service.ts` — the other GPU-lease owner.
- `modules/studio/rig-routes.ts` — publishes rig events through the bus.
- `modules/proxy/inference-accounting.ts` — writes lifetime token/request counters into `LifetimeMetricsStore`.

## 6. How to read this code

1. **`metrics-peaks.ts`** (5 min) — vocabulary: `firstMetric`, `bumpPeak`, `SessionPeaks`. Everything else uses these.
2. **`event-manager.ts`** (15 min) — the hub. Understand `PubSub.sliding`, the semaphore, and `subscribe`'s acquire/release before anything SSE-related makes sense.
3. **`engine-metrics-scrape.ts`** then **`llamacpp-throughput.ts`** (15 min) — the two data sources: Prometheus parsing vs. log regexing. Notice both degrade to "empty" rather than failing.
4. **`metrics-store.ts`** (20 min) — persistence. Compare the three write strategies (TS read-modify-write in `updateIfBetter`, SQL upsert in `addTokens`, SQL `CASE` keep-best in `updateSessionPeak`).
5. **`metrics-collector.ts`** (30 min) — the payoff: read the `collect` gen top to bottom once, keeping `metrics-collector.ts:27-37` (the closure state) visible. This file teaches the whole metrics data model.
6. **`routes.ts`** (20 min) — skim `/status`/`/gpus`, study `checkService` as the `Effect.callback` exemplar, then the `/vram-calculator` math.
7. **`metrics-routes.ts`** (20 min) — compare `buildCurrentMetrics` against the collector's publish block; the differences (sampling Map, scrape-inference, fallback) are the lesson.
8. **`logs-routes.ts`** (30 min) — the hardest route file: `streamDockerLogLines` and the replay-concat-live SSE construction.
9. **`gpu-leases.ts`** (45 min) — save for last. Read the public interface (`:81-95`), then `createGpuLeaseRegistry`, then descend into the host-lock internals. It's self-contained; you can treat `engine-coordinator.ts:460` as its only usage you need.

First thing to look for in any file here: **what happens on failure** — this slice's design philosophy is "telemetry must never take the controller down," so nearly every failure path is a `catch` into a default, a cooldown, or a stale-cache fallback.
