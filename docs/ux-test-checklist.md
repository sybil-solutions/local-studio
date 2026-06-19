# vLLM Studio — Full UX Test Checklist

_Living checklist for the chat-session QA loop. Tested against the rebuilt Electron app (QA profile, CDP 9333) on the live `glm-5.2` backend. Status: ⬜ untested · ✅ pass · ❌ fail (issue) · 🔧 fixed · ⏭️ blocked._

Legend for "layer": which subsystem the flow exercises (Parse = content pipeline, Trans = transport/SSE, Sess = session lifecycle, UI = rendering).

---

## A. Session lifecycle

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| A1 | New chat | Click "New chat" | Empty composer, fresh session id, title "New session" | Sess | ⬜ |
| A2 | First message creates session | Type + send | User bubble + assistant bubble appear; title derives from prompt | Sess | ⬜ |
| A3 | Switch chat A→B | Click another session in sidebar | B's transcript loads, A's preserved, no bleed | Sess | ⬜ |
| A4 | Switch back B→A | Click A again | A's full transcript intact (incl. tables/reasoning) | Sess/Parse | ⬜ |
| A5 | Switch to a still-streaming chat | Start turn in A, switch to B, switch back to A | A still streaming or settled correctly, no dup/loss | Trans/Parse | ⬜ |
| A6 | Rename session | Session options → rename | Title updates in sidebar + tab | Sess | ⬜ |
| A7 | Pin / unpin session | Toggle pin | Stays pinned across reloads | Sess | ⬜ |
| A8 | Delete session | Delete | Removed from sidebar; active switches to another | Sess | ⬜ |
| A9 | Reopen after delete-all | Delete all, new chat | Clean empty starter state | Sess | ⬜ |

## B. Messaging & streaming

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| B1 | Send single message | Type + Send | Streams token-by-token, settles to idle | Trans/Parse | ⬜ |
| B2 | **Reasoning visible while streaming** | Send a reasoning prompt | "Thinking" expands and shows reasoning text LIVE, collapses to "Thought · Worked for Xs" when done | UI/Parse | 🔧 (fix applied, retest) |
| B3 | Markdown table renders | Ask for a table | GFM table with rows/cols, not collapsed | Parse/UI | ✅ (confirmed live) |
| B4 | Code block renders | Ask for code | Fenced block, syntax highlight, copy button | UI | ⬜ |
| B5 | Send 2 messages in a row | Send, wait, send again | Two turns, correct order, second targets a new bubble | Sess/Parse | ⬜ |
| B6 | Steer mid-stream (follow-up) | Send, then send again WHILE streaming | Second message queues/steers; tokens land in the right bubble | Sess/Parse | ⬜ |
| B7 | Stop generation | Click Stop mid-stream | Stream halts, status idle, partial content kept | Trans/Sess | ⬜ |
| B8 | Long multi-paragraph answer | Ask for long prose | Paragraph/blank-line boundaries preserved | Parse | ⬜ |
| B9 | Tool-using turn | Prompt that triggers a tool | Activity group shows tool call + result; collapses after | Parse/UI | ⬜ |
| B10 | Reasoning + tool interleave | Reasoning then tool then text | Reasoning under activity, answer as content, order correct | Parse | ⬜ |
| B11 | Empty / whitespace answer | Edge prompt | No phantom blank bubble | Parse | ⬜ |

## C. Transport / reload / reconnect

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| C1 | Reload after a settled turn | Finish a turn, reload | Full transcript rehydrates (tables/reasoning intact) | Trans/Parse | ⬜ |
| C2 | **Reload mid-stream (reattach)** | Reload WHILE streaming | Turn reattaches and continues/settles; no empty session | Trans/Parse | ❌ (empty session — standalone SSE buffering, Phase 3b) |
| C3 | Backend blip | Kill/restart controller mid-turn | Session reconnects or idles with visible error, no infinite spin | Trans | ⬜ |
| C4 | `/events` system stream | Watch Status page over time | GPU/log stream keeps flowing, no `Controller already closed` | Trans | ❌ (proxy double-close error) |
| C5 | Navigate away & back during stream | Status → back to chat mid-stream | Stream still live or settled, cursor correct | Trans/Sess | ⬜ |

