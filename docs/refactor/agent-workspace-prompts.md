# Agent Workspace Refactor — Sequenced Prompts

Goal: Decompose `frontend/src/app/agent/_components/agent-workspace.tsx` (≈1947L, 10+ `useEffect`s, multiple subsystems) into thin, typed controllers with **zero `useEffect`s** in the workspace shell, centralised typed state, and fewer total lines of code.

Run prompts in order. Each prompt is self-contained: hand it to a worker droid as-is.

---

## Prompt 1 — Define the canonical typed state and a single workspace store

**Files to read (do not edit yet):**
- `frontend/src/app/agent/_components/agent-workspace.tsx`
- `frontend/src/app/agent/_components/chat-pane.tsx` (only `SessionTab`, `makeFreshTab`, `ChatPaneHandle` exports)
- `frontend/src/app/agent/_components/pane-layout.ts`
- `frontend/src/lib/agent/active-sessions.ts`
- `frontend/src/lib/agent/projects-store.ts`
- `frontend/src/components/projects-nav-section.tsx` (event name constants only)

**Files to create:**
- `frontend/src/lib/agent/workspace/types.ts`
- `frontend/src/lib/agent/workspace/store.ts`
- `frontend/src/lib/agent/workspace/store.test.ts`

**What to do:**
1. In `types.ts`, define the single source of truth:
   - `ProjectEntry`, `AgentModel`, `GitSummary` (move out of `agent-workspace.tsx`).
   - `PaneId`, `PaneState`, `WorkspaceLayout` (re-export from `pane-layout.ts`).
   - `WorkspaceState`:
     ```ts
     type WorkspaceState = {
       projects: ProjectEntry[];
       projectsLoaded: boolean;
       selectedProjectId: string | null;
       agentCwd: string;
       models: AgentModel[];
       selectedModel: string;
       modelsLoading: boolean;
       layout: WorkspaceLayout;
       panesById: ReadonlyMap<PaneId, PaneState>;
       focusedPaneId: PaneId;
       setupWarning: string;
       error: string;
       gitSummaries: ReadonlyMap<string, GitSummary>;
       computer: { open: boolean; tab: "browser" | "files" | "diff"; width: number };
       browserToolEnabled: boolean;
       browserUrl: string;
       browserInput: string;
       hydrated: boolean;
     };
     ```
   - Action union `WorkspaceAction` covering every mutation today (project select, set models, open new session, replay session, replay in split, focus tab, rename tab, split tab, close pane, set computer tab/width, set browser url, hydrate, etc.). No `any`.
2. In `store.ts`, implement a pure reducer `reducer(state, action): WorkspaceState` plus:
   - `createInitialState()` — pure, no `window` access.
   - Pure helpers extracted from `agent-workspace.tsx`: `normalizePersistedTab`, `restorePersistedPaneState`, `tabForPersistence`, `loadPersistedActiveAgentSessions`, `persistActiveAgentSessions`, `layoutFromPaneIds`, `tabFromSnapshot`, `isEmptyStarterTab`, `findPaneTabByPiSessionId`, `newPaneId`, `newRuntimeId`, `randomIdSegment`.
   - All localStorage keys (`PANE_STATE_KEY`, `PANE_LAYOUT_KEY`, `SELECTED_PROJECT_KEY`, `BROWSER_TOOL_KEY`, `COMPUTER_*_KEY`, `ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY`) move here as exported constants.
3. In `store.test.ts`, port logic-only tests from existing `agent-workspace.test.ts` (e.g. `setupWarningFromPiCheck`, `normalizePersistedTab`). Add tests for `reducer` covering: open new in empty starter pane, replay into focused pane, replay into split, rename, focus, close pane → focuses sibling.
4. Do not touch `agent-workspace.tsx` yet. Make sure existing tests still pass.

**Constraints:**
- No React imports in `store.ts` / `types.ts`.
- No `useEffect` anywhere created in this prompt.
- All exported functions are pure; persistence helpers take a `Storage` parameter (default `window.localStorage` lazily) so they're testable.
- Keep equivalent behaviour to today; do not redesign semantics.

