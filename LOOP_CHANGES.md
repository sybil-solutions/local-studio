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

### Adversarial diff review (final pass)
Reviewed the full branch diff for correctness + behavior-preservation across all 5 areas — **no bugs at/above confidence threshold**. Adjacency guarantee for table merge holds; activity-group ordering/ids stable; parchi rip-out + protocol conformance complete; picker has no dangling refs/a11y issues; services refactor preserves file formats, masking, and route shapes. One spec/code nit fixed: trimmed `SITEGEIST_RELAY_TASK_ID`/`_TASK_TITLE` from the protocol doc (no task-title field on RuntimeStartOptions; client injects URL/TOKEN/SESSION_ID only) so the spec matches the client exactly.

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

---

## Continuation — chat-session pipeline audit + session/sidebar fixes (2026-06-19)

Re-fired `/loop` to map every chat UX flow, then fix the "session/connectivity
logic is really bad" + "no notifications / switching struggles" reports. Full
audit + per-fix detail in memory `project-chat-session-pipeline-audit`.

### Content pipeline (table mangling / dropped whitespace — root cause: 3 layers each GUESS cumulative-vs-incremental)
- `99c2c068` fix(replay): append incremental deltas verbatim (table-mangling on reload/replay).
- `20116542` refactor(replay): streaming `message_update` rebuilds from full snapshot (reattach === settled).
- `fd118a6c` fix(controller): newline-collapse — `normalizeTextDelta` `>=`→`>` + trim guard. **NEEDS CONTROLLER DEPLOY.**
- `a798ebd0` fix(controller): strip orphan tool-call tags (lone `</arg_value>` leaking into reasoning). **NEEDS CONTROLLER DEPLOY.**

### Session lifecycle + sidebar (this turn — LIVE-VERIFIED on glm-5.2)
- `312a411b` fix(workspace): keep running/starting sessions alive after navigating away (was destroyed → invisible background turn). Additive; +prune/broadcast tests.
- `6e6fac5f` feat(sidebar): accent dot ("blue circle") on the collapsed **Chats** header when a background chat has unseen activity. The notification the user asked for.
- `aca5b07f`/`bce0d11b`/`a2329010` background-notification store (spinner + unseen dot on history rows from controller poll).
- `5acf5871` fix(sidebar): one stable-sorted list — opening a chat no longer reshuffles the sidebar.
- `a75768b1` fix(composer): follow-up prompt in a settled session no longer stalls (gate steer on local status).
- `df6af425` fix: aborted turn settles clean (not an error) + standalone provider tracing (`outputFileTracingIncludes`).
- `86c0c089` fix: reasoning auto-expands while streaming, collapses to "Thought" on settle.

### Live QA (QA Electron rebuild, glm-5.2)
Verified end-to-end: backgrounded running session shows a sidebar spinner; collapsed-Chats "blue circle" appears on navigate-away (absent while focused); reasoning streams visibly then collapses; markdown answer renders clean.
Observed (unreported, not fixed): composer with a non-loaded model → raw "503 status code (no body)" (nicer message would help); LaTeX `$$…$$` renders raw (no KaTeX).

