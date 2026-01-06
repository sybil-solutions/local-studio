# Recipes UI (Next.js)

The Recipes page (`/recipes`) is where you create/edit “recipes” (model launch configs) and connect them to local model weight directories on disk.

## Data sources

- `GET /recipes` → list recipes + status (`running` / `starting` / `stopped`)
- `GET /recipes/{id}` → load a single recipe
- `POST /recipes` / `PUT /recipes/{id}` / `DELETE /recipes/{id}` → CRUD
- `GET /v1/studio/models` → discover local model directories + link to `recipe_ids`
- `POST /launch/{recipe_id}` → launch (invoked via the UI “Launch” buttons)
- `GET /events` (SSE) → launch progress toast + live updates

## UX layout

- Top tabs:
  - **Recipes**: recipe editor + sidebar
  - **Tools**: VRAM calculator (separate workflow)
- Sidebar tabs (within the Recipes tab):
  - **Recipes**: searchable list of saved recipes
  - **Models**: searchable list of local model directories discovered on disk

## Creating recipes from local model weights

Use the sidebar **Models** tab:

- If a model has `recipe_ids`, the row shows a picker (when multiple) and one-click:
  - **Launch** (starts the chosen recipe)
  - **Open** (loads the recipe into the editor)
- If a model has no recipes, **Create** pre-fills a new recipe draft using:
  - `model_path` = model directory path
  - `id` = slugified model name
  - `name` = model name
  - `served_model_name` = `id` (so the inference backend serves a stable model id)
  - `max_model_len` / `quantization` when discoverable from `config.json` / folder name

## Model discovery roots

`GET /v1/studio/models` scans:

- `VLLM_STUDIO_MODELS_DIR` (configured root)
- parents of any *local* recipe `model_path`s

The Models sidebar shows “Scan roots” and whether each exists. If your configured `models_dir` is missing, set `VLLM_STUDIO_MODELS_DIR` and restart the controller.

