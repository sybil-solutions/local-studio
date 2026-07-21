# Code Review Walkthrough: `src/stores/` (controller persistence layer)

Scope: `/Users/sero/projects/vllm-studio/controller/src/stores/` — `sqlite.ts`, `rig-store.ts`,
`controller-settings-store.ts`, `inference-request-store.ts`, `controller-request-store.ts`.
There are **no test files** in this slice (the whole controller has only 4 `*.test.ts` files,
none under `stores/`).

---

## 1. Purpose

This slice is the controller's entire SQLite persistence toolkit. `sqlite.ts` provides the
shared plumbing (open a `bun:sqlite` database safely, wrap synchronous calls in `Effect`, a
common error type); the other four files are concrete stores built on it: saved hardware
"rigs", UI preferences, per-inference-request usage records with a large aggregation query,
and controller-self-observability records (HTTP request log + internal function-call timings)
with time-bounded retention. All four stores open the **same physical database file**
(`config.db_path`, default `<data_dir>/controller.db`, see `src/config/env.ts:133-135`), each
with its own `Database` connection.

---

## 2. File-by-file walkthrough

### `sqlite.ts` (105 lines) — shared plumbing

Exports, in dependency order:

- **`OBSOLETE_TABLES` / `dropObsoleteTables`** (`sqlite.ts:5-25`) — a hardcoded list of nine
  legacy table names (`jobs`, `chat_sessions`, `chat_messages`, …) that are
  `DROP TABLE IF EXISTS`-ed the first time each DB path is opened in this process. The
  module-level `sweptPaths: Set<string>` (`sqlite.ts:17`) makes the sweep once-per-path-per-process.
  This is destructive schema garbage-collection baked into connection open.
- **`toFiniteNumber(value)`** (`sqlite.ts:27-30`) — coerces `unknown` (typically a SQLite
  aggregate result that may be `null`) to a finite `number`, defaulting to `0`. Used
  everywhere aggregate rows are mapped to contract types.
- **`RepositoryError`** (`sqlite.ts:32-42`) — the slice's single error type. Note: it is a
  hand-rolled `Error` subclass with a `_tag` property, **not** an
  `Effect Schema.TaggedErrorClass` like errors elsewhere in the codebase (compare
  `AppContextInitializationError` in `src/app-context.ts:57-64`). It carries `operation`
  (a dotted string like `"rigs.save"`) and the original `cause`.
- **`repositoryEffect(operation, execute)`** (`sqlite.ts:44-51`) — the core adapter: wraps a
  synchronous, throwing function into `Effect.Effect<A, RepositoryError>` via `Effect.try`.
  Every public `*Effect` store method is one line of this. Key mental model: **all store I/O
  is actually synchronous** (bun:sqlite is sync); the Effect wrapper exists purely for typed
  error channels and composability, not asynchrony.
- **`makeDatabaseCloser(db, operation)`** (`sqlite.ts:53-64`) — returns an idempotent close
  effect (guards with a `closed` boolean). Each store calls this once in its constructor and
  exposes it as `close()`; `app-context.ts` wires it into `Effect.acquireRelease` so DB
  handles close on scope teardown.
- **`toNullableNumber(value)`** (`sqlite.ts:66-70`) — like `toFiniteNumber` but preserves
  `null` (used for averages like `avg_ms` where "no data" should stay `null`, not `0`).
- **`openSqliteDatabase(dbPath)`** (`sqlite.ts:72-89`) — opens the DB, sets
  `PRAGMA busy_timeout = 5000` (5 s lock-wait — important because ~8 stores across the app
  share this one file), `chmod 0600`s the file (usage data is private), and runs the
  obsolete-table sweep. On any failure it closes the handle before rethrowing. Note it does
  **not** enable WAL (`journal_mode` is never set anywhere in the codebase).
- **`openInitializedDatabase(dbPath, initialize)`** (`sqlite.ts:91-105`) — `openSqliteDatabase`
  + run a schema/migration callback, with the same close-on-failure cleanup. Every store
  constructor goes through this.

### `rig-store.ts` (89 lines) — document store for hardware rigs