**Expected output:**
- New files compile under `npx tsc --noEmit` and `npx vitest run` passes.
- Patch summary listing every action handled and which `agent-workspace.tsx` block it replaces.

---

## Prompt 2 — Side-effect adapters (localStorage, DOM events, fetch) as plain functions

**Files to read:**
- `frontend/src/app/agent/_components/agent-workspace.tsx`
- Files created in Prompt 1
- `frontend/src/components/projects-nav-section.tsx` (event names)
- `frontend/src/lib/agent/safe-json.ts`

**Files to create:**
- `frontend/src/lib/agent/workspace/persistence.ts`
- `frontend/src/lib/agent/workspace/effects.ts`
- `frontend/src/lib/agent/workspace/effects.test.ts`

**What to do:**
1. `persistence.ts` exposes:
   - `loadInitialFromStorage(storage): Partial<WorkspaceState>` — replaces the giant "Restore preferences" `useEffect`. Includes: pane state restore, layout-only fallback, computer width, computer tab, forced `rightPanelOpen = false`, browser tool migration, sessionsCollapsed migration, computer-default-closed migration.
   - `writePaneState(storage, state)`, `writeSelectedProject`, `writeComputerTab`, `writeComputerWidth`, `writeBrowserTool`, `writeActiveSessions`. All pure, callable from action handlers.
2. `effects.ts` exposes a single function:
   ```ts
   function runWorkspaceEffect(action, prevState, nextState, deps): void
   ```
   It receives the dispatched action and centralises every side effect that exists today:
   - localStorage writes (delegated to `persistence.ts`)
   - `window.dispatchEvent(SESSIONS_CHANGED_EVENT | ACTIVE_AGENT_SESSIONS_EVENT | PROJECTS_CHANGED_EVENT)`
   - The "broadcast active sessions" computation (current `useEffect` near the broadcast block) — implement as `computeActiveSessionBroadcast(state)` and dispatch only when result changes.
   - Triggering session replays via `deps.queueReplay(paneId, piSessionId)`.
   - Fetching `/api/agent/setup-checks`, `/api/agent/models`, `/api/agent/projects`, `/api/agent/git-diff` — exposed via `deps.api.*` so it's mockable.
3. `effects.test.ts` covers: action `OPEN_NEW_SESSION` writes pane state and dispatches `SESSIONS_CHANGED_EVENT`; action `REPLAY_SESSION` queues a replay; broadcast diffing avoids duplicate events.
4. Do not touch `agent-workspace.tsx` yet.

**Constraints:**
- Zero React imports.
- One exported `runWorkspaceEffect` entry point — no scattered side-effect functions in callers.
- All DOM/window access goes through injected `deps` for testability (`deps.window`, `deps.storage`, `deps.api`, `deps.queueReplay`).

**Expected output:**
- Tests pass.
- A table in the patch summary mapping each `useEffect` in `agent-workspace.tsx` to the action(s) and effect handler that will replace it.

---

## Prompt 3 — `useWorkspace` hook: one effect, replaces all 10+ `useEffect`s

**Files to read:**
- `frontend/src/app/agent/_components/agent-workspace.tsx`
- Files from Prompts 1 and 2

**Files to create:**
- `frontend/src/app/agent/_components/use-workspace.ts`
- `frontend/src/app/agent/_components/use-workspace.test.tsx`

**What to do:**
1. `useWorkspace()` returns `{ state, dispatch, handles }`:
   - Uses **one** `useReducer(reducer, undefined, createInitialState)`.
   - Uses **one** `useEffect` whose entire body is:
     ```ts
     useEffect(() => {
       const hydrated = loadInitialFromStorage(window.localStorage);
       dispatch({ type: "HYDRATE", payload: hydrated });
       const unsub = subscribeWorkspaceWindowEvents(window, dispatch);
       return unsub;
     }, []);
     ```
   - All other reactions to state changes happen through a `dispatch` wrapper that calls `runWorkspaceEffect(action, prev, next, deps)` synchronously after the reducer returns. No additional `useEffect`s.
