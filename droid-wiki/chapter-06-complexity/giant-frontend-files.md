# 1 — Giant frontend files

> **Severity:** Critical
> **Cross-link:** [Chapter 1 — chat-pane deep dive](../chapter-01-frontend/chat-pane-deep-dive.md), [agent-workspace deep dive](../chapter-01-frontend/agent-workspace-deep-dive.md)

## Verified file sizes

```
1231 frontend/src/app/agent/_components/chat-pane.tsx        (~42 KB)
1145 frontend/src/app/agent/_components/agent-workspace.tsx  (~45 KB)
 547 frontend/src/app/agent/_components/filesystem-panel.tsx (~18 KB)
 516 frontend/src/components/projects-nav-section.tsx        (~17 KB)
```

These four files together account for **3,439 LoC** in the new agent surface
— roughly a third of the entire `frontend/src/app/agent/` net insertion
delta.

## Why it's complex

### `chat-pane.tsx` (1,231 LoC)

A single file holds eight conceptually distinct roles:

1. Discriminated-union type definitions (`AssistantBlock`, `ChatMessage`,
   `SessionTab`, `TokenStats`).
2. Attachment normalisation (text-inline ≤ 350 KB, data-URL ≤ 1.5 MB,
   metadata-only otherwise).
3. The streaming reducer (`applyPiEvent`) that mutates message blocks from
   pi event deltas — `text_delta`, `thinking_delta`, `toolcall_end`,
   `tool_execution_*`.
4. The replay reducer (`replaySessionEvents`) — the *same* state shape
   reconstructed from history, but with two tolerated event shapes
   (`message` and the older `message_end`).
5. The send/abort lifecycle (POST `/api/agent/turn`, line-by-line SSE parse,
   POST `/api/agent/abort`).
6. The `<ChatPane>` component itself.
7. The `<SessionTabsBar>` + `<TabPill>` views — including drag-and-drop with
   the bespoke `application/x-vllm-session` mime type.
8. The `<TimelineMessage>` view (markdown + thinking `<details>` + tool
   `<details>`).

Two state machines (the streaming reducer and the replay reducer) share
their helpers (`appendDelta`, `upsertTool`, `usageFromEvent`,
`extractToolText`, `messageText`) but have no contract enforcing they stay
aligned. When pi adds a new event type, both reducers must be updated in
lock-step or replay diverges from live.

### `agent-workspace.tsx` (1,145 LoC)

This file is the orchestrator. It owns:

- Project picker state and the active `cwd` (with `loadAgentProjects()`
  silently switching between Electron IPC and HTTP).
- `models` + `selectedModel` from `/api/agent/models`.
- The full pane tree (`layout`) plus `panesById: Map<PaneId, PaneState>`
  plus `paneLoadersRef: Map<PaneId, (sessionId: string) => void>`.
- The browser tool toggle and the renderer-side dispatcher
  (`runBrowserCommand`) that runs eight verbs against `webviewRef.current.executeJavaScript`.
- The Computer-panel resize logic (`mousedown` → `mousemove` listeners,
  clamped 320–960 px, persisted to `localStorage`).
- URL-param session/project resumption via `handledNavRef`.
- The model picker dropdown.

It also carries **two one-time migration flags** in `localStorage`
(`BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY`, `COMPUTER_DEFAULT_CLOSED_MIGRATION_KEY`)
plus cleanup of a legacy `vllm-studio.agent.sessionsCollapsed` key. New
storage migrations would land in this same file.

### Coupling fan-out

`chat-pane.tsx` depends on (or is depended on by):

```mermaid
graph LR
  CP[chat-pane.tsx] -->|POST| Turn[/api/agent/turn]
  CP -->|POST| Abort[/api/agent/abort]
  CP -->|GET| SessByID[/api/agent/sessions/:id]
  CP -->|exposes| Loader[registerExternalLoader]
  WS[agent-workspace.tsx] -->|owns| CP
  WS -->|drag-and-drop| CP
  Sidebar[projects-nav-section.tsx] -.dispatches.- WS
  WS -->|browser EventSource| BrowserEvents[/api/agent/browser/events]
  WS -->|POST| BrowserResult[/api/agent/browser/result]
```

Any structural change to `SessionTab` or `ChatMessage` ripples into:
`agent-workspace.tsx` (per-pane state), `projects-nav-section.tsx` (active
sessions broadcast), the Next API routes that produce events, and
`pi-runtime.ts` (event shape).

### `projects-nav-section.tsx` (516 LoC) and `filesystem-panel.tsx` (547 LoC)

Smaller but still single-file modules with multiple responsibilities:

- `projects-nav-section.tsx` is **dual-mode** — Electron IPC vs.
  `/api/agent/projects` HTTP fallback. The dual-mode logic is interleaved
  with the rendering logic, so it's not obvious which path executes for any
  given user.
- `filesystem-panel.tsx` packs the file tree, the file viewer, the
  per-line comment store, and the comment popover into one file. Comments
  involve a server round-trip to `/api/agent/comments`.

## What could simplify it

These are **directional** suggestions; the file-level prescription is in
Chapter 7.

- Lift the streaming reducer and the replay reducer into a single
  `lib/agent/turn-reducer.ts` with a typed contract that both pathways
  consume.
- Move attachment classification to `lib/agent/attachments.ts` so the
  size thresholds become a single testable function.
- Split `<TimelineMessage>` and `<SessionTabsBar>` into their own component
  files — they are independent views.
- Lift the browser dispatcher in `agent-workspace.tsx` into
  `lib/agent/browser-dispatcher.ts`; the workspace should hold state, not
  the eight `executeJavaScript` strings.
- Lift the layout/pane-state hooks into `hooks/use-pane-tree.ts` so
  `agent-workspace.tsx` shrinks to a presentational shell.
- Make the dual-mode in `projects-nav-section.tsx` an explicit
  `useProjectsTransport()` hook so the renderer code reads as one path.