- Schema (`rig-store.ts:21-28`): one table `rigs(id TEXT PRIMARY KEY, data TEXT, created_at,
  updated_at)`. The whole `Rig` object (from `@local-studio/contracts/rigs`) is
  `JSON.stringify`-ed into the `data` column — a schemaless document-store pattern; SQLite is
  only used as a durable key-value map. There are no per-field columns or migrations.
- `list()` (`rig-store.ts:33-44`) — reads all rows ordered by `created_at`, `JSON.parse`s each,
  and **silently skips rows that fail to parse** (`catch { continue }`). Same
  swallow-and-continue in `get()` (`rig-store.ts:50-58`), which returns `null` for corrupt
  JSON — indistinguishable from "not found".
- `save()` (`rig-store.ts:64-71`) — upsert via `INSERT … ON CONFLICT(id) DO UPDATE`.
- `delete()` (`rig-store.ts:77-80`) — returns `result.changes > 0` so callers can distinguish
  404 from success (used at `src/modules/studio/rig-routes.ts:181`).
- Each sync method has a `*Effect` twin (`listEffect`, `getEffect`, `saveEffect`,
  `deleteEffect`) wrapping it in `repositoryEffect`. The route layer (`rig-routes.ts:92-95`)
  aliases these once at registration and only uses the Effect variants.

### `controller-settings-store.ts` (83 lines) — key-value settings (UI preferences)

- Schema (`controller-settings-store.ts:27-35`): generic `controller_settings(key, value,
  updated_at)` table, but only one key is ever used: `UI_PREFERENCES_KEY = "ui_preferences"`
  (`controller-settings-store.ts:10`). The table is generic; the API is not.
- `UiPreferencesSchema = Schema.Record(Schema.String, Schema.String)`
  (`controller-settings-store.ts:16`) — an Effect `Schema` used to validate the parsed JSON on
  read. This is the only store in the slice that validates reads with `Schema`.
- `getUiPreferences()` (`controller-settings-store.ts:37-47`) — `JSON.parse` +
  `Schema.decodeUnknownSync`, and **any** failure returns `{}`. This empty-object fallback is
  load-bearing: `src/modules/studio/routes.ts:107-116` treats `{}` as "not yet migrated" and
  copies legacy UI preferences from the JSON config file into the DB on first read.
- `saveUiPreferences()` (`controller-settings-store.ts:55-70`) — filters out entries with
  empty/non-string keys or non-string values before upserting, and returns the cleaned record
  (so the response echoes what was actually persisted).

### `inference-request-store.ts` (421 lines) — usage analytics

- `InferenceRequestRecord` (`inference-request-store.ts:13-27`) — the write-side DTO: model,
  source/session/provider, five token counters, `ttft_ms`, `duration_ms`, `status`,
  `streamed`. `UsageAggregate` (`inference-request-store.ts:29`) is
  `Omit<UsageStats, "controller">` — i.e. the frontend contract from
  `@local-studio/contracts/usage` minus the controller-self-observability section (which
  `ControllerRequestStore` fills in).
- `migrate()` (`inference-request-store.ts:53-80`) — creates `inference_requests` (one row per
  proxied inference request) plus indexes on `(created_at)` and `(model, created_at)`. All
  columns get `DEFAULT`s, so the schema is additive-only; there are no migrations.
  **There is no retention/prune here** — this table grows forever (contrast with
  `controller-request-store.ts`).
- `recordSync()` (`inference-request-store.ts:82-115`) — clamps each token count with
  `Math.max(0, Math.round(...))`, computes `total_tokens = prompt + completion` (note:
  reasoning tokens are stored but **not** included in `total_tokens`), defaults `status` to
  200, and inserts. Public `record()` (`inference-request-store.ts:117-119`) is the
  Effect-returning wrapper — naming differs from the other stores (no public sync method).
- `buildModelFilter(knownModels)` (`inference-request-store.ts:35-42`) — builds
  `AND model IN (?, ?, …)` + params when a non-empty set is passed; used to scope aggregates
  to the currently-served model (see §3).
