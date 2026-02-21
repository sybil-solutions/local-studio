# Production Topology

## Current endpoints (example)
- Controller: `https://<controller-host>` -> `<controller-host-or-ip>:8080`
- Frontend: Docker service on controller host (`https://<frontend-host>`) -> `<frontend-host-or-ip>:3000`

## Expected request path
- Browser -> Next (`/api/proxy`) -> Controller

## Local dev with remote controller
- Set the backend URL in `/configs` and click Save.
- Run frontend as Docker service (recommended) with `docker compose up -d --build frontend`.
- Optionally set `NEXT_PUBLIC_API_URL` (client) or `BACKEND_URL` (server) to prefill the backend URL.

## Optional public frontend
- If you expose the UI from the controller host, route a hostname (e.g. `studio.example.com`) to port `3000`.
- Keep `/api/proxy` on the frontend host and set `BACKEND_URL=https://<controller-host>` so all API calls are routed to the controller.