### New features (2026-06-19, microcommits — LIVE-VERIFIED on glm-5.2)
- `dd0b19a1` fix(controller): OpenAI-shaped 503 when the requested model isn't running (was bare "503 status code (no body)"; SDK reads `error.message`, not FastAPI `detail`). +`modelNotRunningError()` +2 tests. **Needs controller deploy.**
- `3e54ee1f` feat(model-picker): green "running" badge on the loaded model + amber warning on the trigger when the SELECTED model isn't running (uses `model.active` from `/v1/models`, which the picker never surfaced). Verified: glm-5.2 badged "running"; selecting nemotron shows "(not running)" + warn dot.
- `7e367c04` feat(chat): Retry button on the turn-error banner — resends the last user message, clears the error, starts a fresh turn (gated on model set + not running + something to resend). Verified: nemotron 503 → switch to glm-5.2 → Retry → resends and succeeds, error clears.
- `5c1b7436` feat(chat): scroll-to-bottom pill when scrolled up — the timeline tracked stickToBottom but had no way back. Floating center pill ("New messages" while streaming, "Latest" otherwise); click smooth-scrolls + re-pins. Verified: scroll up → "Latest" appears → click → returns to bottom + hides.
- `bc738122` feat(chat): copy button on user messages — assistant had Copy/Fork but user bubbles had none. Hover-revealed copy to the left of the bubble (reuses AssistantActionButton). Verified: click → "Copied" + clipboard holds the exact prompt text.
- `1e5c2aff` feat(chat): export conversation as Markdown — "Export as Markdown" in the session header menu; pure `sessionToMarkdown()` serializer (title + You/Assistant turns, assistant answers from text blocks, reasoning/tool/system noise dropped) + slugified filename, downloaded via Blob. +4 unit tests. Verified: downloaded file has title + You/Assistant + table data, reasoning excluded, filename `make-a-markdown-table-of-5-programming-languages.md`.
- **Also verified (no fix needed):** the user's #1 reported bug — markdown tables — renders correctly on REPLAY (reopen a settled session → table intact, not mangled); load-old-session loads full canonical history.

### Perf/size pass + real bug found (2026-06-19)
- **Profile** ([docs/frontend-perf-size.md](docs/frontend-perf-size.md)): bundle already well-optimized (xterm lazy, highlight.js core+12-langs); Effect-TS (~244K) is the only big eager lever — removable only by de-Effect-ifying the runtime (poor risk/reward for a local desktop app; not done). Route switches 6–17ms; zero app-origin console errors.
- `d099750e` + `13e5f4b5` fix(workspace): **"No models" stuck-empty picker** — REAL bug found live (API returned 57 models while the picker showed "No models"; required a manual reload). Models loaded once on hydrate with no retry, so a startup proxy/controller race (`[PROXY ERROR] /status fetch failed`) stranded the picker empty → can't pick a model → can't chat. Fix: bounded startup retry (0.9s/2.5s/6s, gated on empty + not-loading) + focus/online recovery. **Verified live: fresh open "No models"→auto-heals to glm-5.2 by ~8s with no user action.**

### Session-switch + reload fixes (2026-06-19, frontend — LIVE-VERIFIED)
- `a44f5556` fix(chat): pin URL `?new=`→`?session=<piSessionId>` on turn start (replaceState, invisible to Next nav). Reload mid-stream now reopens the conversation AND the live stream reattaches/keeps flowing (verified). Resolves the deferred Phase 3b reload bug.
- `b59040c3` fix(sidebar): **clicking a session now actually opens it.** Next 16 App Router silently no-ops `router.push` to the same `/agent` route when only `session=`/`open=` params change — confirmed via instrumentation (onClick fired, push called with correct URL, address bar never moved). `navigateToSessionHref` tries the soft push then falls back to a real navigation if the URL didn't move. Fixes "switch to a session shows blank / running session resets." Verified live: click → loads the session (content + blocks). NOTE: this router.push-no-op may affect other same-route session navs (Search dialog etc.) — workaround is per-call; a cleaner root-cause fix (Next config / nav architecture) is possible.
- `d099750e`+`13e5f4b5` fix(workspace): "No models" stuck-empty picker self-heals (startup retry + focus/online recovery).

### ✅ Controller DEPLOYED 2026-06-19 (pop-os Tailscale re-auth'd)
`./scripts/deploy-remote.sh controller` shipped all 4 fixes: `fd118a6c` newlines, `a798ebd0` tag-leak, `dd0b19a1` 503-shape, `8d3d7951` launch-stderr. **glm-5.2 survived the restart** (controller restart only kills the :8080 bun process, not the :8000 vLLM). Verified live: non-loaded model → OpenAI-shaped 503 with a real message; glm-5.2 → 200.

### Still owed
- (controller fixes deployed — see above)
- Deferred high-risk: side-chat-via-navbar streaming (local-useState session never enters workspace store → controller never subscribes — needs a product decision); reload-mid-stream resume (Next standalone buffers local SSE).