2. `subscribeWorkspaceWindowEvents(window, dispatch)` (define in `effects.ts` if not already): one place that registers every listener in `agent-workspace.tsx` today (`NEW_AGENT_SESSION_EVENT`, `ACTIVE_AGENT_SESSION_RENAME_EVENT`, `ACTIVE_AGENT_SESSION_OPEN_EVENT`, `vllm-studio.agent.openSessionSplit`, `PROJECTS_CHANGED_EVENT`). Returns a single cleanup.
3. `handles` exposes the imperative helpers the JSX needs:
   - `openNewSessionInFocusedPane`, `replaySessionInFocusedPane`, `replaySessionInSplitPane`, `openSessionPayloadInPane`, `renameTab`, `focusTab`, `splitTabIntoNewPane`, `selectProject`, `setBrowserUrl`, `setBrowserInput`, `setComputerTab`, `toggleBrowserTool`, `setComputerWidth`, `registerPaneHandle`, `runBrowserCommand`.
   - Each is a thin wrapper around `dispatch(...)` or a stable callback; defined once via `useMemo`, not `useCallback` per helper.
4. URL-driven navigation (current `handledNavRef` `useEffect`) becomes an action `URL_NAV_REQUESTED` dispatched from the workspace component on render based on `useSearchParams()`; the reducer guards idempotency via a stored `lastHandledNavKey`. No extra `useEffect`.
5. Browser SSE subscription (`/api/agent/browser/events`) is owned by `useWorkspace` inside the single mount effect, gated by `state.browserToolEnabled`. Use a ref + a subscription manager — no second `useEffect`.

**Constraints:**
- Exactly **one** `useEffect` in `useWorkspace`, and zero anywhere else in the agent workspace tree files modified by this refactor.
- Strictly typed: no `any`, no unchecked `as`.

**Expected output:**
- `useWorkspace.test.tsx` (renderHook) verifies: hydration runs once; dispatching `OPEN_NEW_SESSION` mutates state and writes localStorage; window event triggers reducer.
- Patch summary: count of `useEffect`s before/after.

---

## Prompt 4 — Rewrite `agent-workspace.tsx` as a thin view

**Files to read:**
- Current `frontend/src/app/agent/_components/agent-workspace.tsx`
- All files from Prompts 1–3

**Files to edit:**
- `frontend/src/app/agent/_components/agent-workspace.tsx` (target: ≤ 400 lines, zero `useEffect`, zero `useState`, zero `useRef` for state)

**Files to create:**
- `frontend/src/app/agent/_components/agent-browser-panel.tsx` (computer pane: browser tab content, tab switcher, resize handle)
- `frontend/src/app/agent/_components/agent-workspace-shell.tsx` (top bar / error banner / setup warning / empty state)

**What to do:**
1. Replace the body of `AgentWorkspace` with:
   ```tsx
   const { state, dispatch, handles } = useWorkspace();
   // pure render only
   ```
2. Move:
   - Browser URL form, `normalizeBrowserInput`, `startComputerResize`, browser command verbs → `agent-browser-panel.tsx`. All side effects route through `handles.runBrowserCommand` and `dispatch`.
   - Error banner / setup warning / project empty state JSX → `agent-workspace-shell.tsx`.
3. `PaneGrid` props read from `state` and call `handles.*` directly.
4. Delete every helper now living in `store.ts` / `effects.ts` / `persistence.ts` from `agent-workspace.tsx`.
5. Update `agent-workspace.test.ts` to import its helpers from the new modules.

**Constraints:**
- Zero `useEffect` in `agent-workspace.tsx`, `agent-browser-panel.tsx`, `agent-workspace-shell.tsx`.
- Zero direct `localStorage` / `window.addEventListener` / `fetch` in these files — go through `handles` / `dispatch`.
- Net line count for `agent-workspace.tsx` must drop by ≥ 70%.