## D. Navigation & panes

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| D1 | Sidebar collapse/expand | Toggle | Smooth, state persists | UI | ⬜ |
| D2 | Status / Usage / Models / Plugins / Server | Click each nav | Each page loads, no error | UI | ⬜ |
| D3 | Back / forward | Navigate, use arrows | History works | UI | ⬜ |
| D4 | Split pane / second tab | Open split | Two sessions side by side, independent streams | Sess/Trans | ⬜ |
| D5 | Search ⌘K | Open search | Finds sessions | UI | ⬜ |

## E. Model picker & composer

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| E1 | Model picker (brain icon) | Open picker before send | Lists models, selectable | UI | ⬜ |
| E2 | Switch model mid-session | Change model | New turns use new model | Sess | ⬜ |
| E3 | Attach file | Attach button | File chip; included in prompt | UI | ⬜ |
| E4 | Browser tools toggle | Toggle | Browser pane available | UI | ⬜ |
| E5 | Canvas context | Toggle | Canvas pane available | UI | ⬜ |
| E6 | @-mention files/plugins | Type @ | Mention menu appears | UI | ⬜ |

## F. Side panels & tools

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| F1 | In-app browser | Open a URL/file ref | Renders in side browser | UI | ⬜ |
| F2 | Filesystem panel | Open files | Tree + file viewer | UI | ⬜ |
| F3 | Git diff panel | git button | Diff view | UI | ⬜ |
| F4 | Terminal | Open terminal | PTY attaches | UI | ⬜ |
| F5 | Canvas | Canvas tab | Notes render | UI | ⬜ |

## G. Projects & settings

| # | Flow | Steps | Expected | Layer | Status |
|---|------|-------|----------|-------|--------|
| G1 | Add folder/project | Add folder | Project appears | Sess | ⬜ |
| G2 | Settings page | Open Settings | Loads, edits persist | UI | ⬜ |

---

## Issues found (running log)

1. **B2 reasoning hidden while streaming** — outer `ActivityDisclosure` (`session-pane-block-router.tsx`) defaulted collapsed (`expanded=false`), hiding the inner reasoning that already auto-opens while active. **Fix applied:** `expanded = userExpanded ?? live` so it auto-expands while streaming and collapses when settled. _Retest after rebuild._
2. **C2 reload mid-stream → empty session** — standalone embedded server buffers the locally-built `/api/agent/runtime/events` SSE; reattach gets nothing. **Phase 3b** (snapshot+cursor JSON-GET resume).
3. **C4 `/events` proxy `Controller is already closed`** — `/api/proxy/[...path]` stream controller closed twice. **🔧 Fixed** (idempotent `safeClose` + `finished` flag; client disconnect is now a no-op, not a logged error). Uncommitted in working tree (file also carries the pre-existing `settings-service` import refactor — commit together).

---

## Iteration log

### Iteration 1 (live, rebuilt Electron, glm-5.2)
**Verified pass:** A1 New chat (fresh empty session) · B2 **Reasoning visible while streaming** 🔧✅ (committed `86c0c089`; "Thinking" block auto-expands and streams full internal reasoning live, collapses to "Worked for Xs" on settle) · B3 Table renders live ✅ · sessions list in sidebar (under collapsed "Chats" section) · 7-day history persists.
**Fixed this iteration:** B2 reasoning-while-streaming (committed) · C4 proxy double-close (working tree).
**Notes / minor:** the sidebar "Chats" section defaults **collapsed** — recent chats are hidden until you expand it (possible UX nit: surface recent chats by default). Test-harness: re-snapshot before each click (refs go stale after navigation).
**Environment caveat:** the isolated QA profile (`~/Library/Application Support/vLLM Studio QA`) was seeded with backend config but **not `chats.db`**, so reload/persistence flows (C1, C2) can't be tested faithfully yet — next iteration seeds `chats.db` (additive copy) for a true environment.