- `aggregate(knownModels?)` (`inference-request-store.ts:121-410`) — the big one: **seven**
  SQL queries run synchronously in sequence:
  1. `summary` (`:125-151`) — one wide `SELECT` computing ~20 scalars at once: totals,
     unique sessions, success count, avg duration/TTFT, and rolling-window counts
     (last hour / 24 h / prev 24 h / this week / last week) using
     `datetime(created_at) >= datetime('now', '-N …')` buckets. `created_at` is stored via
     `CURRENT_TIMESTAMP` (UTC), and `datetime('now')` is also UTC, so the comparisons are
     consistent.
  2. `byModel` (`:163-180`) — per-model breakdown, top 25 by tokens.
  3. `daily` (`:182-198`) — per-day rollup for the last 366 days, capped at 400 rows.
  4. `dailyByModel` (`:200-216`) — per-(day, model), capped at 10 000 rows.
  5. `hourly` (`:218-230`) — requests by hour-of-day via `strftime('%H', …)`.
  6. `peakDays` (`:232-244`) — top 5 busiest days. 7. `peakHours` (`:246-257`) — top 5
     busiest hours in the last 7 days.

  All use the `WHERE 1=1${filter.clause}` idiom so the optional model filter appends cleanly.
- Returns `null` when `total_requests === 0` (`inference-request-store.ts:153-154`); the route
  layer substitutes an empty contract payload (`src/modules/system/usage-routes.ts:41`).
- Result mapping (`:264-409`) — converts every raw row through `toFiniteNumber` /
  `toNullableNumber` into the exact `UsageAggregate` contract shape. Notable: all percentile
  fields (`p50_ms`, `p95_ms`, `p99_ms`, `min_ms`, `max_ms`, `p50`/`p95` tokens) are hardcoded
  `null`/`0` (`:276-289`, `:304-305`) — the contract has slots for them but the store never
  computes percentiles. `unique_users: 0` (`:274`) likewise. `cache.hits`/`misses` are really
  `SUM(cache_read_tokens)`/`SUM(cache_write_tokens)` (`:307-313`) — token counts reused as
  hit/miss counters, an approximation. `calcChangePct` (`:259-262`) returns `null` when the
  previous window is 0 but current isn't (undefined growth), `0` when both are 0.

### `controller-request-store.ts` (360 lines) — self-observability

- Two record types: `ControllerRequestRecord` (HTTP request log, `:13-22`) and
  `ControllerFunctionCallRecord` (internal function timings, `:24-30`).
- Constants (`:34-35`): `RETENTION_DAYS = 14`, `PRUNE_EVERY_N_RECORDS = 1000`.
- `migrate()` (`:50-91`) — two tables (`controller_requests`, `controller_function_calls`),
  each with `(created_at)` and `(name/path, created_at)` indexes, plus a
  `(status, created_at)` index on requests.
- Retention (`:93-106`): `prune()` deletes rows older than 14 days from **both** tables; it
  runs once at construction (`:43-46`) and then every 1 000 recorded rows via the
  `recordsSincePrune` counter in `maybePrune()` (`:101-106`). Both `record()` (`:108-127`) and
  `recordFunctionCall()` (`:133-149`) call `maybePrune()` after insert, so one prune tick is
  shared across both record streams. Records are normalized (`method.toUpperCase()`,
  clamped/rounded durations, `success` as 0/1 integer).
- `aggregate()` (`:159-351`) — seven queries mirroring the inference store's shape but for
  controller health: totals/latency, `by_path` (top 50 by request count), `by_status`, last
  25 failed requests with `error_class`/`error_message`, recent-activity windows (1 h / 24 h),
  and the same trio for function calls. Everything maps to `ControllerUsageStats` from the
  contracts package.
- Consumers: the HTTP middleware records every non-skipped request
  (`src/http/observability-middleware.ts:42-71`, using `Effect.onExit` so failures are
  captured too, with `Effect.ignore` so telemetry can never break the request), and
  `observeControllerFunction` wraps arbitrary effects with function-call timing
  (`src/core/function-observability.ts:17-46`).

---

## 3. How data/control flows

**Boot (write path setup):** `src/main.ts` runs `makeAppContext` (`src/app-context.ts:109`)
inside an Effect scope. Each store is constructed synchronously and registered with
`Effect.acquireRelease` (`app-context.ts:156-171`), so scope teardown (SIGINT/SIGTERM)
invokes each store's `close()`; close failures are caught and logged by `releaseSafely`
(`app-context.ts:87-96`). All stores receive the same `dbPath` (`app-context.ts:118`).