**Expected output:**
- `cd frontend && npx tsc --noEmit` clean.
- `cd frontend && npx vitest run` green.
- `cd frontend && npx next build` succeeds.
- Patch summary with before/after line counts for each file.

---

## Prompt 5 — Extract pane controller and computer/browser controller cleanly

**Files to read:**
- Output of Prompt 4
- `frontend/src/app/agent/_components/pane-grid.tsx`
- `frontend/src/app/agent/_components/pane-layout.ts`

**Files to create:**
- `frontend/src/lib/agent/workspace/pane-controller.ts`
- `frontend/src/lib/agent/workspace/computer-controller.ts`
- Matching `.test.ts` files

**What to do:**
1. Move every pure pane operation currently in `store.ts` (`openNewSessionInFocusedPane`, `replaySessionInFocusedPane`, `replaySessionInSplitPane`, `openSessionPayloadInPane`, `renameTab`, `focusTab`, `splitTabIntoNewPane`, `closePane`) into `pane-controller.ts` as pure `(state, payload) => state` functions. The reducer becomes a dispatch table calling them.
2. Move computer/browser logic (`setComputerTab`, `setComputerWidth`, `toggleBrowserTool`, `setBrowserUrl`, `normalizeBrowserInput`, `clampComputerWidth`) into `computer-controller.ts`.
3. Add unit tests for each controller — they should not need any React, DOM, or fetch mocks.
4. `store.ts` shrinks to: state assembly + reducer dispatch table + hydrate/persistence wiring.

**Constraints:**
- Each controller file: no React, no `window`, no `fetch`.
- Functions are pure and total: invalid input returns the same state.

**Expected output:**
- Tests green.
- Updated patch summary with new line counts and a confirmation that `store.ts` reducer is a flat dispatch table (no nested logic).

---

## Prompt 6 — Lock it down: types, lint, and `useEffect` budget

**Files to read:**
- Everything modified in Prompts 1–5

**Files to edit/create:**
- `frontend/eslint.config.mjs` (or equivalent)
- `frontend/src/app/agent/_components/__lint__/no-effects.test.ts` (or a grep-based vitest)

**What to do:**
1. Add a lint rule (or vitest assertion) that fails if any file under `frontend/src/app/agent/_components/` (excluding `chat-pane.tsx` for now) contains `useEffect(`.
2. Add a vitest that asserts `agent-workspace.tsx` line count ≤ 400 to prevent regressions.
3. Run `cd frontend && npx next build && npx vitest run && npx tsc --noEmit`. Fix any issues introduced by the refactor.
4. Update `CHANGELOG.md` with a single line summarising the refactor.

**Constraints:**
- No new dependencies.
- No behavioural change vs. main. If a regression is found, fix it without expanding scope.

**Expected output:**
- Green build + tests.
- Patch summary listing:
  - Files added / modified / deleted
  - `useEffect` count: before vs. after (target: workspace shell = 0; `useWorkspace` = 1)
  - Total lines removed
  - List of subsystems now isolated (workspace store, pane controller, computer controller, persistence, effects, hook, panels)

---

## Sequencing and definition of done

1. Prompt 1 — types + reducer skeleton (no integration)
2. Prompt 2 — side-effect adapters
3. Prompt 3 — `useWorkspace` hook (single effect)
4. Prompt 4 — rewrite `agent-workspace.tsx` as a thin view
5. Prompt 5 — extract pane + computer controllers
6. Prompt 6 — enforce invariants and ship

**Done when:**
- `agent-workspace.tsx` has **0** `useEffect`s.
- The whole agent workspace tree (excluding `chat-pane.tsx`) has **0** `useEffect`s.
- One reducer + one hook own all workspace state.
- `WorkspaceState` and `WorkspaceAction` are exhaustively typed.
- Net LOC across the affected files is lower than today.