**Next iteration queue:** faithful env (seed chats.db) → A3/A4 switch chats + load-old-session table render (replay path) → B5 send-2-in-a-row → B6 steer mid-stream → B7 stop → C1 reload-settled → C2/Phase 3b reload-mid-stream reattach (standalone SSE transport) → D/E/F navigation, model picker, panels.

### Iteration 2 (sidebar bugs — user-reported)
User report: switching sessions struggles · no blue-circle notifications · leave/rejoin unreliable · follow-up prompts bug out.
**Fixed + verified:**
- **B5 follow-up after settle 🔧✅** (committed `a75768b1`): a 2nd message used to stall (added but no turn started). Root cause — `runtimeAcceptsControl` (chat-pane) routed it as a *steer* because the runtime still reports `active=true` after a turn settles (SDK session stays loaded), steering an idle agent → dropped. Fix: gate steer on the LOCAL turn being in-flight (`tab.status` running/starting). Verified live: msg1→settle→msg2 now answers.
**Foundation committed (needs more):**
- **Blue-circle unseen dot** (committed `aca5b07f`): `unseen` flag on active-session snapshot + sidebar dot. Correct, but doesn't fire in the common single-pane flow (see root cause below).
**Root cause of the remaining sidebar bugs (verified live):** navigating to another chat **replaces the single pane and drops the previous running session from the active set** — it shows **no spinner, no dot, and isn't listed** while it keeps running server-side. This is the through-line for "no notifications," "switching struggles," and "leave/rejoin unreliable." A background turn becomes invisible and must reattach on return (which is also broken in standalone — Phase 3b).
**Next (core fix):** surface running / just-finished sessions on sidebar rows from the runtime-list poll (`listRuntimeSessions`) — a session running server-side gets a spinner, a just-finished one gets the unseen dot — independent of whether it's open in a pane. Then verify switch-away → indicator → switch-back → content (with faithful env + Phase 3b reattach).

### Iteration 3 (user-reported: reorder + navbar)
User report: "opened chat, switched session, got lost — the sessions reordered and I lost the original. Do not reorder based on what's open. Opening a sidechat via navbar is awful, it breaks."
**Fixed + verified:**
- **Sidebar reorder-on-open 🔧✅** (committed `5acf5871`): opening a session promoted it to the top because open sessions rendered in a separate block ABOVE history. Now ONE list ordered by stable start time; an open session keeps its position (anchored to its original history start time so opening never changes its sort key). Verified live: a session at position 7 stayed at the bottom (pos 8) when opened instead of jumping to #1; no duplicate rows (two same-looking codex rows confirmed to be distinct session ids).
**Still to do (needs reproduction):**
- **"Opening a sidechat via navbar breaks"** — maps to the split-pane / `OpenSession`/`splitTab` path (`pane-controller.ts:226-421`). Vague; reproduce live (open a session into a split/side pane via the top navbar) and characterize the break before fixing.

### Iteration 4 (user-reported: abort error + module-not-found)
User report: "request aborted shouldn't be an error — it's throwing an error which is wrong" + agent error `Cannot find module …/pi-ai/dist/providers/openai-completions.js`.
**Fixed + verified live (committed `df6af425`):**
- **B7 abort ≠ error 🔧✅** — a turn ending `stopReason:"aborted"` (Stop pressed / navigated away) was treated as a failure: tools→error, "Assistant turn aborted." event block, `session.error` set. Now settles cleanly (tools→done, no error block, no session error, partial content kept). Only `stopReason:"error"` is a failure. Regression test added (63 green). **Verified live:** pressed Stop mid-turn → clean settle, no error block, composer ready (screenshot).
- **Standalone module-not-found 🔧✅** — `pi-ai/register-builtins.js` pulls providers in dynamically; Next's tracer omitted `openai-completions.js` intermittently → agent threw at runtime. Added `outputFileTracingIncludes` for the whole `pi-ai/dist` (top-level + nested under pi-coding-agent). **Verified:** `openai-completions.js` + full 18-provider set present in `.next/standalone` after build.
**Note:** the user's in-app prompt ("go to ~/.codex/config.toml and remove the pi ai gateway; identify codex-app computer-use/plugin issues") is a task for the *agent* to run once it works — not a code change here. Once these land, that prompt should execute instead of erroring.

