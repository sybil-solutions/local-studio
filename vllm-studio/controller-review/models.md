# Models module — code walkthrough

Scope: `controller/src/modules/models/` — `routes.ts`, `types.ts`, `model-browser.ts`, `recipes/recipe-matching.ts`, `recipes/recipe-store.ts`, `recipes/recipe-serializer.ts`. All paths below are relative to `controller/`.

## 1. Purpose

This slice owns everything about "which models exist and which recipe launches them". A **recipe** is a persisted launch configuration (backend, model path, runtime, parallelism, port, env vars, etc.); this module defines the recipe type, normalizes/validates arbitrary recipe input, stores recipes in SQLite, and matches a recipe against the currently running inference process. On top of that it exposes read-only HTTP routes: an OpenAI-compatible `/v1/models` listing, a disk scanner (`/v1/studio/models`) that browses model directories on the local filesystem, and a pass-through to the HuggingFace model search API. Nothing here launches engines or proxies requests — it is the metadata/catalog layer the engines and proxy modules build on.

## 2. File-by-file walkthrough

### `src/modules/models/types.ts` (60 lines)

A barrel + small domain types file. Two distinct jobs:

- **Re-exports from `@local-studio/contracts`** (types.ts:5, types.ts:6-28) — `ModelInfo`, `ServiceInfo`, `SystemConfig`, `RuntimeBackendInfo`, compatibility-report types, etc. Note that most of these are *system* types, not models types; this file acts as a convenience re-export hub that other controller modules import from rather than importing the contracts package directly.
- **Branded `RecipeId`** (types.ts:30-36) — a nominal-typing trick: `type Brand<Primitive, Label> = Primitive & { readonly __brand: Label }`. `RecipeId` is a `string` that only flows where a recipe ID is expected. `asRecipeId` is the (unchecked) cast used after validation.
- **`ControllerRecipe`** (types.ts:38-42) — `Omit<RecipeBase, "id"> & { id: RecipeId }`. Exported under the alias `Recipe` (types.ts:42), so everywhere else in the codebase `Recipe` means the controller-side branded version of the wire type `RecipeBase` (defined in `contracts/recipes.ts:14`).
- **`ProcessInfo`** (types.ts:44-49) — the public observability process info plus `backend` (which may be `"unknown"`) and `served_model_name`. This is what `findObservedInferenceProcess` returns and what `isRecipeRunning` consumes.
- `LaunchResult` (types.ts:51-56) and `GpuInfo` (types.ts:58) — used by engine/system modules; declared here somewhat arbitrarily.

### `src/modules/models/recipes/recipe-serializer.ts` (270 lines)

The most logic-dense file in the slice: turns *untrusted* recipe JSON into a validated `Recipe`. Two exports.

**`normalizeRecipeInput(raw)`** (recipe-serializer.ts:76-174) — a pure pre-validation normalizer that absorbs every historical/legacy shape the controller has ever accepted:

- Legacy field renames: `engine` → `backend` (:92-95), `tp`/`pp` → `tensor_parallel_size`/`pipeline_parallel_size` (:101-106), `env-vars`/`envVars` → `env_vars`, including variants hiding inside `extra_args` (:113-132).
- Legacy `vision` flag living in `extra_args` promoted to a top-level field (:82-90).
- **Runtime inference** via `normalizedRuntime` (:25-41): if no explicit `runtime` object, derive one — `docker_image` in extra args → `{kind:"docker"}`, `python_path` → `{kind:"system"}`, otherwise `defaultRuntime(backend)` (:18-23) maps `llamacpp` → `{kind:"binary", ref:"llama-server"}` and everything else → `{kind:"managed_venv", ref: backend}`. Also renames legacy `kind: "venv"` → `"managed_venv"` (:32).
- **Denylist scrub**: deletes `status` and `crash_loop` from both top level and `extra_args` (:108-111) so a client can't forge runtime state.
- **Unknown-key sweep** (:134-170): any top-level key not in the `knownKeys` allowlist is *moved into `extra_args`* rather than dropped. This is the forward-compatibility story — newer frontends can send fields this controller doesn't know yet and they survive a round-trip.

