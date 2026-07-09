# PROGRESS

State snapshot after the terminal/perf/UX overhaul session. Branch `loop/home-for-people`, pushed to `origin/main` through commit `7192e00a`.

## Shipped to main (released)

Release workflow succeeded on push; semantic-release cut the release from these commits.

### Fixes and features
- `fix: portal sidebar new-chat menu ...` (pre-session work, included in push)
- `fix: open sidebar new terminal directly instead of converting a fresh chat` — single `openProjectTerminal` reducer action; no more chat-then-convert.
- `feat: attach models to omp via models.yml with enabledModels opt-in` — omp (`~/.omp/agent/models.yml`) is a local-agent attach target; appends `provider/model` to `enabledModels` in `config.yml` when an allowlist exists; reported via `extraUpdates`.
- `fix: keep model logo initials visible until the avatar image loads` — initials base layer, avatar overlay on `onLoad`, stale-event guards.
- `fix: isolate chat and terminal pane targets and consume one-shot nav params` — chats never claim/replace terminal panes; `new/terminal/split/open` URL params stripped after handling (reload no longer replays them).
- `feat: configurable terminal hotkeys, search, font size, and pane splits` — `src/lib/terminal-keybinds.ts` store; defaults: ⌘T new, ⌘W close, ⌘K clear, ⌘F search, ⌘±/⌘0 font, ⌘D/⌘⇧D splits; Settings → Terminal section with rebind capture, per-row/all reset, duplicate warnings, font slider; xterm `@xterm/addon-search` + inline search bar; split buttons in terminal pane header.
- `fix: decouple agent browser tools from panel state and widen chromium discovery` — browser tools follow the persisted composer toggle, not panel geometry (no more silent tool loss / runtime restarts on focus change); Brave/Edge/Arc/Vivaldi/Canary discovery; stateful reading-mode fallback; unavailability banner in panel; dead webview command surface removed.
- `feat: cap workspace splits at three columns by two rows` + `fix: clamp restored workspace layouts to the split grid cap` — `layoutGridSize`/`splitLeafWithinLimits`/`clampLayoutToLimits`; restore prunes only terminal leaves, never chats.
- `perf: stop syncing transcript and session caches through durable ui prefs` — `ui-preferences.json` went 3.1MB → ~7KB; the 3MB payload was re-serialized over IPC and POSTed to the controller after every workspace change.
- `fix: keep controller credentials out of remote ui preference sync` — `local-studio.controllers` (apiKeys) filtered from controller `/studio/settings` sync on save AND hydrate; desktop-local persistence unchanged.
- `perf: split transcript crash cache into per-session keys` — v2 per-session localStorage keys replace the 3MB monolith parsed on every session open; legacy key purged on load; excluded from durable prefs by prefix.
- `perf: mount sidebar terminal owners lazily on first activation` — no more N simultaneous xterm+PTY boots on /agent mount.
- `feat: let sidechats pick their own model` — same `AgentModelPicker` as main pane; selection persists on the sidechat session and drives turns.
- `fix: register xml grammar so html files highlight` — highlight.js `xml` grammar registration (serves html/htm/svg/xml/vue/svelte).
- `fix: open sidebar sessions in place instead of hard page reloads` — root cause of "black pane for seconds": `navigateToSessionHref` fell back to `window.location.assign` after a 70ms race. Session clicks now dispatch `workspaceCommands().openSession(project, piSessionId, title)` (in-place reducer path); hard-nav fallback deleted; active rows reuse the replay/focus path.
- `fix: drop stale replay drains when a pane swaps sessions` — `ChatPaneHandle` carries `sessionId`; replay queue drains only when handle matches the pane's current session (fixes transcript landing in a dead session on same-pane switches).
- `feat: infer model family avatars for local recipe ids` + `fix: fall back through avatar owner candidates for local model paths` — ordered owner candidates (author → plausible hub owner → brand keyword table) advancing on img error; 22/22 model rows show brand icons.

### Tests added (all mutation-checked by Tester agents)
- `frontend/scripts/open-project-terminal.test.ts` — terminal action, splits, grid caps, chat isolation, clamp, restore.
- `frontend/scripts/omp-local-agent-attach.test.ts` — omp attach flow.
- `frontend/scripts/terminal-keybinds.test.ts` — match/serialize/store.
- `frontend/scripts/transcript-cache.test.ts` — v2 per-session cache.
- `frontend/scripts/replay-queue.test.ts` — stale-handle drain guards.
- `frontend/scripts/terminal-pane-model.test.ts` — 3 tests updated to the new chat/terminal isolation contract.

### Desktop
Canonical app `/Applications/Local Studio.app` rebuilt/reinstalled repeatedly; final installed build includes everything above; `/api/desktop-health` 200.

## DONE 2026-07-09: main CI fixed forward (`eae9167a`, CI green)

- `navigate-to-session.test.ts` rewritten to the push-only contract (hard-nav fallback deleted on purpose).
- Replay harness handles now stamp `sessionId`; last-wins test uses an unbound loading session (a bound session correctly rejects mismatched replays).
- `agent-browser-tools-regressions.test.ts`: dropped the two tests of the deleted `runBrowserPanelCommand` webview surface (private-URL guarding still covered by the reader fetch route test).

## DONE 2026-07-09: terminal session tabs + persistence + open latency (`2cfa5d98`, `184e5d8f`)

User-reported problems fixed:
1. **Slow new terminal/chat** — sidebar '+' menu preloads xterm chunks; terminal boot skips the `pty.status()` pre-flight IPC; projects list warm-starts from a localStorage cache (`local-studio.agent.projects.cache.v1`) so `/agent?project=…&new=/terminal=` no longer blocks on the projects fetch before opening the pane.
2. **Terminals now create session tabs** — terminal panes broadcast as `kind:"terminal"` active-session rows (tabId = PTY mountKey, `projectId` stamped on `TerminalPaneState`); sidebar renders them with a Terminal icon under their project.
3. **Terminals survive navigation / Back** — session replay never clobbers a terminal pane (splits beside it; `siblingPaneId` skips terminal leaves). Clicking a terminal row focuses its pane or recreates one with the SAME mountKey — the Electron PTY manager keeps owner-keyed shells alive with a 200KB replay buffer, so it reattaches with history. `/agent?terminal=<mountKey>` deep-links a reattach (`terminal=1` still = fresh terminal).

Tests: `open-project-terminal.test.ts` (+5), `terminal-pane-model.test.ts` (broadcast + split-not-clobber), `projects-store-cache.test.ts` (new). All gates + both suites green; prod build green.

NOT yet click-verified in Electron (desktop rebuild kicked off; PTY reattach path needs a live app pass).

## Known remaining risks / not verified
- The exact Electron revisit of long-RUNNING glm-5.2 sessions was never fully reproduced; runtime SSE event-replay catch-up for in-flight turns is untouched and remains the suspect if slowness persists there.
- Large-project sidebar expansion had one inconclusive freeze probe (may have been tooling).
- Sidechat model picker + HTML highlighting were gate-verified, not click-tested in Electron.
- `local-studio.controllers` with apiKeys still lives in desktop-local `ui-preferences.json` (by design for reinstall restore); only remote sync is filtered.
- Untracked WIP in the tree not mine, left alone: `vercel.json`, `.vercelignore`, `frontend/src/app/docs/`, `frontend/src/app/landing/`, `frontend/src/features/landing-page/`, `.gitignore` edits.

## Also delivered earlier in session
- Models-page redesign proposal (controller-rack concept) with interactive mockup at `/tmp/models-rack-proposal.html` — awaiting user verdict; multi-controller fan-out plumbing not implemented.