**Inference usage write:** proxied request completes →
`recordNonStreamingInferenceUsage` / `recordStreamingInferenceUsage`
(`src/modules/proxy/inference-accounting.ts:118-155`) extracts token totals from the OpenAI
`usage` object (with fallbacks like `completion_tokens_details.reasoning_tokens`,
`inference-accounting.ts:69-79`) → `inferenceRequestStore.record(record)` →
`recordSync` clamps + INSERTs (`inference-request-store.ts:82-115`). Failures are caught and
downgraded to a `logger.warn` (`inference-accounting.ts:104-116`) — accounting must never
fail a user request.

**Inference usage read:** `GET /usage` (`usage-routes.ts:27-52`) → 15-second in-memory cache
→ `aggregateEffect()` (wrapped in `observeControllerFunction`, so the aggregation itself is
timed into `controller_function_calls`) → `null` ⇒ `emptyResponse()`. If
`?include_controller=true`, `controllerRequestStore.aggregateEffect()` is merged in as the
`controller` field (`usage-routes.ts:12-21`). The metrics pipeline also calls
`aggregateEffect(knownModels)` per-model: `src/modules/system/metrics-collector.ts:258` (SSE
metrics events) and `src/modules/system/metrics-routes.ts:92`, both passing a
`ReadonlySet<string>` so the SQL `IN` filter scopes stats to the currently-served model.

**Controller telemetry write:** every HTTP request (except `/health`, `/metrics`, `/events`,
`/status`, `/api/docs`, `/api/spec` — `observability-middleware.ts:7-14`) flows through the
middleware, which measures wall time with `performance.now()` and records method/path/status/
duration/user-agent plus `error_class`/`error_message` on failure. `error_class` is derived
from `HttpStatus` errors or the JS error's `name` (`observability-middleware.ts:20-29`).

**Rigs:** `GET/POST/PUT/DELETE /studio/rigs[/…]` (`src/modules/studio/rig-routes.ts:121-274`)
→ validated with contract Schemas (`decodeJsonBody`) → whole-`Rig` JSON upserted/replaced via
`RigStore` → `RIG_UPDATED` event published over SSE (`rig-routes.ts:96-97`). Listing rigs
lazily seeds/refreshes the auto-detected local node and persists it
(`rig-routes.ts:98-109`), so reads can write.

**UI preferences:** `GET/POST /studio/settings` (`src/modules/studio/routes.ts:124-164`) →
`getUiPreferencesEffect` / `saveUiPreferencesEffect`, with one-time migration from the legacy
JSON config file when the DB row is empty.

---

## 4. Key patterns & idioms

- **Sync-under-Effect**: `bun:sqlite` is fully synchronous; `repositoryEffect`
  (`sqlite.ts:44`) just lifts throwing calls into `Effect.try` so errors become typed
  `RepositoryError`s in the effect channel. No fibers, no async, no locking in this slice —
  concurrency control is delegated to SQLite itself via `PRAGMA busy_timeout = 5000`
  (`sqlite.ts:75`). For an Effect newcomer: when you see `store.xxxEffect()` inside
  `Effect.gen`/`yield*`, it's still a blocking call; the Effect is for error typing and
  scope-managed cleanup (`acquireRelease` → `close()`).
- **Dual API convention**: every store exposes a plain sync method and an `*Effect` wrapper.
  Routes/services only use the wrappers; the sync methods exist for the wrappers (and tests).
  `InferenceRequestStore` breaks the convention slightly: its public `record()` is already
  the Effect, and the sync part is private (`recordSync`).
- **Error type is not a Schema error**: `RepositoryError` is a plain `Error` with `_tag`
  (`sqlite.ts:32`), unlike the `Schema.TaggedErrorClass` errors used in `app-context.ts`.
  It still pattern-matches in Effect flows, but it isn't Schema-serializable.
- **Fail-soft reads, fail-safe writes**: corrupt JSON in `rigs` or `controller_settings`
  reads is silently swallowed to `null`/`{}`; accounting/telemetry write failures are caught
  upstream (`Effect.ignore`, `logger.warn`) so persistence never breaks serving.
- **SQL style**: hand-written SQL with `?` placeholders, `WHERE 1=1` + optional clause
  concatenation, `COALESCE(SUM(...), 0)` for aggregates, `INSERT … ON CONFLICT DO UPDATE`
  for upserts, and SQLite `datetime('now', '-N hours/days')` for all time windows.
