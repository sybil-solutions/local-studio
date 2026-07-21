# Studio module slice — code walkthrough

Scope: `controller/src/modules/studio/` — `routes.ts`, `rig-routes.ts`, `types.ts`, `provider-routes.ts`, `configs.ts`, `rig-detection.ts`.

## 1. Purpose

The studio module is the "control panel" API surface of the controller. It serves the settings/diagnostics/storage endpoints the frontend's Studio UI calls: reading and updating `models_dir` and UI preferences, reporting hardware + runtime diagnostics, computing on-disk model storage, suggesting models to download, and applying first-run starter presets. It also hosts two self-contained sub-APIs mounted under the same `/studio` prefix: **providers** (external OpenAI-compatible endpoints with API keys) and **rigs** (an inventory of machines/nodes and their accelerators, with auto-detection of the local machine). It is pure read/config/management surface — no inference traffic flows through here.

## 2. File-by-file walkthrough

### `types.ts` (31 lines) — pure type declarations

No runtime code. Exports two interfaces:

- `StudioModelRecommendation` (`types.ts:1`) — a curated suggestion entry: HF model id, size, minimum VRAM, description, tags. Consumed by the `/studio/recommendations` endpoint.
- `StudioStarterPreset` (`types.ts:15`) — a first-run preset. The doc comment (`types.ts:10-14`) explains the two `kind`s: `download` presets pull weights from Hugging Face and become a local recipe; `remote` presets register an external provider (no weights). Note the backend-specific optional fields: `gguf_file` (the exact weights file for llamacpp presets, `types.ts:27`) and `recipe_overrides` (`types.ts:29`), which the caller merges over starter recipe defaults — the studio module only *declares* these; recipe creation happens elsewhere.

### `configs.ts` (160 lines) — static curated data

Exports two constants, consumed only by `routes.ts`:

- `STUDIO_STARTER_PRESETS` (`configs.ts:8`) — three presets covering "serious local model" (Qwen3.6 35B NVFP4 via vLLM, with vLLM-specific `recipe_overrides` like `tool_call_parser`, `reasoning_parser`, `trust_remote_code` at `configs.ts:20-27`), "small fast local model" (LFM2.5 8B GGUF via llamacpp, with `allow_patterns` and `gguf_file` at `configs.ts:39-41`), and a `remote` preset pointing at a hard-coded Tailscale endpoint (`configs.ts:56-59` — see "noteworthy" below).
- `STUDIO_MODEL_RECOMMENDATIONS` (`configs.ts:63`) — twelve flagship-to-starter model entries with `size_gb` and `min_vram_gb`, filtered server-side against detected VRAM in the recommendations route.

### `rig-detection.ts` (176 lines) — local hardware → `RigNode`

The pure "detect my machine" logic. No routes here; consumed by `rig-routes.ts`.