### Iteration 5 (navbar "sidechat breaks" — root-caused)
**Confirmed root cause (code-traced):** the **Side chat** (right-panel secondary `ChatPane`, `paneId="computer-side-chat"`, launched from the computer-panel "Side chat" card → `onOpenSideChat`) holds its session in **local `useState`** in `agent-browser-panel.tsx` (`sideChatSession`), never dispatched to the workspace store. The runtime controller is a singleton bound in `use-workspace.ts` with `getSessions: () => sessionsRef.current` and driven by `reconcile(sessionsRef.current)` — **workspace sessions only**. So the side-chat's `runtimeSessionId` is never reconciled → no SSE attachment → its turns POST `/turn` but never stream back → it "breaks" (message sent, no response). Not a render crash (`createSideChatSession` builds a valid session via `makeFreshTab`).
**Fix (NOT yet done — architectural, ~medium):** make the controller reconcile the active side-chat session alongside workspace sessions (e.g. lift it into a shared ref/the workspace set, or have the side-chat engine register its session for subscription). Needs the faithful env + the exact user repro to verify the streaming end-to-end. **Deferred pending user steer** — it's a real but non-trivial change and risky to land blind.

### Iteration 6 (Background notifications — user chose this)
**Done (committed `bce0d11b` + `a2329010`; live verify pending build):** the runtime controller now exposes the poll's **active-session-id set** (`subscribeActiveRuntimeIds`/`getActiveRuntimeIds`) plus an **unseen-finished set** (`getUnseenFinishedIds`/`markRuntimeSeen`) via a tiny `useSyncExternalStore`-stable store — no redundant poll, no change to the core streaming/commit path. The sidebar's **history rows** now show: a **working spinner** while a session runs in the background (independent of pane membership), and an **accent "unseen" dot** when a background turn just finished (cleared when the session re-runs or you open it). Directly addresses "you don't get notifications (blue circle)" + "switching away makes it invisible." 94 tests green.
**Live verify (partial):** the working spinner DID render on a sidebar row for a background turn; clean active-vs-background confirmation was blocked by agent-browser ref instability (kept landing on the wrong session). Code is traced-correct + unit-tested. **Manual check recommended:** start a turn in one chat, switch to a clearly different chat, look for the spinner on the first chat's sidebar row.
**Gap found (real):** a brand-NEW backgrounded session **vanishes from the sidebar** — it's not in the server history list yet and it left the workspace active set, so there's no row to indicate on. The spinner/dot only attach to sessions that already have a row (e.g. re-running an old chat). The common "new chat → run → switch away" case still goes invisible. **Full fix = the session-lifecycle change** (keep a backgrounded-but-running session visible, e.g. a "recently backgrounded" set or refetch history on runtime change) — bigger, deferred.

### Iteration 7 (newlines collapsing — user-reported)
User: "we are missing new lines i saw it make a list but all without newlines."
**Fixed (committed `fd118a6c`; needs controller deploy to go live):** the **controller**'s `normalizeTextDelta` cumulative-snapshot check used `text.length >= previous.text.length && startsWith` — a delta that EQUALS the accumulated text (a second `"\n"` after a first `"\n"`, i.e. a model opening with a blank line before a list) was misread as a cumulative snapshot, dropped, AND flipped the stream into snapshot mode, mangling the rest → list on one line. Fix: strict `>` for cumulative + `text.trim() !== ""` guard on the replay-suppress. Model-dependent (glm-5.2 didn't show it; others do). +2 regression tests; 51/51 controller tests green. **The frontend was already lossless here** (appendDelta verbatim + snapshot path); this was the last of the 3 "guessing" layers from the audit. **DEPLOY: `scripts/deploy-remote.sh controller` (restarts the model).**

