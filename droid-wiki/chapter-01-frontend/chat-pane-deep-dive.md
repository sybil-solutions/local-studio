# `chat-pane.tsx` — deep dive

> File: `frontend/src/app/agent/_components/chat-pane.tsx`
> Size: **1,231 lines / ~42 KB** (single file).

This is by a wide margin the largest UI module in the PR and the obvious
candidate for a Chapter-7 split recommendation. It packages eight roles into
one file: type definitions, attachment handling, replay engine, streaming
event reducer, send/abort lifecycle, the `<ChatPane>` component itself, the
`<SessionTabsBar>`, and the `<TabPill>` / `<TimelineMessage>` views.

## Public surface (named exports)

| Export | Kind | Purpose |
| ------ | ---- | ------- |
| `ChatPane` | component | The per-leaf chat surface. |
| `SessionTabsBar` | component | Tabs shown in the workspace header for the focused pane. |
| `makeFreshTab` | factory | Returns a brand-new `SessionTab` with random ids and `piSessionId: null`. |
| `replaySessionEvents` | pure function | Hydrates a list of stored pi events into `ChatMessage[]`. The unit test in `chat-pane.test.ts` covers the current event shape. |
| `ToolBlock` / `TextBlock` / `ThinkingBlock` / `AssistantBlock` | types | The discriminated union for assistant message blocks. |
| `ChatMessage` | type | The flat message list element. |
| `TokenStats` | type | `{ read; write; current }` derived from pi `usage` events. |
| `SessionTab` | type | Tab state stored in the parent. |

## Type model

```ts
export type AssistantBlock = TextBlock | ThinkingBlock | ToolBlock;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  blocks?: AssistantBlock[];   // populated for assistant messages
  timestamp?: string;
};

export type SessionTab = {
  id: string;
  runtimeSessionId: string;     // pi RPC session key on the server
  piSessionId: string | null;   // pi UUID once the first turn lands
  title: string;
  messages: ChatMessage[];
  status: string;               // idle | starting | running | loading
  error: string;
  input: string;                // composer text (lifted into tab state)
  tokenStats?: TokenStats;
};
```

## Composer

- `<textarea>` lives inside a `<form>`; `Enter` submits, `Shift+Enter`
  inserts a newline. Auto-grow up to 160 px (`min-h-[34px] max-h-[160px]`).
- `isMultiline` is set when the textarea grows past 38 px and is used to
  visually highlight the composer frame (commit `b736652d`).
- An invisible `<input type="file" multiple>` powers the paperclip; files go
  through `createAttachment` and become inline-text, data-URL, or
  metadata-only chips. Thresholds:
  - text-like files ≤ 350 KB → embedded as fenced code in the prompt.
  - any file ≤ 1.5 MB → embedded as a data URL.
  - bigger → metadata-only ("File is too large to inline").
- A globe button toggles the browser tool (`onToggleBrowserTool` callback),
  passing through to the workspace state. (Moved here from the Computer
  pane in commit `248de999`.)
- The footer line shows `R <read>` `W <write>` `<current>/<context>`
  formatted via `formatTokenCount` (k, M).

## Send → stream → finalize

`sendMessage` (`chat-pane.tsx:584-670`, approx) flow:

1. Optimistically appends a user message + a blank assistant message to the
   active tab and sets `status: "starting"`.
2. POSTs `/api/agent/turn` with
   `{ sessionId: tab.runtimeSessionId, modelId, message, cwd, piSessionId, browserToolEnabled }`.
3. Reads the SSE body line-by-line. Each `data: …\n\n` chunk parses to one
   of:
   - `{ type: "status", phase }` → maps to `status` (`done` becomes `idle`).
   - `{ type: "error", error }` → sets `tab.error` and stops.
   - `{ type: "pi", event }` → forwarded to `applyPiEvent`. The first
     `event.type === "session"` updates `tab.piSessionId` and notifies the
     parent via `onPiSessionIdChange` (which the workspace converts into a
     `SESSIONS_CHANGED_EVENT` so the sidebar refreshes).
4. On `finally`, forces `status: "idle"`.

## `applyPiEvent` (the streaming reducer)

Switches on `event.type`:

