# Comparison: vLLM Studio vs `pingdotgg/t3code`

[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) is the design reference for this PR's new agent surface. The branch literally encodes the dependency in its name: `feat/plop-t3code-with-pi`. Several commits explicitly mention t3code:

- `f5f012fa feat: project picker — open + persist working directories (ported from t3code)`
- `ec1bdaa7 micro: bring agent surface closer to t3 shell`
- `bad5d1b6 micro: add command palette stub (Cmd+K, '/' on empty composer) — t3code visual parity, /model + /settings wired`
- `dac05e1c style: text-first chat thread (browser-ai aesthetic) — no avatars, no icon slop`

## Patterns ported

### 1. Project picker

t3code uses a "pick a real directory" model where the user opens a project from disk and the agent's `cwd` is set to that directory. vLLM Studio mirrors this:

- `frontend/desktop/main.ts` exposes `desktop:open-directory` IPC -> `dialog.showOpenDialog({ properties: ["openDirectory"] })`.
- `frontend/desktop/logic/projects-store.ts` persists `~/.vllm-studio/projects.json` (or `app.getPath("userData")/projects.json` per Electron platform conventions).
- `frontend/src/lib/agent/projects-store.ts` provides the same shape as a server-side fallback for browser-only mode.
- `frontend/src/components/projects-nav-section.tsx` (516 lines) renders the project list, with dual-mode read (Electron IPC vs HTTP).

### 2. Multi-pane workspace

t3code splits the view into a chat surface plus a secondary "computer" panel. vLLM Studio's `frontend/src/app/agent/_components/agent-workspace.tsx` (1,145 lines) implements:

- Multi-pane split via `pane-grid.tsx` and `pane-layout.ts`.
- Per-pane tabs (each tab can be a chat session).
- Embedded browser webview (`<webview>`) as a pane content type.
- Terminal drawer in the agent header.
- Filesystem panel.

Commit `e79f8caf feat(agent): multiplex — split panes + per-pane tabs` is the t3code-derived multiplex.

### 3. Sidebar history (sessions list)

t3code keeps a left sidebar listing sessions across projects. vLLM Studio's `frontend/src/components/left-sidebar.tsx` and `projects-nav-section.tsx` together render:

- Project list (with Electron-IPC adds + removes).
- Sessions per project (loaded from `lib/agent/sessions-store.ts`).
- "Resume" by passing pi `--session <uuid>`.

Commit `5ee61d70 feat(agent): session history sidebar — list, load, resume via pi --session`.

### 4. Composer with command palette stub

t3code's composer supports `/` commands (`/fork`, `/clone`, `/compact`, `/model`, etc.) and `Cmd+K`. vLLM Studio's `chat-pane.tsx` adds a stub that wires `/model` and `/settings` (commit `bad5d1b6`). Other commands are placeholders.

### 5. Text-first thread aesthetic

`dac05e1c style: text-first chat thread (browser-ai aesthetic) — no avatars, no icon slop` removes per-message avatars and icon clutter, mirroring t3code's minimal thread UI.

### 6. Browser tool toggle in composer

`248de999 micro: move browser-tool toggle to composer (globe icon)` — the globe icon in the composer toggles the pi browser extension on/off per turn. t3code has a similar tool-toggle pattern.

### 7. Filesystem panel with viewer + per-line comments

`00326fb6 feat(agent): filesystem panel with file viewer and per-line comments` — `frontend/src/app/agent/_components/filesystem-panel.tsx` (547 lines) is t3code-inspired but goes further by adding per-line comment threads (stored in `lib/agent/comments-store.ts`).

### 8. Embedded browser as a tab

`4f09f7ca micro: replace workspace panel with embedded agent browser (webview/iframe)` — the embedded browser replaces the legacy "computer-viewport" panel from the deleted chat module.

## Patterns vLLM Studio uses *differently*

| t3code | vLLM Studio |
|---|---|
| Routing: TanStack Router | Routing: Next.js App Router |
| State: Zustand store with two-stream separation (shell/detail) | State: Zustand `app-slice.ts`, plus per-domain stores in `lib/agent/*` |
| Streaming: SSE direct from controller to client | Streaming: HTTP from renderer to `/api/agent/turn` (Next API), which proxies pi RPC events |
| Agent loop: implemented in t3code | Agent loop: delegated to external `pi` subprocess |
| LLM API: handled in the app | LLM API: pi -> our own OpenAI-compatible proxy at `/v1/chat/completions` (the controller) |

## What vLLM Studio kept that t3code doesn't have

- The full **dashboard / control panel** for vLLM/SGLang/llama.cpp launching, GPU monitoring, recipes (`frontend/src/components/dashboard/**`).
- The **discover / recipes / configs / usage / setup / settings** routes — vLLM Studio is a model orchestration product first; t3code is a coding agent UI first.
- **Engine SSE event consumer** (`frontend/src/hooks/use-controller-events.ts`).

## What's t3code-shaped but missing here

`scope.md` lists T3 Code parity items the PR did NOT yet ship:

- Plan sidebar with proposed-plan workflow.
- Diff panel for file changes.
- Approval flow for risky tool calls (`approval.requested` / `approval.resolved`).
- Session tree / branching (`/fork`, `/tree`).
- Message virtual scrolling (`react-virtuoso` is in deps but the agent thread doesn't yet use it).

These are documented in [`scope.md`](../../scope.md) Phase 2.

## Cross-references

- Pattern doc: [microcommits](../chapter-05-patterns/microcommits.md) (the `micro:` commit prefix is a vLLM Studio convention; not from t3code)
- Pattern doc: [dual-store projects](../chapter-05-patterns/dual-store-projects.md)
- Frontend chapter: [agent surface architecture](../chapter-01-frontend/agent-surface-architecture.md)
- Complexity hotspot: [giant frontend files](../chapter-06-complexity/giant-frontend-files.md)