- **Two retention philosophies**: controller telemetry self-prunes (14 days, amortized every
  1 000 writes); inference requests accumulate forever and rely on query-time windows +
  `LIMIT`s.
- **One file, many connections**: every store (here and in `modules/…/*-store.ts`, which
  reuse `openSqliteDatabase`) opens its own `Database` handle on `controller.db`. No WAL is
  configured, so writes serialize across connections; the 5 s busy timeout is the only
  contention guard. Fine at this scale, but a reader should not expect WAL semantics.
- **Contract-shaped mapping**: aggregates map raw rows into `@local-studio/contracts/usage`
  types field-by-field with `toFiniteNumber`/`toNullableNumber`; unimplemented contract
  fields (percentiles, `unique_users`, tps fields) are stubbed to `null`/`0` rather than
  omitted.

---

## 5. Connections

**Depends on:**
- `bun:sqlite` (`Database`), `node:fs` (`chmodSync`), `effect` (`Effect`, `Schema`),
  `@local-studio/contracts/rigs` (`Rig`), `@local-studio/contracts/usage` (`UsageStats`,
  `ControllerUsageStats`).
- Instantiated only from `src/app-context.ts:156-171` with `config.db_path`
  (`src/config/env.ts:133-135`).

**`sqlite.ts` is also imported outside this slice** (its real blast radius):
`src/modules/system/metrics-store.ts:3-8` (Peak/LifetimeMetricsStore),
`src/modules/engines/downloads/download-store.ts:2`,
`src/modules/models/recipes/recipe-store.ts:5`,
`src/modules/speech/voice-store.ts:6` — all share `openSqliteDatabase` (so all of them
trigger the obsolete-table sweep and busy-timeout).

**Depended on by:**
- `InferenceRequestStore` → `modules/proxy/inference-accounting.ts` (writes),
  `modules/system/usage-routes.ts`, `modules/system/metrics-collector.ts`,
  `modules/system/metrics-routes.ts` (reads).
- `ControllerRequestStore` → `http/observability-middleware.ts`,
  `core/function-observability.ts` (writes), `modules/system/usage-routes.ts` (read).
- `ControllerSettingsStore` → `modules/studio/routes.ts`.
- `RigStore` → `modules/studio/rig-routes.ts`.

---

## 6. How to read this code

1. **`sqlite.ts` first, top to bottom.** It's 105 lines and defines every idiom the other
   files reuse. Pause on `repositoryEffect` (`:44`) and `openSqliteDatabase` (`:72`) —
   understand that everything is synchronous and that `Effect` is an error/cleanup wrapper
   here. Note the obsolete-table sweep; it's easy to miss and surprising.
2. **`rig-store.ts` second** — the smallest concrete store. See the constructor pattern
   (`openInitializedDatabase` + `makeDatabaseCloser`), the JSON-blob table, and the
   sync/Effect dual method convention. Skim `modules/studio/rig-routes.ts:89-119` right
   after to see how a route consumes a store and why reads can write (local-node seeding).
3. **`controller-settings-store.ts` third** — same skeleton, plus `Schema` validation on
   read and the empty-object fallback that drives the legacy migration in
   `modules/studio/routes.ts:104-116`.
4. **`controller-request-store.ts` fourth** — learn the retention mechanism
   (`RETENTION_DAYS`/`maybePrune`, `:34`, `:101`) before the big `aggregate()`. Then read
   `http/observability-middleware.ts` to see the write path (`Effect.onExit` +
   `Effect.ignore`).
5. **`inference-request-store.ts` last and slowly.** Read `recordSync` (`:82`) first, then
   the seven queries inside `aggregate()` one at a time, keeping the returned object shape
   (`:264-409`) open beside them — each query feeds a specific section of `UsageAggregate`.
   Finish with `modules/proxy/inference-accounting.ts` and `modules/system/usage-routes.ts`
   to see both ends of the flow.
6. **Cross-cutting check at the end**: open `src/app-context.ts:156-171` to confirm
   construction order and `acquireRelease` wiring, and `src/config/env.ts:133-135` for where
   the shared DB path comes from.

Things to actively look for on a first pass: silent catch blocks (three of them), the
difference between `toFiniteNumber` (0-default) and `toNullableNumber` (null-preserving),
and which contract fields are stubbed rather than computed.