| Event type | Behavior |
| ---------- | -------- |
| `message_update` with `text_delta` | Appends to (or starts) a trailing `text` block via `appendDelta`. |
| `message_update` with `thinking_delta` | Same, but for a `thinking` block — kept above the body, expanded by default (commit `e30a97a9`). |
| `message_update` with `toolcall_end` | Inserts/updates a `tool` block in `running` state with the rendered `arguments` JSON. |
| `tool_execution_start` | Inserts a `tool` block (or no-op if it already exists). |
| `tool_execution_update` | Updates the tool block's `text` from `partialResult.content[0].text`. |
| `tool_execution_end` | Marks the tool `done` (or `error` if `event.isError`). |
| `message` / `message_end` | Used by `usageFromEvent` to update `tokenStats` (read/write/current). |

`appendDelta` and `upsertTool` (defined just below the reducer) keep the
update logic immutable but cheap: they slice/concat instead of cloning whole
arrays. Block ids are generated with `newId(prefix)`.

## `replaySessionEvents` (history hydration)

Pure function used in two places:

1. `chat-pane.test.ts` — verified replay over the current pi `message`/
   `toolResult` event shape.
2. `loadAndReplay` inside `<ChatPane>` — fetches
   `/api/agent/sessions/[id]?cwd=...` and feeds the events into the active
   tab.

It produces `{ messages: ChatMessage[]; title: string | null }`. `title`
becomes the first user message truncated to 40 characters, used to label
tabs.

The function tolerates two pi event shapes (commit `79a84c15` fixed it):

- New: `{ type: "message", message: { role, content: [...] } }`.
- Old: `{ type: "message_end", message: { ... } }` (still accepted).

It also handles `toolResult` messages by walking back through the assistant
list to find the matching `toolCallId` (`assistantWithTool`) so deferred
tool-result messages don't create orphan blocks.

## Abort

```ts
const abortTurn = useCallback(async () => {
  await fetch("/api/agent/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: activeTab.runtimeSessionId || runtimeSessionId }),
  });
  updateTab(tabId, (tab) => ({ ...tab, status: "idle" }));
}, ...);
```

The button is rendered in place of the Send button while `running`. The
abort route asks `piRuntimeManager.getSession(...).abort()` which writes
`{ type: "abort" }` over stdin to the pi child.

## Tabs (`<SessionTabsBar>` and `<TabPill>`)

- Tabs are rendered in the workspace header bar (the focused pane's tabs).
- `+` button calls `makeFreshTab` and activates the new tab.
- Closing the last tab installs a fresh tab automatically.
- Double-click a pill enters rename mode (Enter saves, Escape reverts;
  truncated to 80 chars).
- Pills with a `piSessionId` are draggable; the drag carries
  `application/x-vllm-session` mime data so dropping on a pane edge in
  `<PaneGrid>` triggers a split + replay (`agent-workspace.tsx`'s `onSplit`).

## Timeline rendering (`<TimelineMessage>`)

- User messages render as a `text-fg` block with a small `You` label.
- Assistant messages render as `Pi` plus their blocks. Block-level UI:
  - `thinking` → `<details open>` with italic "Thinking" summary and an
    indented monospace pre.
  - `text` → `<AssistantMarkdown>` with `remark-gfm` + `rehype-highlight`.
  - `tool` → `<details>` with the tool name, status (`running` / `done` /
    `error`), and a monospace pre body. Default-open while `running`.
- Empty assistant messages render `…` while waiting for first delta.

## Auto-scroll

`stickToBottomRef` tracks whether the user is within 80 px of the bottom of
the scroll container; when true, every messages/status update calls
`scrollTo({ top: scrollHeight })`. This was added by `e30a97a9`.

## Why this file is so big

- Two conceptually distinct state machines coexist:
  - The streaming reducer (text/thinking/tool blocks).
  - The replay reducer (the same blocks but reconstructed from history).
- Both reducers depend on the same helpers (`appendDelta`, `upsertTool`,
  `extractToolText`, `messageText`, `usageFromEvent`).
- `<TabPill>`, `<SessionTabsBar>`, and `<TimelineMessage>` are coupled to
  these types because they all consume `SessionTab` / `ChatMessage` /
  `AssistantBlock`.
- Attachments + composer + sending are inline because the tab state
  ownership lives at the workspace level (so `ChatPane` calls
  `onTabsChange` instead of owning a reducer locally).

This is the natural split point for a future refactor: lift the reducer into
`lib/agent/turn-reducer.ts`, lift `replaySessionEvents` into
`lib/agent/replay.ts`, and keep `ChatPane.tsx` for the view.
