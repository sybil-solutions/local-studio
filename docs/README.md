# vLLM Studio Docs

This folder is a working reference for how the repo is wired together (controller ↔ LiteLLM ↔ frontend) and where to look when model launches feel stuck or inconsistent.

## App

- `docs/app/controller/README.md` - Model lifecycle controller (recipes, launch/evict, SSE, chat proxy)
- `docs/app/frontend/README.md` - Next.js UI, API proxying, SSE subscriptions, launch UX
- `docs/app/frontend/recipes.md` - Recipes page UX (including local model discovery + recipe creation)

## LiteLLM

- `docs/litellm/README.md` - Docker compose service and config overview
- `docs/litellm/models/README.md` - Model naming/routing rules and how they interact with controller recipes

## Runtime / Ops

- `docs/runtime/venvs.md` - How recipe `python_path` / `venv_path` select the runtime and why versions can drift
- `docs/operations/debugging.md` - Practical “what is going on?” checklist for stuck launches / wrong model
