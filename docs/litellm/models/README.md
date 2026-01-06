# LiteLLM Models (Naming + Routing)

This repo has *two* “model registries” that need to agree on naming, or model switching will feel inconsistent:

1. **Controller recipes** (`/recipes`, stored in `./data/controller.db`)
2. **LiteLLM model_list** (`config/litellm.yaml`)

## LiteLLM `model_list` basics

LiteLLM matches the incoming request’s `model` against `model_list[*].model_name` and forwards it according to `litellm_params`.

In `config/litellm.yaml`:

- Explicit entries (examples):
  - `model_name: "GLM-4.7-REAP-50"` → forwards to `api_base: http://host.docker.internal:8000/v1`
  - `model_name: "MiniMax-M2.1"` → same
- Wildcard catch-all:
  - `model_name: "*"` → forwards any other model name to the same inference server

This means LiteLLM will almost always forward your request somewhere, even if the “requested model” isn’t actually loaded.

## Controller recipe matching (for auto-switch)

The controller’s auto-switch logic (used by `POST /v1/chat/completions`) only switches models when it can map the requested `model` to a recipe:

- Match by `recipe.served_model_name` **or**
- Match by `recipe.id`

If there is no match, the controller does **not** switch anything and simply forwards to LiteLLM.

### Practical consequence

- If the UI sends `model: "GLM-4.7-REAP-50"` but your recipe uses `id: "glm-4.7-reap-50"` and does **not** set `served_model_name: "GLM-4.7-REAP-50"`, then:
  - Controller will not switch (no recipe match).
  - LiteLLM wildcard will still forward the request to the *currently running* inference server.
  - Result: “sometimes it works, sometimes nothing happens”, depending on what was already loaded.

## Recommendations

- Pick one canonical name and use it consistently:
  - Either set `recipe.served_model_name` to the exact LiteLLM `model_name`, **or**
  - Ensure the UI uses `recipe.id` as the `model` field for chat requests.
- Avoid relying on LiteLLM wildcard routing for local models unless you intentionally want “whatever is running”.

