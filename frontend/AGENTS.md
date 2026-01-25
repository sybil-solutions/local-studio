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