**`recipeSchema`** (recipe-serializer.ts:179-212) — an Effect v4 `Schema.Struct` describing the canonical shape. Notable: `id` uses `Schema.String.check(Schema.isNonEmpty())` (:182) with a comment explaining an empty ID would create an unaddressable ghost recipe; `backend` is a closed literal union `vllm|sglang|llamacpp|mlx`; `runtime` must match `serveRuntimeSchema` (:9-13).

**`parseRecipe(raw)`** (recipe-serializer.ts:219-269) — normalize → apply defensive defaults → `Schema.decodeUnknownSync` → brand the ID. The defaults block (:224-250) is where the coercion helpers earn their keep:

- `coercePositiveInt` (:47-56) clamps `tensor_parallel_size`, `max_model_len`, `port` etc. to sane ranges, with an explicit comment that a `NaN` previously *failed validation and silently vanished the recipe* while a negative value sailed through to the launch command — clamping beats both failure modes.
- `clampFraction` (:58-63) keeps `gpu_memory_utilization` in `[0.01, 1]`, default `0.9`.
- `trust_remote_code` defaults to **true**, overridable via `LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE=false` (:234-237) — a deliberate convenience-over-paranoia default.
- `decodeUnknownSync` is called with `onExcessProperty: "preserve"` (:222), belt-and-braces alongside the unknown-key sweep.
- Final step converts `env_vars` values to strings (:251-255) and brands `id` with `asRecipeId` (:258).

