# Modifications inventory

This page summarizes every **modified** file under `frontend/` (in addition
to the new and deleted files documented in
[index.md](./index.md), [api-routes.md](./api-routes.md),
[stores-and-state.md](./stores-and-state.md),
[electron-desktop.md](./electron-desktop.md), and
[deletions-inventory.md](./deletions-inventory.md)).

## Routing / layout

| File | Change |
| ---- | ------ |
| `frontend/src/app/layout.tsx` | +17 / −0 lines. Adds the inline boot script that registers/un-registers the service worker (under `VLLM_STUDIO_ENABLE_SERVICE_WORKER`) and computes `--app-height` on viewport resize. Keeps `<LeftSidebar>` as the global chrome. |
| `frontend/src/app/providers.tsx` | +14 / −0. Wraps `<ContextManagementProvider>` and a `<ControllerEventsListener />` (calls `useControllerEvents()` once at the root). |
| `frontend/src/app/page.tsx` | Trivial — keeps the dashboard as the root entry. |

## Settings page (new)

| File | Change |
| ---- | ------ |
| `frontend/src/app/settings/page.tsx` | New file. Single-line `redirect("/configs")` — keeps `/settings` as a stable URL while config UI lives at `/configs`. |

## Configs page

| File | Change |
| ---- | ------ |
| `frontend/src/app/configs/_components/config-cards.tsx` | Trivial: 1-line classname tweak. |
| `frontend/src/app/configs/_components/configs-view.tsx` | 1-line tweak. |
| `frontend/src/app/configs/_components/engines-section.tsx` | +34 / changed. Engine status row uses the new `RuntimeSummary` shape from `lib/types/system/config.ts`. |
| `frontend/src/app/configs/hooks/use-configs.ts` | 4-line patch updating to the new `RuntimeBackendInfo` field set. |

## Discover

| File | Change |
| ---- | ------ |
| `frontend/src/app/discover/_components/discover/discover-header.tsx` | 1-line tweak (header copy / grid). |

## Recipes

| File | Change |
| ---- | ------ |
| `frontend/src/app/recipes/_components/vllm-runtime-panel-machine.ts` | Trivial 1-line patch — likely importing the new `lib/state-machine.ts` helper. |

## Usage page

| File | Change |
| ---- | ------ |
| `frontend/src/app/usage/page.tsx` | Switches to `normalizeUsageStats` (new helper) before passing data to child components — defends against partial backend responses. |
| `frontend/src/app/usage/_components/overview-metrics.tsx` | +113 substantially rewritten — uses normalized stats, drops several deprecated metric blocks. |
| `frontend/src/app/usage/hooks/use-usage.ts` | +22 / −22. Refactored to lean on `normalizeUsageStats`. |
| `frontend/src/app/usage/lib/normalize-usage-stats.ts` | **New** (165 lines). Exhaustive coercion of every `UsageStats` field — `record()`, `array()`, `num()`, `nullableNum()`, `text()` helpers — so a partial backend response can't crash the page. |
| `frontend/src/app/usage/lib/normalize-usage-stats.test.ts` | **New**. Vitest unit test for the normalizer. |

## Dashboard

| File | Change |
| ---- | ------ |
| `frontend/src/components/dashboard/page/dashboard-page.tsx` | Slimmed to a 6-line `<DashboardLayout {...useDashboardData()} />`. |
| `frontend/src/components/dashboard/control-panel/control-panel-v2.tsx` | +10 / refactor pass to use the new lifecycle hook + ui-kit buttons. |
| `frontend/src/components/dashboard/control-panel/gpu-section.tsx` | +180 / mostly type/whitespace churn from the new `RuntimeGpuMonitoringInfo` type. |
| `frontend/src/components/dashboard/control-panel/log-section.tsx` | +8 / minor tweak. |
| `frontend/src/components/dashboard/control-panel/status-section.tsx` | +199 / large refactor — uses the new lifecycle hook, removes inline duplicates, integrates `<ModelStopConfirm>`. |
| `frontend/src/components/dashboard/layout/dashboard-types.ts` | +9 / extends the dashboard's prop shape. |
| `frontend/src/components/dashboard/use-dashboard-actions.ts` | +29 / −29. Routes lifecycle calls (start / stop) through `useModelLifecycle()` rather than inline `api.launch/evict` — see commit `2a2b085b`. |
| `frontend/src/components/dashboard/use-dashboard-data.ts` | +25 / −25. Stops importing the deleted `use-stop-model.ts`; relies on lifecycle hook directly. |

