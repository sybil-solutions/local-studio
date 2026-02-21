# Frontend AGENTS

## Rebuild / Port 3002

If the UI is served from the standalone build on port 3002 (e.g. `.next/standalone`), changes in `frontend/src` will not show up until you rebuild and restart the server.

Recommended commands:

- Dev mode on 3002 (hot reload):
  - `npm run dev -- -p 3002`

- Production build on 3002:
  - `npm run build`
  - `PORT=3002 npm run start`

Quick rebuild (when port 3002 looks stale or broken):

- `npm run build`
- `PORT=3002 npm run start`

## Standalone server note

If you run the standalone server directly (`node .next/standalone/server.js`), you must copy static assets after each build or the UI will be unstyled and non-interactive:

- Copy `.next/static` → `.next/standalone/.next/static`
- Copy `public` → `.next/standalone/public`

---

## Runtime Upgrade Panel

- The `Recipes → Runtime` screen (`frontend/src/app/recipes/_components/vllm-runtime-panel.tsx`) is the canonical UI for checking vLLM/SGLang/llama.cpp plus CUDA/ROCm versions and kicking off upgrades.
- Changes to the upgrade flow should stay in sync with `frontend/src/lib/api/studio.ts` routes (`/runtime/*` and `/runtime/*/upgrade`) and the controller runtime handlers in `controller/src/modules/lifecycle/runtime-routes.ts`.
- When infrastructure or runtime upgrade payloads change, update this AGENTS file and `README.md` so the team knows which endpoints the frontend consumes for runtime coordination.
- Runtime payload contract:
  - `/runtime/vllm/upgrade`: `{ prefer_bundled?: boolean, command?: string, args?: string[], version?: string }`
  - `/runtime/sglang/upgrade`: `{ command?: string, args?: string[] }`
  - `/runtime/llamacpp/upgrade`: `{ command?: string, args?: string[] }`
  - `/runtime/cuda/upgrade`: `{ command?: string, args?: string[] }`
  - `/runtime/rocm/upgrade`: `{ command?: string, args?: string[] }`

---

## Codex Skills

- `skills/vllm-studio` — ops/deploy/env keys.
- `skills/vllm-studio-backend` — backend architecture + OpenAI compatibility.