- `LOCAL_RIG_NODE_ID = "local"` and `DEFAULT_RIG_ID = "default"` (`rig-detection.ts:7-8`) — the local node and the auto-created rig have fixed, well-known ids so the frontend and routes can special-case them.
- `KNOWN_ACCELERATORS` (`rig-detection.ts:18-61`) — a regex-driven spec table mapping GPU names (GB10/DGX Spark, RTX PRO 6000, 5090, 4090, 3090, Apple) to `hardware_type`, memory technology, bandwidth in GB/s, and `unified_memory`. This is how a raw `nvidia-smi` name string becomes structured metadata.
- `groupAccelerators` (`rig-detection.ts:70-89`) — collapses the `GpuInfo[]` list into per-model groups (e.g. 4× RTX 3090 → one entry with `count: 4`), attaching known-spec metadata via `findKnownAccelerator`.
- `appleSiliconAccelerator` (`rig-detection.ts:91-103`) — macOS arm64 fallback: when no discrete GPUs are detected, synthesizes a single "unified memory" accelerator from the CPU model name and total RAM.
- `inferHardwareType` (`rig-detection.ts:105-115`) — classifies the node: dgx-spark/mac if a known accelerator says so, otherwise `gpu-server` for ≥3 GPUs, `gpu-desktop` for ≥1, else `custom`.
- `buildDetectedNode()` (`rig-detection.ts:117-142`) — the main export. An `Effect` that calls `getGpuInfo()` and assembles a complete `RigNode` with id `"local"`, `source: "detected"`, hostname, OS string, CPU, RAM, and accelerators.
- `mergeDetectedNode` (`rig-detection.ts:144-152`) — overwrites only the *detected* fields of a stored node (hostname, os, cpu, memory, accelerators) while preserving user-edited fields (name, role, notes, address). This is the key invariant: **auto-refresh never clobbers manual edits**.
- `seedDefaultRig` (`rig-detection.ts:154-164`) — builds the initial `"My Rig"` rig containing just the detected local node.
- `refreshLocalNode(rigs, detected)` (`rig-detection.ts:166-176`) — scans all rigs for the node with id `"local"`, merges fresh detection data **in place** (`rig.nodes[index] = ...`, `rig-detection.ts:172`), and returns the containing rig (or `null` if no rig has the local node yet). Note the in-place mutation — the caller relies on it.

### `rig-routes.ts` (275 lines) — CRUD for rigs and nodes

Registers 7 endpoints under `/studio/rigs`. All types and body schemas (`RigCreateSchema`, `RigNodeCreateSchema`, etc.) come from the shared contracts package (`rig-routes.ts:3-12`), so the frontend and controller validate against the same shapes.

Validation helpers (`rig-routes.ts:27-87`):

- `requiredName`, `optionalString`, `positiveOrNull` — small `Effect`-returning normalizers encoding a consistent tri-state convention used throughout the slice: `undefined` = "not provided, keep current", `null` = "explicitly clear", string/number = "set (trimmed/validated)". This is how PUT endpoints distinguish "field absent" from "field cleared".
- `accelerators` (`rig-routes.ts:59-87`) — validates a whole accelerator array; `AcceleratorInput` (`rig-routes.ts:54-57`) is a conditional type extracting the array element type from the contract schema, avoiding a duplicated type declaration.

Route wiring (`rig-routes.ts:89-119`) — the interesting part:

- Store access is via `context.stores.rigStore`, an SQLite-backed store. Every store method has an `*Effect` variant returning `Effect<_, RepositoryError>`; the routes alias them (`listRigs`, `getRig`, `saveRig`, `deleteRig` at `rig-routes.ts:92-95`) with error type `unknown`.
- `publishRigUpdate` (`rig-routes.ts:96-97`) — after every mutation, publishes a `rig_updated` event (`CONTROLLER_EVENTS.RIG_UPDATED`) on the event manager, which the SSE layer forwards to the frontend so the UI refreshes without polling.
- `loadRigsWithLocalNode` (`rig-routes.ts:98-109`) — the heart of `GET /studio/rigs`: list stored rigs → detect local hardware → if a rig contains the local node, merge fresh detection data and re-save that rig; otherwise seed a brand-new default rig and append it. So the GET endpoint has a **write side effect**: it keeps detected hardware info fresh and guarantees at least one rig always exists.
- `requireRig` / `saveRigTouched` (`rig-routes.ts:110-119`) — 404-if-missing helper and a save wrapper that bumps `updated_at`.

Endpoints: `GET`/`POST /studio/rigs` (`rig-routes.ts:122`, `:135`), `PUT`/`DELETE /studio/rigs/:rigId` (`rig-routes.ts:157`, `:175`), `POST /studio/rigs/:rigId/nodes` (`rig-routes.ts:190` — manual nodes get `source: "manual"`, defaults `hardware_type: "custom"`, `role: "standalone"`), `PUT /studio/rigs/:rigId/nodes/:nodeId` (`rig-routes.ts:219` — splice-by-index update preserving field-level tri-state semantics), `DELETE .../nodes/:nodeId` (`rig-routes.ts:252` — refuses to delete the detected local node, `rig-routes.ts:259-261`).

