# Loop: ZCode-informed optimization

Branch: `loop/zcode-optimization` (from `main`)
Started: 2026-06-18
Goal: Learn from `~/ZCodeProject`, optimize vllm-studio frontend. Effect, composable units, all UI in ui-kit, reduce LOC. Test on dev Electron.

## Task list

| # | Task | Status |
|---|------|--------|
| 1 | Fix broken markdown table rendering/parsing in chat content (UI over-parse) | ✅ done (typecheck+eslint green) |
| 2 | Remove "Model context / browser tools active / live / DOM+screenshot" bar under browser search bar | ✅ done (−92 LOC) |
| 3 | Group think/tool blocks between content into ONE collapsible preview | ✅ done (pending unified typecheck) |
| 4 | Remove parchi; integrate `~/ai/sitegeist` (new relay ≤1k LOC; hide "PANEL"; parchi→sitegeist icon) | 🔄 relay done; rip-out in progress |
| 5 | Tighten model-id dropdown: right of composer before submit; brain icon expands to model name | 🔄 part A done (brain-expand trigger); part B (reposition) pending Agent P |
| Z | Targeted service-layer refactor: settings/models/plugins like ZCode | ⏳ pending |

## Decisions (locked 2026-06-18)
- #4: parchi is **discontinued** → rip ALL parchi code out of vllm-studio; build a **new improved relay (≤1000 LOC) in ~/ai/sitegeist**. No parchi parity. Protocol: [docs/sitegeist-relay-protocol.md](docs/sitegeist-relay-protocol.md) (HTTP JSON-RPC agent↔relay, WS relay↔extension).
- #Z: **targeted service-layer refactor** (setting / model-provider / plugins service modules + shared schemas in current layout), NOT a monorepo migration.

## Change log

- 2026-06-18 — Created branch, launched discovery workflow (`wf_bec399c0-cad`, 12 explore agents).
- 2026-06-18 — #1 tables: `blocksFromTurnSnapshots` (message-content.ts) now merges adjacent text-like blocks across the whole turn, not per-call → multi-call markdown tables coalesce before GFM parse. Net −1 LOC.
- 2026-06-18 — #2 browser bar: removed `BrowserContextStrip` + `ContextPill`/`ContextRow`/`browserHost` + `contextOpen` state in agent-browser.tsx. Net −92 LOC.
- 2026-06-18 — Wrote relay protocol spec; launched relay build (sitegeist) + parchi rip-out (vllm-studio) in parallel.
- 2026-06-18 — #4 relay DONE in ~/ai/sitegeist: `relay/{protocol,config,server}.mjs` + `src/relay/bridge.ts` + tests (12/12 pass), 703 LOC (<1k cap). `npm run relay` / `npm run test:relay`. Protocol matches spec; HTTP /rpc agent↔relay, WS /ws relay↔extension. Limitations: active-tab only, viewport-only screenshot, `waitUntil` no-op.
- 2026-06-18 — #3 activity grouping: `groupAssistantBlocks` now folds ALL interim reasoning+tools between content into ONE `activity-group` (reuses existing `AssistantActivityGroup` collapsible — ZCode "worked for X" pattern). Removed `reasoning` RoutedBlock kind + `ReasoningGroup` component. Updated regression test. Net code removal.
- 2026-06-18 — #5 part A: `AgentModelPicker` trigger is now a Brain icon that expands to the model name on hover/open (dropped chevron). Reposition before submit + remove status-bar duplicate = part B (pending Agent P releasing agent-composer-actions.tsx).

## LOC tracking

(baseline + deltas recorded as changes land)
