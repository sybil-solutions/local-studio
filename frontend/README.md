<!-- CRITICAL -->
# frontend

Next.js web UI for vLLM Studio.

## Local Development

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

By default, browser requests go through `/api/proxy`, which forwards to the controller backend using `/api/settings`.

## Validation

```bash
cd frontend
npm run build
npm run lint
npm test
```

## Runtime Notes

- Production start command: `npm run start` (standalone server).
- Backend URL/API key can be configured in the app `Configs` page.
- Proxy route: `src/app/api/proxy/[...path]/route.ts`.

## Runtime Management Panel

- Runtime details and upgrades live in `Recipes → Runtime` (`frontend/src/app/recipes/_components/vllm-runtime-panel.tsx`).
- The UI calls `frontend/src/lib/api/studio.ts` routes (e.g., `GET /runtime/vllm`, `/runtime/sglang`, `/runtime/llamacpp`, `/runtime/cuda`, `/runtime/rocm`) to hydrate versions, paths, and tooling status for vLLM, SGLang, llama.cpp, CUDA, and ROCm.
- Upgrade buttons POST to `/runtime/<backend>/upgrade` (see `frontend/src/lib/api/studio.ts` and `controller/src/modules/lifecycle/runtime-routes.ts`), so backend-side command hooks must stay in sync with this panel.
- Anytime controller runtime upgrade behavior changes, refresh the panel UI and document the expected payload/response shapes in these files to keep the README and AGENTS guidance aligned.