### `provider-routes.ts` (200 lines) — external provider CRUD + model listing

Manages `ProviderConfig[]` (id, name, base_url, api_key, enabled) stored in the JSON persisted-config file (not SQLite).

- `ProviderView` + `serializeProvider` (`provider-routes.ts:8-14`, `:40-46`) — **API-key redaction**: responses never include the key, only `has_api_key: boolean`. The raw key only ever leaves this module via `savePersistedConfig` (file written `0600` — see persisted-config).
- `saveProviders` (`provider-routes.ts:48-59`) — writes the whole providers array atomically and **also mutates `context.config.providers` in place** (`provider-routes.ts:55`), so the in-memory config object other modules hold stays in sync without a reload.
- `providerModels` (`provider-routes.ts:69-93`) — fetches `${base_url}/v1/models` with the provider's key, a 10-second `AbortSignal.timeout`, and decodes the response with a lenient schema (`ProviderModelsSchema`, `provider-routes.ts:31-33`: everything optional, unknown entries dropped by `flatMap` at `:88-91`).
- Endpoints: `GET`/`POST /studio/providers` (`provider-routes.ts:97`, `:105` — ids lowercased, duplicates rejected), `PUT`/`DELETE /studio/providers/:id` (`:130`, `:162` — update keeps the old key when `api_key` is omitted, `:151`), and `GET /studio/provider-models` (`:180`) — queries **all enabled providers that have a key** concurrently (`Effect.forEach` with `concurrency: "unbounded"`), wraps each in `Effect.option` so one provider being down or slow doesn't fail the whole request; failures are silently omitted from the response (`:191-193`).

### `routes.ts` (380 lines) — main studio surface

The entry point of the slice; exports `registerStudioRoutes` (`routes.ts:93`), called from `src/http/app.ts:94`. It merges its own 8 routes with the provider and rig sub-registrars (`routes.ts:377-378`).

Infrastructure:

