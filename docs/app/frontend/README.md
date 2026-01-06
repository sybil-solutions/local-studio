# Frontend (Next.js)

The UI is a Next.js app that talks to the controller via a built-in proxy route and subscribes to controller SSE for status + launch progress.

Key files:

- Dashboard: `frontend/src/app/page.tsx`
- Recipes editor: `frontend/src/app/recipes/page.tsx`
- Chat UI: `frontend/src/app/chat/page.tsx`
- Controller proxy (browser → Next → controller): `frontend/src/app/api/proxy/[...path]/route.ts`
- Client API wrapper: `frontend/src/lib/api.ts`
- SSE hooks: `frontend/src/hooks/useSSE.ts`, `frontend/src/hooks/useRealtimeStatus.ts`
- Recipes UX notes: `docs/app/frontend/recipes.md`

## How API calls work

Most client-side calls use `APIClient('/api/proxy', true)` (`frontend/src/lib/api.ts`):

- Browser requests `GET /api/proxy/recipes`
- Next route forwards to `BACKEND_URL` (controller, default `http://localhost:8080`)
- Auth: prefers browser `Authorization` header, falls back to server `API_KEY` env

SSE (`text/event-stream`) is also forwarded transparently by the proxy route.

## Dashboard launch UX

On the dashboard (`frontend/src/app/page.tsx`):

- Clicking a recipe triggers `POST /launch/{recipe_id}?force=true` via `api.switchModel()`.
- A toast is shown while either:
  - a local `launching` flag is true, or
  - an SSE `launch_progress` event is present
- Progress is driven by SSE `launch_progress` events from the controller.

Terminal states are: `ready`, `error`, `cancelled`.

## Recipes UX

The Recipes page also subscribes to SSE launch progress and includes a “Models” sidebar tab for browsing local model directories and creating recipes from them.

## Realtime status

`useRealtimeStatus()` subscribes to `/api/proxy/events` and updates:

- `status` (process running + process metadata)
- `gpus`
- `metrics`
- `launchProgress`

This is what keeps the dashboard reactive without polling.

## Chat request path

The chat page uses the Next route `frontend/src/app/api/chat/route.ts`, which forwards to:

- Controller `POST /v1/chat/completions` (for auto-switch support), and the controller forwards to LiteLLM.

Important: controller auto-switching depends on the request `model` matching a recipe `id` or `served_model_name`.
