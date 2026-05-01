# Models module — `controller/src/modules/models/`

The models module is the **Phase-3** consolidation. It absorbs
`lifecycle/recipes/` and `lifecycle/types.ts` (and a handful of
recipe-related bits scattered across the old code) into a single tree
that owns:

- The `Recipe` type and its persistence (SQLite via `RecipeStore`).
- HTTP routes for `/v1/models`, `/v1/studio/models`, and the
  `model-browser` filesystem walker.
- The `isRecipeRunning(recipe, current)` predicate used everywhere we
  need to ask "is this recipe live right now?"

## Layout

```
controller/src/modules/models/
├── index.ts            # public exports
├── routes.ts           # 314 LoC — /v1/models /v1/studio/models /v1/studio/models/local
├── routes.test.ts
├── model-browser.ts    # 200 LoC — filesystem walker + buildModelInfo + estimateWeightsSizeBytes
├── types.ts            #  93 LoC — Recipe / ProcessInfo / LaunchResult / GpuInfo / model browser types
└── recipes/                                          # was lifecycle/recipes/
    ├── recipe-store.ts        # 179 LoC — SQLite persistence
    ├── recipe-store.test.ts
    ├── recipe-matching.ts     #  60 LoC — isRecipeRunning
    └── recipe-serializer.ts   # 149 LoC — parseRecipe + recipeFromBody validation
```

## `types.ts` — the core domain type

`Recipe` is now defined here, not in `lifecycle/types.ts`. It extends
`RecipeBase` from the controller-internal `shared/recipe-types.ts` and
brands the id (`RecipeId` from `types/brand.ts`):

```ts
export interface Recipe extends Omit<RecipeBase, "id"> {
  id: RecipeId;
}
```

The branded `RecipeId` provides compile-time safety against passing a
raw string where a recipe id is expected. `RecipeBase` carries the
shape (`name`, `backend`, `model_path`, `served_model_name`,
`max_model_len`, `gpu_count`, `gpu_indexes`, `parameters`, `extra_args`,
…) and is shared with the frontend through the `shared/` workspace
package — except that package no longer exists. See
[`shared-types-and-app-context.md`](shared-types-and-app-context.md) for
how the type is now exposed through `controller/src/modules/shared/`.

`types.ts` also re-exports the runtime info / compat report types
straight from `modules/shared/system-types.ts`. Modules that used to
import from `controller/src/modules/lifecycle/types.ts` now import from
here.

## `recipes/recipe-store.ts` (179 LoC)

A thin SQLite-backed store with a typed surface:

```ts
class RecipeStore {
  list(): Recipe[];
  get(id: string): Recipe | null;
  save(recipe: Recipe): void;             // upsert
  delete(id: string): boolean;
  count(): number;
}
```

Persists to the `recipes` table in the controller database (path comes
from `context.config.data_dir`).

## `recipes/recipe-matching.ts` (60 LoC) — `isRecipeRunning`

The single predicate consumed by `engines/`, `models/`, `proxy/`, and
the metrics collector. Match order is deliberately precise:

1. `served_model_name` (case-insensitive exact match).
2. Normalised exact `model_path` match.
3. Optional `contains`-style match (controlled by
   `allowCurrentContainsRecipePath` / `allowEitherPathContains`) — used
   by the metrics collector, where the recipe path may be a sub-path of
   the actually-running process.
4. `basename(modelPath)` match — last-resort fallback.

Centralising this avoided four different ad-hoc implementations that
existed across `lifecycle-routes`, `proxy/openai-routes`,
`monitoring/metrics-collector`, and the chat surface (now deleted).

## `recipes/recipe-serializer.ts` (149 LoC)

Validates and parses the recipe payload from the frontend into a
`Recipe`, throwing readable errors for missing or invalid fields. Used
by the engines `POST /recipes` and `PUT /recipes/:id` routes.

## `model-browser.ts` (200 LoC)

The filesystem walker behind `GET /v1/studio/models/local`:

- `discoverModelDirectories(dataDir)` — walks `${dataDir}/models/` for
  HF-style folders that contain `config.json` or any `*.gguf`.
- `buildModelInfo(path)` — derives `{ id, name, size_bytes,
  config_json, has_gguf, has_safetensors, … }` for each.
- `estimateWeightsSizeBytes(model, contextLength, dtype)` — also used by
  `system/routes.ts:POST /vram-calculator` to predict VRAM use.

## `routes.ts` (314 LoC)

Endpoints:

```
GET /v1/models                  — OpenAI-compatible list, marked active for the running recipe
GET /v1/studio/models           — Studio-shaped list with extra metadata
GET /v1/studio/models/local     — Filesystem-discovered models (model-browser)
GET /v1/studio/models/:recipeId — Single recipe with active flag
```

`/v1/models` cross-references each recipe against the
currently-running process via `isRecipeRunning(...)` (using the
`allowEitherPathContains` option) to mark the active model. It also
fetches the live `/v1/models` from the inference server to pull the
real `max_model_len` if available.

`isMockInferenceEnabled()` in `routes.ts` checks
`VLLM_STUDIO_MOCK_INFERENCE` (`1` / `true` / `yes` / `on`) and short-
circuits HTTP calls to the inference server — useful for tests and
the demo build.

## What changed vs `origin/main`

- The whole `lifecycle/recipes/` subtree moved here verbatim (3
  files + 1 test).
- `lifecycle/types.ts` was merged into `types.ts`. Some narrow types
  (`SystemConfigResponse`, `RuntimeInfo`, `RuntimePlatformInfo`, …)
  moved through the `modules/shared/system-types.ts` indirection.
- `model-browser.ts` was already present here on `origin/main`; no
  significant logic changes other than imports.
- `routes.ts` adds **+74 LoC** to `types.ts` (new
  `ModelsModuleConfig`, `ModelBrowserRecord`, additional re-exports)
  and is otherwise stable.

## Chapter 7 candidates

- The `recipes/` sub-tree being **inside** `models/` is debatable —
  recipes are arguably more about *engines* (they're parameterised
  launch instructions) than about *models* (they're not model
  metadata). Phase-3's choice was to keep them with the data they
  describe. Worth reconsidering when chat is no longer the only thing
  driving the type's shape.
- The boundary between `/v1/models` (OpenAI-compat) and
  `/v1/studio/models` (Studio-shaped) is two endpoints over the same
  data — a thin "view" layer that picks fields would simplify the
  314-LoC routes file.