### Iteration 8 (stray `</arg_value>` in reasoning — user screenshot)
User screenshot: a "Thought" reasoning bubble showing a lone `</arg_value>` — a tool-call XML fragment leaking.
**Fixed (committed `a798ebd0`; needs controller deploy):** `stripToolCallsFromContent` (controller/tool-call-parser.ts) only removed COMPLETE `<tool_call>…</tool_call>` blocks, so a tool call in the `<parameter>/<arg_value>` dialect or split across stream deltas left a stray fragment that leaked into the answer/reasoning. Added two passes: drop a dangling `<tool_call>` (open-to-end) + strip orphan tool-call structural tags (tool_call/arguments/arg_value/arg_key/invoke/function/parameter). +1 regression test (lone tag, partial call, prose untouched). 52/52 controller tests green.

### Iteration 9 (nav/UI sweep — no bugs)
**Verified pass, no issues:** D2 nav (Status/Usage/Models/Plugins/Server all load; the Server "error" is just the controller LOGS showing a backend vLLM/triton launch error — not a UI crash) · D1 sidebar collapse/expand · D5 Search ⌘K (opens correctly). Note: controller/model went **OFFLINE** mid-session (`rtx-6000-pod OFFLINE`), so agent-chat flows (B*, tool turns) can't be re-tested until a model is relaunched (`POST /launch/:recipeId`).

### Iteration 10 (UI panels sweep — no bugs)
**Verified pass, no crashes:** F2 Filesystem panel (lists files), F5 Canvas panel (renders), Browser panel (no crash; URL-bar internals inconclusive via automation). Git-diff (Review) + Terminal not reached (in the launcher card view; harness ref instability). No React error boundaries anywhere.
**Assessment:** the autonomous UI/nav sweep is thorough and clean — no contained bugs remain that I can find without the model online. High-value chat-flow testing (steer mid-stream, tool turns, reload-mid-stream) is blocked until a model is relaunched. The substantive remaining work is the deferred architectural items (side-chat streaming, Phase 3b transport, new-session sidebar visibility) which need a faithful env / user steer.

## ⚠️ Pending controller deploys (2 fixes)
Both `fd118a6c` (newline collapse) and `a798ebd0` (tool-call fragment leak) are **controller** changes — they only reach the live app after `scripts/deploy-remote.sh controller` (which restarts the running model). Not auto-deployed (outward-facing + kills the model).

### Iteration 11 (new-session-visibility — full root cause + ready fix spec)
**Root cause (fully traced):** switching away from a single-pane running session **destroys its tab**. Chain: `setPaneSession`→`pruneOrphanSessions` (pane-controller.ts:63) → `pruneSessions` (runtime/store.ts:23) deletes every session id not in `referencedSessionIds` (selectors.ts — **pane sessions only**). And `computeActiveSessionBroadcast` (workspace/effects.ts:199) only iterates `panesById`. So a backgrounded running session is pruned + never broadcast → vanishes everywhere.
**Ready fix spec (2 contained, unit-testable changes — NOT landed: needs model online to verify lifecycle interactions):**
1. `pruneSessions`: keep a session whose `status` is `running`/`starting` even if unreferenced (`if (!referencedIds.has(id) && !isRunning(session))`). Bounded: once it settles to idle/done, the next prune removes it (reverts to current behavior).
2. `computeActiveSessionBroadcast`: after the pane loop, also push running sessions from `state.sessions` not already included, with `paneId:""`, `focused:false`.
**Handoff:** running+open → active row; running+backgrounded → orphan active row (spinner, via this fix); finished+backgrounded → pruned → history row (unseen dot, via the iteration-6 poll feature already shipped). **Risks to verify live:** does closing a running tab now leak it? prune timing after finish vs history persistence; merge/focus interaction with `paneId:""` orphans. **Defer until model online** — exactly the Phase-4 session-identity area the audit flagged as riskiest.

