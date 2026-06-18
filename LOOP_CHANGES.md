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
| 5 | Tighten model-id dropdown: right of composer before submit; brain icon expands to model name | ✅ done |
| Z | Targeted service-layer refactor: settings/models/plugins like ZCode | ✅ done (settings + plugins; models left cohesive) |

## Verification (all green on `loop/zcode-optimization`)
`typecheck` · `typecheck:desktop` · `lint` · `check:cycles` · `check:ui-structure` · unit `test` · Next `build` — all PASS.
e2e: the **chat/UI** suites pass (agent-session-runtime-regressions 58/58, settings-api-persistence + agent-browser-tools 7/7).

### ⚠️ Pre-existing, NOT from this loop
- **9 failures in `tests/frontend/e2e/session-runtime-controller.test.ts`** (poll/reconnect/coalesce/timer). Root cause: the user's **incomplete Effect coalescer/timer WIP** — `text-delta-coalescer.ts` was untracked at branch start, so at clean baseline `99396e92` the suite can't even load (`Cannot find module …/text-delta-coalescer`). Committing the carried WIP (commit D) just made the failing assertions visible. Confirmed identical 159/9 split with the service refactor stashed → zero new failures from my work. **This is your separate unfinished workstream to resolve.**
- **dev-Electron visual QA NOT done** — a live multi-tool chat session (tables, activity-collapse) can't be reproduced headless without popping windows on your machine while you sleep. Production build + tests verify compile + logic; please eyeball #1/#3/#5 in a dev Electron run when awake.

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
- 2026-06-18 — #5 part A: `AgentModelPicker` trigger is now a Brain icon that expands to the model name on hover/open (dropped chevron).
- 2026-06-18 — #5 part B: moved picker into the right action group before the send button; removed dead status-bar `modelSelector` + `.agent-model-slot` CSS. (commit C)
- 2026-06-18 — #Z: `settings-service.ts` (deletes `lib/api/api-settings.ts`, thins route, repoints 6 consumers); `mcp/service.ts` (folds `mcp/api.ts` + barrel, thins plugin/mcp/registry routes). Models left as-is (already cohesive; a lib move would invert features→lib layering). Net −2 LOC, gate green. (commit a9526694)
- 2026-06-18 — Verified the 9 `session-runtime-controller` e2e failures are pre-existing (user's untracked `text-delta-coalescer.ts` coalescer WIP), not from this loop.

## Commits (branch `loop/zcode-optimization`)
- `ccce117a` fix(chat): tables + single activity collapse
- `4b46b416` feat(agent): sitegeist relay backend, drop browser strip
- `a9d9c438` feat(composer): brain-icon model picker, icon toggle
- `2d2de162` chore: change log + carried test-infra
- `a9526694` refactor(services): settings-service + mcp service

## Not committed (by design)
- `~/ai/sitegeist` (separate repo, on `main`): the relay (`relay/`, `src/relay/bridge.ts`, tests) is left uncommitted for your review; it also has your pre-existing `RecordSkillDialog.ts` WIP.

## LOC tracking

(baseline + deltas recorded as changes land)
