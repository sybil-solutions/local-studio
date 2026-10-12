# Frontend

`frontend/` is the Next.js 16 and React 19 interface for Local Studio and the
source of the macOS Electron app. The web and desktop builds share the same
routes, agent runtime integration, controller API bridge, and UI kit.

## Product Surface

- `/` — controller and hardware status.
- `/agent` — Workbench sessions, panes, Pi agent runtime, terminals, browser,
  files, skills, and extensions.
- `/configure` — overview, machines, models, integrations, and server controls.
- `/usage` — inference and session usage.
- `/settings` — application, connection, appearance, agent, and setup settings.
- `/logs` — controller log sessions.

`/recipes`, `/discover`, `/integrations`, and `/server` are compatibility
redirects into Configure. New navigation must target the canonical route.

## Architecture

```mermaid
flowchart TB
    Desktop["Electron main process"] --> Routes["Next.js app routes"]
    Browser["Web browser"] --> Routes
    Routes --> AgentApi["agent runtime proxy"]
    Routes --> ControllerApi["controller proxy routes"]
    AgentApi --> Pi["standalone Pi agent runtime"]
    ControllerApi --> Controller["Local Studio controller"]
    Configure["/configure"] --> ControllerApi
    Workbench["/agent"] --> AgentApi
```

The Pi execution and browser-host routes always run in the standalone
`services/agent-runtime/` sidecar. Next proxies those routes while importing
shared contracts and non-runtime services from the package. Shared controller
HTTP shapes come from `@local-studio/contracts`; frontend and agent-runtime
shapes come from `shared/agent/`.

## Requirements and Commands

Node.js 22.19+, npm, and a reachable controller are required for the full
surface. The default controller URL is `http://localhost:8080`.

```bash
npm ci
npm run build
npm run start
npm run typecheck
npm run typecheck:desktop
npm run lint
npm run check:quality
```

`npm run start` uses the repository project command; plain `next start` does not
preserve the streaming runtime contract.

## Desktop

```bash
npm run desktop:build:main
electron desktop/dist/main.js  # after npm run desktop:build:main
npm run desktop:pack
npm run desktop:dist
```

`desktop:pack` creates a fast local bundle. `desktop:dist` creates the signed
DMG, updater ZIP, blockmaps, and update metadata. The only canonical install is
`/Applications/Local Studio.app` with bundle id `org.local.studio.desktop`.
Run `APPLE_KEYCHAIN_PROFILE=vllm-studio-notarize npm run
release signing and notarization run in CI (`sign-release` in release.yml); local
builds stay unsigned.

## Controller Connection

Controller URL resolution lives in `src/lib/backend-config.ts` and accepts
`BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, or `LOCAL_STUDIO_BACKEND_URL`. Durable
desktop preferences preserve controller URLs locally without copying controller
credentials into the controller database.

## Code Map

- `src/app/` — thin route and API shells.
- `src/features/agent/` — Workbench sessions, messages, workspace, and UI.
- `src/features/configure/` — consolidated controller configuration.
- `src/features/settings/` — application settings and runtime target controls.
- `src/features/integrations/` — plugins, connectors, skills, accounts, and model providers.
- `src/lib/` and `src/hooks/` — shared modules with multiple feature consumers.
- `src/ui/` — shared primitives and ZCode design tokens.
- `desktop/` — Electron main process, resources, signing, and packaging.