## Remaining big items (need user steer / faithful env)
1. **Side-chat streaming** — integrate side-chat session into runtime reconcile (CORE controller change; high risk, deferred).
2. **Phase 3b transport** — cursor+snapshot JSON-GET resume so reload-mid-stream reattaches in the standalone build (CORE transport; high risk).

### Iteration 12 (model BACK ONLINE `glm-5.2` — landed + live-verified the iter-11 fix, swept reported flows)
Model `glm-5.2` is serving again, so the iteration-11 fix was implemented and verified end-to-end (QA Electron rebuild, CDP 9333).
- 🔧✅ **New-session-visibility** (commit `312a411b`): both contained changes landed (`pruneSessions` keeps running/starting orphans; `computeActiveSessionBroadcast` pushes them as `paneId:""` background entries). +prune/broadcast unit tests; 177/177 e2e green. **Live:** start a turn → switch to New chat → the backgrounded session shows a **running spinner** in the expanded sidebar. No tab leak observed on close; settled orphan pruned on next pass.
- 🔧✅ **Collapsed-Chats "blue circle"** (commit `6e6fac5f`): accent dot on the collapsed **Chats** header when a background chat has unseen activity (`unseen` flag, so the chat you're watching never trips it). **Live:** focused on running chat → no dot; navigate away mid-stream → "Chats •" appears (screenshot). This is the user's "no blue-circle notification" fix.
- ✅ **Reasoning visible while streaming** (`86c0c089`): glm-5.2 streams a "Thought" block (auto-expanded), collapses to "Thought / Worked for Ns" on settle; markdown answer renders clean (lists/bold/structure). LaTeX `$$…$$` renders raw (no KaTeX — enhancement, unreported).
- ✅ **B-series: two messages in a row** (`a75768b1`): send → settle (FIRST-OK) → follow-up runs and settles (SECOND-OK). No stall.
- ✅ **Switch chats keeps your place** (`5acf5871`): opening the chat at sidebar position 5 kept it at position 5; 22 chats, order fully preserved, no dupes/loss.
- ✅ **Abort-not-error** (`df6af425`): Stop mid-stream settles clean — no error text, no error-styled block, partial content kept.
- ❌ **Side-chat via navbar** (open right panel → "Show tools" + → "Side chat" → send): **LIVE-REPRODUCED — spins at running 20s+, NEVER replies, no error.** Root cause confirmed: side-chat session in local `useState`, never in the workspace store, so the single-binding `sessionRuntimeController` never subscribes (it explicitly forbids other subscribers). **DEFERRED — core/high-risk to the critical streaming path + a product decision ("is a side chat a first-class session?"); needs user sign-off.** Two fix options documented in memory `project-chat-session-pipeline-audit`.
- ⚠️ **Note (unreported):** composer set to a non-loaded model (e.g. `nemotron-3-ultra`, `active:false`) → raw `503 status code (no body)`. A "model not running" message would be friendlier.

### Iteration 13 (steer + tool turns + 503-shape fix)
- ✅ **Steer mid-stream**: started a long count, sent a steer message while streaming → accepted (composer stays editable + Send active during a turn), turn settled clean, no error, composer ready. No break.
- ✅ **Tool turns**: "use list_files…" → model ran a tool (rendered as a **"Ran 1 command" / "Ran ls -A"** collapsible activity disclosure, alongside a "Thought" reasoning disclosure), then a clean markdown answer ("13 items… 11 files / 2 directories") with inline code intact. Activity grouping (ZCode "worked for X" pattern) renders correctly.
- 🔧 **503 model-not-running message** (commit `dd0b19a1`, **needs controller deploy**): the chat proxy returned its clear "Model X is running; Y is not. Launch it…" message in FastAPI `{detail}` shape, which the pi/OpenAI SDK ignores → bare "503 status code (no body)". Now returns OpenAI shape (`error.message`/`type`/`code`) + keeps `detail`. Extracted `modelNotRunningError()`, +2 unit tests. **Live re-verify after deploy** (3 controller fixes now pending: `fd118a6c`, `a798ebd0`, `dd0b19a1`).