Note: `parseRecipe` is **not** an Effect — it throws on invalid input (both from `normalizeRecipeInput`'s explicit throw and `decodeUnknownSync`). Callers (`RecipeStore`, `recipe-routes.ts`) wrap it in try/catch or `Effect.try`.

### `src/modules/models/recipes/recipe-store.ts` (178 lines)

SQLite persistence for recipes. `RecipeStoreError` (recipe-store.ts:7-14) is a `Schema.TaggedErrorClass` with an `operation` literal union (`open|list|get|save|delete|import|close`) — the standard typed-error idiom in this codebase.

**`RecipeStore`** (recipe-store.ts:23-178) — a plain class whose methods each return `Effect.Effect<..., RecipeStoreError>` by wrapping synchronous `bun:sqlite` calls in `Effect.try`/`Effect.tryPromise`:

- **Constructor** (:27-37): opens the DB via `openSqliteDatabase` (from `src/stores/sqlite.ts:72`, which sets `busy_timeout`, `chmod 600`s the file, and drops obsolete tables), runs `migrate()`, and on failure closes the DB and rethrows as `RecipeStoreError("open")`.
- **`migrate()`** (:46-66): handles a schema rename — the payload column was once `json`, now `data`. It introspects `sqlite_master` + `PRAGMA table_info` and sets the private `useJsonColumn` flag; every other method then interpolates the right column name. No data migration is performed — both shapes are read natively.
- **`list()`** (:68-86): reads all rows ordered by id and `flatMap`s through `parseRecipe`, **swallowing per-row parse failures** (`catch { return [] }` :79-81). A corrupt recipe row silently disappears from listings rather than poisoning the whole list. Same policy in `get()` (:88-106).
- **`save()`** (:108-132): upsert via `INSERT ... ON CONFLICT(id) DO UPDATE`, bumping `updated_at`. Note the two code paths differ slightly: the `json`-column branch also writes `created_at` on insert.
- **`importFromJson()`** (:141-170): the only genuinely Effect-composed method — `Effect.tryPromise(readFile)` → `Effect.try(JSON.parse)` → `Effect.forEach` over entries, each parsed defensively (`parseRecipe` failure → `null` → counts 0), summing the number imported. Accepts either one object or an array.
- **`static open()`** (:39-44) + **`close()`** (:172-177): used with `Effect.acquireRelease` in `src/app-context.ts:140-142` so the DB handle is scoped to the app lifetime.

There is no caching or locking here — it relies on SQLite (`busy_timeout = 5000`) and Bun's synchronous driver.

### `src/modules/models/recipes/recipe-matching.ts` (73 lines)

One pure function, **`isRecipeRunning(recipe, current, options)`** (recipe-matching.ts:29-73), answering "does this observed inference process correspond to this recipe?". Matching cascade:

1. `served_model_name` equality, case-insensitive (:34-41).
2. Normalized (trailing-slash-stripped) exact path equality (:47-52).
3. Optional contains-style matching, controlled by `RecipeMatchOptions` (:4-7): `allowEitherPathContains` checks the prefix relation in both directions; `allowCurrentContainsRecipePath` only one. Crucially these use **`isPathPrefix`** (:14-15), which requires a `/` segment boundary — the comment (:11-13) explains a naive substring check would match `/models/llama` against `/models/llama-3.1-8b`.
4. **Basename fallback** (:69-71) — but *only when one side has no directory component*, per the comment (:64-68): comparing basenames of two full paths would falsely match `/a/model.gguf` with `/b/model.gguf` and report a launch as already-running while serving the wrong model.

This is the shared, hardened matcher; seven call sites across `engines`, `proxy`, and `system` modules import it (see Connections).

### `src/modules/models/model-browser.ts` (196 lines)

Effect-wrapped filesystem scanning for "what model directories exist on disk".

- **`ModelBrowserError`** (model-browser.ts:20-28) — `Schema.TaggedErrorClass` with `operation: read|stat|scan`, `path`, `message`, `source`.
- **Constants** (:6-18): weight extensions (`.safetensors/.bin/.gguf`), config filenames (`config.json`), and `MODEL_QUANTIZATION_SIGNATURES` (`awq`, `gptq`, `gguf`, `fp16`, `bf16`, `int8`, `int4`, `w4a16`, `w8a16`) used for substring-based quantization guessing.
- **`looksLikeModelDirectory(path)`** (:45-56) — a directory qualifies if it contains `config.json` *or* any weight file.
- **`inferQuantization(name)`** (:58-61) — first signature found in the lowercased name; order of the array matters (`gguf` before `fp16` etc.).
- **`readConfigMetadata(dir)`** (:63-98) — reads `config.json`, extracts `architectures[0]` and a context length probed across four key spellings (`max_position_embeddings`, `max_seq_len`, `seq_length`, `n_ctx`), tolerating numeric strings.
- **`estimateWeightsSizeBytes(dir, recursive)`** (:100-132) — sums sizes of weight files. Handles being pointed at a single file (:109-111). Recursion failures per-entry are caught and treated as 0/null (`Effect.catch(() => Effect.succeed(...))` :121-128), so one unreadable subdirectory doesn't fail the scan. Returns `null` (not 0) when nothing found — distinguishing "no weights" from "empty".
- **`discoverModelDirectories(roots, maxDepth=1, maxModels=500)`** (:134-167) — iterative breadth-first walk with an explicit queue, a `seen` set, a depth cap, and a global `maxModels` cap. All I/O errors are swallowed to `false`/`null` (:147-158); return type is `Effect<string[], never>` — it *cannot* fail. Hidden dot-directories are skipped (:161).
- **`buildModelInfo(dir, recipeIds)`** (:169-196) — assembles the `ModelInfo` contract object (name, path, size, mtime, architecture, quantization, context length, linked recipe IDs, `has_recipe`). Also unfailing (`never` error channel); every sub-effect degrades to nulls.

### `src/modules/models/routes.ts` (425 lines)

Four read-only GET routes, all built with the codebase's `defineRoutes`/`mergeRoutes`/`documentRoute`/`effectHandler` helpers (see Key patterns). Registration entry point: `registerModelsRoutes` (routes.ts:72).

**`GET /v1/models`** (routes.ts:74-155) — OpenAI-compatible model listing:

1. List all recipes from `recipeStore` (:79).
2. Find the observed inference process (`findObservedInferenceProcess`, :80) — a thin observability wrapper around `processManager.findInferenceProcess(inference_port)`.
3. If something is running, fetch the engine's own `/v1/models` with a 5 s timeout (:85-93) and decode with the lenient `ActiveModelsSchema` (:25-29, only `data[].max_model_len` is modeled); **all failures degrade to `null`** via `Effect.catch(() => Effect.succeed(null))` — the route never fails because the engine is unreachable.
4. For each recipe, decide `active` by its **own inline matching logic** (:100-115): served-name equality, then *substring* `includes` path checks in both directions, then basename equality. (See §7 — this is a looser duplicate of `isRecipeRunning`.) When active, the live `max_model_len` from the engine overrides the recipe value (:116-118).
5. Each entry's `metadata` is built by `resolvedRecipeMetadata` (:60-70): spreads `recipe.extra_args["metadata"]` and injects a resolved `vision` capability from `resolveModelVision` (contracts package), trying the model id, recipe id/name/path, and the explicit `recipe.vision` override.
6. **Mock/empty fallback** (:132-149): if there are no recipes at all but mock inference is enabled (`LOCAL_STUDIO_MOCK_INFERENCE`) or a process is running anyway, synthesize a single model from `LOCAL_STUDIO_MOCK_MODEL_ID` / the observed process, defaulting `max_model_len` to 32768.

Response shape is hand-rolled (`OpenAIModelList`/`OpenAIModelInfo` interfaces, :10-23) with a non-standard `active` boolean and `metadata` bag.

**`GET /v1/models/:modelId`** (routes.ts:157-210) — same building blocks for a single model: linear scan of recipes matching `served_model_name` or `id` (:164-173), 404 via `Effect.fail(notFound(...))` (:175) which the global `onError` in `src/http/app.ts:132` converts to an HTTP response. Active check here uses only a one-directional `current.model_path.includes(recipe.model_path)` (:181-187) — subtly different from both the list route and `isRecipeRunning`.

**`GET /v1/studio/models`** (routes.ts:212-318) — the disk browser backing the Studio UI:

1. Build two lookup maps from recipes: by canonical absolute model path and by basename (:217-243), with `expandUserPath` handling `~` (:221-226).
2. Build a `rootIndex` of scan roots (:245-263): the configured `models_dir` (:265, source `"config"`) plus every absolute recipe path's parent directory (:267-277, source `"recipe_parent"`). Each root records `exists` (`existsSync`, only evaluated at first insertion — :254) and which sources/recipes pointed at it.
3. `discoverModelDirectories(scanRoots, 2, 1000)` (:284) — note depth **2** and cap **1000**, overriding the function's defaults of 1/500.
4. `Effect.forEach(..., { concurrency: "unbounded" })` (:285-299) maps each directory through `buildModelInfo`, attaching recipe IDs by exact path match, falling back to basename match *only when unambiguous* (`byName.length === 1`, :290-294).
5. Response includes `models`, the `roots` report (with sources), and `configured_models_dir` (:304-315).

**`GET /v1/huggingface/models`** (routes.ts:320-423) — proxy to HuggingFace's public API:

1. Query params: `search`, `filter`, `sort` (mapped through a `sortMapping` table to HF field names, defaulting unknown sorts to `trendingScore` :331-339), `limit` clamped to [1,100], `offset` ≥ 0 (:325-329).
2. Because HF's API doesn't do server-side offset here, it fetches `limit + offset` rows (capped at 500, :340) and slices client-side (:392).
3. **Dual fetch** via `Effect.all` (:369-380): the search list, plus — when `search` looks like `owner/repo` — a direct `GET /api/models/{search}` for an exact hit (:371-379). Both are `Effect.tryPromise(fetch)`.
4. Results are `normalize`d (:355-366) to guarantee `_id`/`modelId`/`downloads`/`likes`/`tags`/`private` fields; the exact match is prepended and de-duplicated (:394-407).
5. Error policy: non-OK list response → passthrough JSON error with HF's status (:383-388); fetch failure → 503 with `detail` (:412-419). Both HuggingFace responses are decoded through permissive `Schema.Record(String, Unknown)` schemas (:31-32) — essentially just "must be JSON of the right container shape".

Minor wart: the imports of sibling/core helpers sit at routes.ts:41-45, *after* the `decodeResponse` helper — imports were appended rather than merged at the top.

## 3. How data/control flows

**OpenAI model list** — `GET /v1/models` → Hono → `effectHandler` runs the Effect on the controller runtime (`src/http/effect-handler.ts:31-36`) → `context.stores.recipeStore.list()` (`routes.ts:79` → `recipe-store.ts:68` → SQLite `SELECT data FROM recipes` → per-row `parseRecipe` `recipe-serializer.ts:219`) → `findObservedInferenceProcess` (`routes.ts:80` → `processManager` scan of `inference_port`) → optional live fetch `fetchInference(context, "/v1/models")` (`routes.ts:85` → `src/http/local-fetch.ts:62` → `http://{inference_host}:{inference_port}/v1/models`) → merge per recipe → `ctx.json`.

**Recipe write path** (lives in the engines module, but terminates here) — `engines/recipe-routes.ts` parses bodies with `parseRecipe` and calls `recipeStore.save()` → upsert (`recipe-store.ts:108`). Reads go the other way: `list()/get()` → `JSON.parse` → `parseRecipe` — meaning **validation happens on both write and read**, and every read re-normalizes legacy rows.

**Studio browser** — `GET /v1/studio/models` → roots assembled from config + recipe parents (`routes.ts:265-277`) → BFS scan (`model-browser.ts:134`) → per-directory `buildModelInfo` (`model-browser.ts:169`) → recipe linkage by path/basename (`routes.ts:288-295`) → JSON.

**Running-recipe correlation** (consumed elsewhere) — an observed `ProcessInfo` + a stored `Recipe` → `isRecipeRunning` (`recipe-matching.ts:29`) → boolean used by engines (launch dedupe, eviction), proxy (model→recipe resolution), logs, and throughput modules.

**Error channel** — store errors are typed `RecipeStoreError`s propagating up the Effect error channel until `effectHandler` rethrows (`effect-handler.ts:20-29`); `HttpStatus` errors (e.g. `notFound` at `routes.ts:175`) are translated to responses by the global `onError` (`src/http/app.ts:132`). Everything touching the network or filesystem inside this slice is deliberately caught down to `null`/defaults, so these routes almost never surface 5xx except store failures.

## 4. Key patterns & idioms

- **Effect as error-tracking wrapper, not concurrency framework.** Most code here is `Effect.try`/`Effect.tryPromise` around sync/async imperative work, composed with `Effect.gen(function* () { ... })` and `yield*`. Read `yield* x` as "`await` x, but failures short-circuit through a typed error channel". The error type parameter (`Effect.Effect<A, RecipeStoreError>`) is documentation the compiler enforces.
- **`Schema.TaggedErrorClass`** — typed errors as schema-decodable classes with a `_tag` discriminant (`RecipeStoreError`, `ModelBrowserError`). Constructed with field objects; matched upstream by tag. Defined at recipe-store.ts:7 and model-browser.ts:20.
- **Graceful degradation via `Effect.catch(() => Effect.succeed(fallback))`** — the dominant idiom in `model-browser.ts` and the `/v1/models` route: every optional data source (live engine fetch, config.json, stat) has a null/default fallback. Functions advertising error type `never` (`discoverModelDirectories`, `buildModelInfo`) have caught everything internally.
- **Hono wiring trio** — `defineRoutes((app, context) => mergeRoutes(app.get(...), ...))` (`src/http/route-registrar.ts:18-26`): `defineRoutes` just closes over `AppContext` with types; `documentRoute` attaches OpenAPI metadata; `effectHandler` bridges Effect → Promise for Hono. `mergeRoutes` returns `routes[0]` cast to an intersection type — the routes are all registered on the same mutable Hono app; the "merge" is purely a type-level trick.
- **Sync SQLite wrapped in Effect.** `bun:sqlite` is synchronous; each `RecipeStore` method wraps one statement in `Effect.try` so errors join the typed channel. No prepared-statement reuse, no transactions (each method is a single statement anyway).
- **Branded types** for nominal IDs (`Brand`/`RecipeId`, types.ts:30-36) — zero runtime cost; only `asRecipeId` casts.
- **Validate-at-the-boundary, leniently.** `recipeSchema` validation is preceded by aggressive normalization and defensive clamping so that old DB rows and partial API payloads survive. Contrast with the HF proxy, which validates almost nothing (`Record(String, Unknown)`).
- **Contracts as the source of truth.** Wire shapes (`RecipeBase`, `ModelInfo`, `ProcessInfo`) come from `@local-studio/contracts`; this module only adds controller-side refinements.

## 5. Connections

**Depends on:**

- `@local-studio/contracts` — `recipes.ts` (`RecipeBase`, `Backend`), `model-capabilities.ts` (`resolveModelVision`), `observability.ts`, `system.ts` (type re-exports).
- `src/http/effect-handler.ts`, `src/http/route-registrar.ts` — handler/route plumbing.
- `src/http/local-fetch.ts` (`fetchInference`), `src/core/function-observability.ts` (`findObservedInferenceProcess`), `src/core/errors.ts` (`notFound`), `src/core/validation.ts` (`parseBooleanFlag`), `src/stores/sqlite.ts` (`openSqliteDatabase`).
- `AppContext` (`src/app-context.ts`) — provides `stores.recipeStore` (constructed at app-context.ts:140-142 via `Effect.acquireRelease`), `config.models_dir`, `config.inference_port/host`, `processManager`.

**Depended on by:**

- `src/http/app.ts:11,93` — mounts `registerModelsRoutes`.
- `src/modules/engines/` — `recipe-routes.ts` uses `parseRecipe` + `isRecipeRunning`; `lifecycle-routes.ts` and `engine-coordinator.ts` use `isRecipeRunning` (with `allowEitherPathContains`) for launch dedupe/eviction; `engine-coordinator.ts` injects `RecipeStore`.
- `src/modules/proxy/openai-routes.ts:5,154` — `isRecipeRunning` to resolve which recipe a requested model maps to.
- `src/modules/system/` — `routes.ts:12` (`estimateWeightsSizeBytes`), `logs-routes.ts:13,226` (`isRecipeRunning` with `allowCurrentContainsRecipePath`), `llamacpp-throughput.ts:3,64`.
- `src/modules/studio/routes.ts:13` — `discoverModelDirectories`, `estimateWeightsSizeBytes`.

So `recipe-matching.ts` is the most widely imported unit in the slice, and `Recipe`/`parseRecipe` are the de-facto recipe ABI for the whole controller.

## 6. How to read this code

Suggested order:

1. **`types.ts`** — five minutes. Learn that `Recipe` = branded `RecipeBase`, and what `ProcessInfo` carries. Cross-reference `contracts/recipes.ts:14` for the full field list.
2. **`recipes/recipe-serializer.ts`** — read `parseRecipe` (the public entry) first, then `recipeSchema`, then `normalizeRecipeInput`. This is where "what is a recipe, really" gets answered; pay attention to the coercion helpers and the comments — they encode production incidents.
3. **`recipes/recipe-store.ts`** — straightforward once you accept "sync sqlite in `Effect.try`". Watch `migrate()` and the silent per-row failure policy in `list()`.
4. **`recipes/recipe-matching.ts`** — short; read the two comments, they justify every branch. This is the reference matcher to compare the routes' inline logic against.
5. **`model-browser.ts`** — notice which functions can fail (`ModelBrowserError` in the type) vs. which are `never` and why (they catch internally).
6. **`routes.ts`** — read last, top to bottom; by now every helper is familiar. Keep an eye on how its inline active-matching differs from `isRecipeRunning`.

First things to look for in any file here: the error type in each `Effect.Effect<...>` signature (tells you the failure policy), and any `Effect.catch(() => Effect.succeed(...))` (tells you where data is optional).

## 7. Noteworthy / surprising

- **Duplicated, divergent matching logic.** `routes.ts` does not use `isRecipeRunning`; `/v1/models` (:106-114) uses raw substring `includes()` in both directions plus unconditional basename equality — exactly the false-positive pattern `recipe-matching.ts:64-68` warns about. `/v1/models/:modelId` (:185) uses a third, asymmetric variant. Two recipes whose paths share a prefix (e.g. `/models/llama` and `/models/llama-3.1-8b`) can both be reported `active: true`. Likely predates the hardened matcher; worth consolidating.
- **`trust_remote_code` defaults to true** (recipe-serializer.ts:234-237) — convenient but runs arbitrary modeling code by default; only the env var turns it off globally.
- **Silent data loss by design**: corrupt recipe rows vanish from `list()` (recipe-store.ts:79-81), and unreadable directories vanish from scans. Great for UX, invisible for ops — there is no logging on these paths.
- **`types.ts` is a grab-bag**: most of its re-exports (`RuntimeRocmInfo`, `CompatibilityReport`, ...) are system-module types with nothing to do with models; importers across the controller pull them from here, making this file a coupling hub.
- **`rootIndex` staleness**: `exists` is computed once at first insertion (routes.ts:254); a root added via `addRoot` later for another source reuses the first evaluation — fine within one request, but the pattern would bite if the index were ever long-lived.
- **`existsSync` and `queue.shift()`**: the disk browser mixes sync fs calls and an O(n) queue shift into an otherwise Effect-async pipeline; harmless at the 1000-model cap, but the concurrency-unbounded `Effect.forEach` (routes.ts:298) can fan out hundreds of parallel `stat`/`readFile` calls on huge model collections.