## UI kit & sidebar

| File | Change |
| ---- | ------ |
| `frontend/src/components/left-sidebar.tsx` | Substantially rewritten. New structure: pinned-by-default desktop rail (56 px collapsed → 208 px expanded) with a `Projects` collapsible section embedded in the nav. Adds `<ModelStopConfirm>` + `<StopButtonDesktop>` triggered only when inference is online. Mobile layout switches to a 56 px bottom tab bar. |
| `frontend/src/components/projects-nav-section.tsx` | **New** (516 lines). The collapsible PROJECTS section, dual-mode (Electron IPC vs HTTP). Emits `vllm-studio.agent.addProject`, `vllm-studio.agent.projectsChanged`, `vllm-studio.agent.sessionsChanged`, listens for `vllm-studio.agent.activeSessions`. |
| `frontend/src/components/model-stop-confirm.tsx` | **New** (87 lines). Small confirm modal — primary use case is the sidebar Stop button. |
| `frontend/src/components/ui-kit/buttons.tsx` | **New** (104 lines). `<IconButton>` and `<Button>` primitives. Three icon-button sizes, four button variants. |
| `frontend/src/components/ui-kit/index.ts` | +1 line. Re-exports `IconButton` and `Button`. |

## Hooks

| File | Change |
| ---- | ------ |
| `frontend/src/hooks/use-controller-events.ts` | −199 net (huge simplification). Most contract handling moved into `lib/controller-events-contract.ts`; this file now just wires the SSE subscription. |
| `frontend/src/hooks/use-controller-events/helpers.ts` | −16 lines — helpers consolidated. |
| `frontend/src/hooks/use-controller-events/routing.test.ts` | −3 lines — test updated for the simpler shape. |
| `frontend/src/hooks/use-machine.ts` | 1-line patch — uses `lib/state-machine.ts`. |
| `frontend/src/hooks/use-model-lifecycle.ts` | **New** (94 lines). Replaces the old `use-stop-model.ts` with a fuller `{ activeRecipeId, status, error, start, stop }` API. Maps controller-side `launchProgress.stage` to a 4-state machine (`idle`/`starting`/`ready`/`error`). |
| `frontend/src/hooks/use-model-lifecycle.test.ts` | **New** (234 lines). Vitest with React Test renderer. |
| `frontend/src/hooks/use-stop-model.ts` | **Deleted**. |

## Lib (`frontend/src/lib/`)

| File | Change |
| ---- | ------ |
| `frontend/src/lib/api/core.ts` | +98 / −0. Type-safer client core. |
| `frontend/src/lib/api/core.test.ts` | +87 / −0. New tests. |
| `frontend/src/lib/api/create-api-client.ts` | +3 / minor. |
| `frontend/src/lib/api/chats.ts` | **Deleted** (148 lines). |
| `frontend/src/lib/async.ts` | +14 lines. New helpers (likely `asyncResult` / debounce). |
| `frontend/src/lib/controller-events-contract.ts` | +146 / large rewrite. Now centralizes the contract types and routing for SSE controller events. |
| `frontend/src/lib/formatters.ts` | +18. Adds extra formatters used by the new dashboard / usage code. |
| `frontend/src/lib/types.ts` | −4 lines. Drops chat-specific reexports. |
| `frontend/src/lib/types/recipes/downloads.ts` | +37 / extends recipe download types. |
| `frontend/src/lib/types/recipes/recipes.ts` | +40 / extends recipe types. |
| `frontend/src/lib/types/system/config.ts` | +147 / −0 net. **Stops importing from `../../../../../shared/src`** and **inlines** every `ServiceInfo` / `SystemConfig` / `RuntimeXxx` / `CompatibilityXxx` interface directly. This decouples the frontend from the workspace `shared/` package. |
| `frontend/src/lib/state-machine.ts` | **New** (45 lines). Generic state-machine container — see [stores-and-state.md](./stores-and-state.md). |