- `SettingsUpdateSchema`, `ModelDeleteSchema`, `ModelMoveSchema` (`routes.ts:23-29`) — request body schemas. Note `models_dir` is `NullOr(String)`: `null` clears the override back to default.
- `StudioOperationError` (`routes.ts:31-38`) — a `Schema.TaggedErrorClass` with an `operation` literal union, so handlers can `Effect.catchTag("StudioOperationError", ...)` and so the error carries *which* operation failed.
- `diskInfo` (`routes.ts:47-62`) — wraps `statfs` in `Effect.tryPromise`; on failure, catches the tagged error and returns an object of `null`s instead of failing — diagnostics endpoints degrade gracefully.
- `insideModelsRoot` (`routes.ts:64-76`) — **path-traversal guard**: resolves the user-supplied path and requires it to be under `models_dir` (with optional `allowRoot` for the move target). Every destructive filesystem route goes through this.
- `pathExists` (`routes.ts:78-82`) — existence check implemented via `statfs` with `Effect.catch` → `false`. (Minor oddity: `statfs` on the path itself, so it follows mounts fine, but it's a filesystem-stats call being used as an existence probe.)
- `deriveRecommendationVramGb` (`routes.ts:90-91`) — exported pure helper: sums GPU memory (MB→GB). Exported presumably for tests/reuse.

`buildSettingsPayload` (`routes.ts:94-122`) — shared by GET and POST settings:

- Loads the JSON persisted config, then implements a **legacy migration**: UI preferences used to live in `studio-settings.json`; now they live in the SQLite `controller_settings` table. If the DB is empty but the legacy file has preferences, they're copied into the DB (`routes.ts:114-116`) — a lazy, self-healing migration performed on read.
- Returns both `persisted` (what's in the file/DB) and `effective` (the resolved `models_dir` the controller actually uses, `routes.ts:120`).

Endpoints:

- `GET /studio/settings` (`routes.ts:125`) — returns the payload above.
- `POST /studio/settings` (`routes.ts:131-164`) — validates at least one field was sent (`:139-141`); saves `models_dir` to the JSON config (or just reloads if only preferences were sent, `:144-146`); saves UI preferences to SQLite (`:154-158`); **mutates `context.config.models_dir` at runtime** (`:159`) so the change takes effect without restart; returns the rebuilt payload.
- `GET /studio/diagnostics` (`routes.ts:166-210`) — one-shot system snapshot: CPU/RAM from `node:os`, GPUs via `getGpuInfo()`, vLLM install state via `getVllmRuntimeInfo()`, and disk stats for both `data_dir` and `models_dir`, all fanned out with `Effect.all` (`:172-176`). Also echoes (non-secret) config values; `api_key_configured` is a boolean, never the key (`:199`).
- `GET /studio/storage` (`routes.ts:212-235`) — discovers model directories (depth 2, cap 200) and estimates weights sizes concurrently (`Effect.forEach`, `concurrency: "unbounded"`, `:218-226`); a directory whose size estimation fails contributes 0 rather than failing the request (`Effect.orElseSucceed(() => 0)`, `:223`).
- `GET /studio/recommendations` (`routes.ts:237-258`) — filters `STUDIO_MODEL_RECOMMENDATIONS` by detected VRAM. Two quirks: Apple Silicon gets an empty list (`:245`), and when **no GPU is detected** (`maxVramGb === 0`) the filter falls back to showing models needing ≤8 GB (`:250-251`) — i.e. "unknown hardware" is treated as "modest hardware".
- `GET /studio/presets` (`routes.ts:260-281`) — filters out vLLM presets on Apple Silicon and annotates each preset with a computed `fits: boolean` (`:271-276`); `min_vram_gb: null` or unknown VRAM means "fits".
- `POST /studio/models/delete` (`routes.ts:283-305`) — guarded by `insideModelsRoot` + existence check, then recursive `rm`. Returns only `{success: true}`.
- `POST /studio/models/move` (`routes.ts:307-375`) — the most intricate handler: both paths guarded (`allowRoot: true` for the target, `:321-326`); refuses to overwrite an existing target (`:339-340`); tries `rename` first and falls back to copy-then-delete **only on `EXDEV`** (cross-device move, `:341-361`) — this is the standard "rename across filesystems fails" dance; `errorOnExist: true` on the copy guards against races; all failures funnel into `StudioOperationError{operation: "move"}` via `Effect.mapError` (`:362-369`).

## 3. How data/control flows

**Settings read** (`GET /studio/settings`):
Hono request → `documentRoute` (OpenAPI annotation) → `effectHandler` wraps the Effect (`effect-handler.ts:31-36`) → `buildSettingsPayload` reads `studio-settings.json` via `loadPersistedConfig` (`routes.ts:96`) → reads UI prefs from SQLite `controllerSettingsStore` (`routes.ts:107`) → lazy legacy migration if DB empty (`routes.ts:114-116`) → JSON response.

**Settings write** (`POST /studio/settings`):
`decodeJsonBody` parses + schema-validates the body (`validation.ts:12-19`; invalid → `HttpStatus` 400) → normalize → `savePersistedConfig` atomic write-then-rename to JSON (`persisted-config.ts:47-82`) → `saveUiPreferencesEffect` upsert into SQLite (`controller-settings-store.ts:55-70`) → in-memory `context.config.models_dir` update (`routes.ts:159`) → rebuild and return payload.

**Rig list** (`GET /studio/rigs`):
`rigStore.listEffect()` (SQLite `rigs` table, JSON blob per row, `rig-store.ts:33-44`) → `buildDetectedNode()` (`rig-detection.ts:117`) → `refreshLocalNode` merges detection into the stored rig → save if merged, else `seedDefaultRig` + save (`rig-routes.ts:98-109`) → `RigsPayload { rigs, local_node_id: "local" }`.

**Rig/node mutation** (POST/PUT/DELETE):
`decodeJsonBody` with the shared contract schema → tri-state field normalization (`rig-routes.ts:27-87`) → load rig (404 if missing) → `saveRigTouched` (upsert + `updated_at` bump, `rig-routes.ts:116-119`) → `eventManager.publish(rig_updated)` (`rig-routes.ts:96-97`) → SSE pushes the event to the frontend (`contracts/controller-events.ts:13`, mapped to the "controller" channel at `:81`) → JSON response.

**Provider models** (`GET /studio/provider-models`):
filter enabled providers with keys → per provider: `fetch /v1/models` (10 s timeout, Bearer key, `provider-routes.ts:73-81`) → lenient schema decode → `Effect.option` isolates failures → all `Some`s flattened into the response.

**Model delete/move**:
body → `insideModelsRoot` traversal guard (`routes.ts:64-76`) → existence checks (404) → `rm` / `rename` (+`EXDEV` copy fallback) → any error mapped to `StudioOperationError` → surfaced to the client by the runtime's error mapping (`effect-handler.ts:24-28` unwraps the `Cause` and rethrows the typed error, which global error handling turns into an HTTP status).

## 4. Key patterns & idioms

- **Route registration idiom**: every registrar is `defineRoutes((app, context) => mergeRoutes(app.get(...), app.post(...), ...))`. `mergeRoutes` (`route-registrar.ts:22-26`) is a type-level trick: Hono's `app.get()` returns a new typed app, and `mergeRoutes` returns `routes[0]` cast to the *intersection* of all route types so `http/app.ts` can accumulate a fully-typed route table. At runtime all registrations mutate the same Hono instance; the merge is purely for TypeScript.
- **`documentRoute`** (`route-registrar.ts:8-10`) — a `hono-openapi` `describeRoute` middleware with a generic 200 response; included on every route so it appears in the OpenAPI/Swagger docs.
- **`effectHandler`** (`effect-handler.ts:31-36`) — the bridge from Effect to Hono: pulls the `ControllerRuntime` from Hono context (set by middleware), runs the effect to an `Exit`, unwraps success or rethrows the first typed error / squashed cause. Handlers therefore never `try/catch`; they `yield* Effect.fail(...)` and the runtime + global error middleware produce HTTP responses.
- **Typed errors**: `badRequest`/`notFound` are `HttpStatus` instances (`errors.ts:3-12`), a `Schema.TaggedErrorClass` carrying `{status, detail}`. Domain failures use dedicated tagged classes (`StudioOperationError`, `ProviderPersistenceError`) so they can be caught selectively by `_tag` (`Effect.catchTag`) — see `diskInfo` swallowing only its own error (`routes.ts:59-61`).
- **`Effect.gen(function* () {...})` + `yield*`** — the codebase's standard composition style; reads like async/await. `Effect.try`/`Effect.tryPromise` wrap sync/async throwing code with an error mapper. `Effect.all` / `Effect.forEach(..., {concurrency: "unbounded"})` provide structured concurrency for fan-out (diagnostics, storage sizes, provider models).
- **Tri-state update semantics**: `undefined` = keep, `null` = clear, value = set — implemented by `optionalString`/`positiveOrNull` (`rig-routes.ts:32-52`) and mirrored in `normalizedOptionalString` (`routes.ts:84-88`). Schema-side this is `Schema.optional(Schema.NullOr(...))`.
- **Two persistence mechanisms coexist**: JSON file (`studio-settings.json`, atomic tmp-write + rename, mode 0600 — `persisted-config.ts:69-80`) for `models_dir` and providers, and SQLite (`bun:sqlite`) stores with hand-rolled `*Effect` wrappers (`repositoryEffect`) for rigs and UI preferences. JSON rows are stored as whole-document blobs (`rig-store.ts:64-71` upsert).
- **Redaction**: secrets never cross the API boundary — providers serialize with `has_api_key` only (`provider-routes.ts:40-46`); diagnostics report `api_key_configured: Boolean(...)` (`routes.ts:199`).
- **Event-driven UI refresh**: mutations publish contract events on the `EventManager`; nothing in the controller *consumes* `rig_updated` — it's forwarded over SSE for the frontend.
- **No tests in this slice** — `src/modules/studio/` contains no `*.test.ts` files (tests exist elsewhere, e.g. `engines/runtimes/runtime-info.test.ts`).

## 5. Connections

**Depends on:**

- `../../http/route-registrar`, `../../http/effect-handler` — route typing/merging and the Effect→Hono bridge.
- `../../core/errors`, `../../core/validation` — `HttpStatus` errors and `decodeJsonBody`.
- `../../config/persisted-config` — JSON settings file load/save (`models_dir`, providers) and `ProviderConfig`.
- `../system/platform/gpu` (`getGpuInfo`) and `../models/types` (`GpuInfo`) — GPU detection, shared with metrics.
- `../engines/runtimes/vllm-runtime` (`getVllmRuntimeInfo`) — vLLM install probe for diagnostics.
- `../models/model-browser` (`discoverModelDirectories`, `estimateWeightsSizeBytes`) — storage accounting.
- `../system/event-manager` (`Event`) — SSE event bus.
- `context.stores.rigStore` (`src/stores/rig-store.ts`) and `context.stores.controllerSettingsStore` (`src/stores/controller-settings-store.ts`) — SQLite persistence, wired in via `AppContext`.
- `@local-studio/contracts` — `rigs` schemas/types and `CONTROLLER_EVENTS.RIG_UPDATED`; the frontend consumes the same contracts.

**Depended on by:**

- `src/http/app.ts:14,37,94` — the only in-repo importer; mounts `registerStudioRoutes` alongside system/engine/models/speech/audio/proxy registrars. The `deepseek-v4-flash` remote preset and provider records are consumed downstream by the recipes/proxy modules via `context.config.providers` (mutated in place by this slice).
- The frontend (out of repo scope) calls every `/studio/*` endpoint and listens for `rig_updated` over SSE.

## 6. How to read this code

Suggested order:

1. **`types.ts` + `configs.ts`** (5 minutes) — pure data; establishes the vocabulary (`StudioStarterPreset.kind`, `recipe_overrides`) before you see it used.
2. **`routes.ts` top-down to line 92** — the infrastructure: `StudioOperationError`, `diskInfo`, `insideModelsRoot`, `pathExists`. Understand the tagged-error and path-guard idioms here; everything else reuses them.
3. **`routes.ts` `buildSettingsPayload` + the two settings routes** (`:93-164`) — the clearest example of the full request pipeline: schema decode → typed-error fail → JSON-config write → SQLite write → in-memory config mutation → response. Also the legacy-migration trick.
4. **`routes.ts` models delete/move** (`:283-375`) — the most "systems-y" code in the slice: traversal guard, existence probes, `EXDEV` fallback. Read this to see how Effect error channels map filesystem failures.
5. **`rig-detection.ts`** — pure functions, no Hono; see how raw `GpuInfo[]` becomes structured node metadata, and note the merge-detected-vs-preserve-manual split.
6. **`rig-routes.ts`** — read the helpers (`:27-119`) before the routes; `loadRigsWithLocalNode` (`:98-109`) is the non-obvious part (GET with a write side effect). Then skim the six CRUD routes as variations on: validate → load → save → publish event.
7. **`provider-routes.ts`** last — it's the most self-contained; note the redaction (`serializeProvider`), the dual write (file + in-memory), and `Effect.option` failure isolation in `/provider-models`.

First things to look for when debugging: which persistence layer a field lives in (JSON file vs SQLite vs in-memory `context.config`), and the tri-state `undefined/null/value` semantics on every PUT body.