## Store

| File | Change |
| ---- | ------ |
| `frontend/src/store/app-slice.ts` | **New** (37 lines). Sidebar collapsed/mobile/width slice. |
| `frontend/src/store/app-store.ts` | +56 / −0. New `desktopSidebarPinnedOpen` field; persistence partializer narrows the saved shape. |
| `frontend/src/store/index.ts` | −1 line. Re-export of `useAppStore` plus a side-effect import of `./listeners`. |
| `frontend/src/store/listeners.ts` | +13 / −13. Module-level window listeners (resize → mobile sidebar collapse; `vllm:toggle-sidebar` event). |

## Proxy

| File | Change |
| ---- | ------ |
| `frontend/src/proxy.ts` | +23 / −23. Sanitizes sensitive query params (`api_key`, `key`, `token`, `access_token`) before logging; sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`. |
| `frontend/src/app/api/proxy/[...path]/route.ts` | +62 / large. New private-IP allowlist for the override header (`VLLM_STUDIO_PROXY_OVERRIDE_ALLOWLIST`); 403s untrusted private overrides; clears the `vllmstudio_backend_url` cookie when the override is invalid. Adds an explicit Electron exception (`VLLM_STUDIO_DATA_DIR` set → trust private IPs). New 404-text fallback to the default backend when the override returns plain text. |
| `frontend/src/app/api/proxy/[...path]/route.test.ts` | +2 lines / minor signature update. |

## Globals / styles

| File | Change |
| ---- | ------ |
| `frontend/src/app/globals.css` | +2 / −2. Tiny tweak to base layer ordering. |
| `frontend/src/app/styles/globals/animations.css` | −78 lines. Drops the chat-only splash animations. |
| `frontend/src/app/styles/globals/base.css` | −6 lines. Removes refs to deleted `themes.css`. |
| `frontend/src/app/styles/globals/themes.css` | **Deleted** (9 lines header). Theme CSS variables are now inlined into `globals.css` / `base.css`. |

## Build

| File | Change |
| ---- | ------ |
| `frontend/package.json` | +5 lines — pi extension dep, electron-builder bump, vitest, etc. (`@mariozechner/pi-coding-agent ^0.70.6`, `electron ^36.3.2`, `electron-builder ^26.0.12`, `vitest ^3.2.4`). |
| `frontend/tsconfig.json` | 2-line change. |
| `frontend/scripts/start-standalone.mjs` | +5 / −2. Sets `VLLM_STUDIO_AGENT_CWD` to the repo root if not already set. Detects nested `frontend/` standalone layouts. |

## Net effect

The PR shrinks the modified-file surface area by:

1. **Inlining shared types** — `types/system/config.ts` no longer reaches
   into the `shared/` workspace package.
2. **Replacing two stop hooks with one lifecycle hook** —
   `use-model-lifecycle.ts` now owns start + stop + status.
3. **Centralizing controller-events contracts** —
   `lib/controller-events-contract.ts` grew by 146 lines, while
   `use-controller-events.ts` shrank by 199 lines.
4. **Adding a small UI-kit primitives layer** —
   `<IconButton>`, `<Button>`, `<ModelStopConfirm>`.
5. **Hardening the proxy** — origin allowlists, sanitized logs, security
   headers, override fallback.
