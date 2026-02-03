<!-- CRITICAL -->
# Chat system map (Frontend)

Scope (MUST stay accurate):
- `src/app/chat/**`

Goal of this document:
- Give a **complete mental model** of the chat feature.
- Map **every file** in-scope, what it does, what depends on it, and whether it’s active/legacy/partial.
- Provide **visual diagrams** (Mermaid) for runtime flows + state machines.
- Identify likely **dead code**, **duplicate code paths**, and **unintegrated features**.

Non-goals:
- This file does **not** implement refactors.
- It can propose consolidation targets, but it should not prescribe UI/UX.

---

## 0) Glossary

- **ChatMessage**: UI message shape (`role` + `parts[]`) used in the browser and stored by the controller.
- **Run stream**: Controller-owned SSE stream from `POST /chats/:sessionId/turn` emitting `run_start`, `message_*`, `tool_execution_*`, `plan_updated`, and `run_end`.
- **Pi agent runtime**: Controller-owned agent loop built on `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` that executes tools server-side.
- **Controller**: vLLM Studio backend that stores sessions/messages, MCP config, runs tools, etc. Accessed from browser via `/api/proxy/...` (not in scope, but critical dependency).
- **Inference backend**: OpenAI-compatible `/v1` endpoint (vLLM/LiteLLM/etc) called **by the controller**, not by Next.js.
- **Artifacts**: Code/UI snippets extracted from assistant text (` ```artifact-* ``` ` or `<artifact ...>`), shown in preview UI.
- **Agent Plan**: Synthetic tools `create_plan` + `update_plan` that let the model maintain a checklist in agent mode.

---

## 1) High-level architecture (3 “planes”)

### 1.1 Runtime system diagram

```mermaid
graph TD
  subgraph Browser["Browser / Next.js Client"]
    ChatRoutePage["page.tsx - dynamic, ssr:false"]
    ChatPage["chat-page.tsx - GOD component"]
    Zustand["Zustand store - chat-slice.ts"]
  end

  subgraph NextServer["Next.js Server"]
    ApiProxy["/api/proxy/* - controller proxy"]
    ApiTitle["/api/title"]
    ApiTranscribe["/api/voice/transcribe"]
  end

  subgraph Controller["Controller Backend"]
    Runs["POST /chats/:id/turn (SSE run stream)"]
    Sessions[("Sessions + Messages DB")]
    MCP[("MCP servers + tools")]
    Compaction[("Compaction endpoint")]
  end

  subgraph Inference["Inference Backend"]
    OpenAICompat["/v1/chat/completions"]
  end

  ChatRoutePage --> ChatPage

  ChatPage -->|"api.* via /api/proxy"| ApiProxy
  ApiProxy --> Runs
  ApiProxy --> Sessions
  ApiProxy --> MCP
  ApiProxy --> Compaction
  Runs --> OpenAICompat

  ChatPage -->|"title generation"| ApiTitle
  ChatPage -->|"voice transcription"| ApiTranscribe
  ChatPage <--> Zustand
```

### 1.2 Single controller-owned chat backend (important)

There is now **one** network path for chat:

1) **Controller run stream**
- Client sends messages to `POST /chats/:sessionId/turn` (via `/api/proxy`).
- Controller persists messages, runs the agent loop, executes tools, and streams SSE events.

2) **Inference backend**
- Only the controller talks to `/v1` during the run.

This removes the previous split between streaming and persistence. Tool execution is server-side.

---

## 2) Core runtime loops (state machines)

### 2.1 Chat streaming + tool loop (controller-run)

```mermaid
stateDiagram-v2
  [*] --> Ready

  Ready --> Submitted: sendMessage()
  Submitted --> Streaming: open SSE run

  Streaming --> ToolExec: tool_execution_*\n(server-side)
  ToolExec --> Streaming: tool result events

  Streaming --> Ready: run_end

  Ready --> [*]: user leaves page
```

Notes:
- Tool calls are executed **on the controller** by the Pi agent runtime.
- The client only renders `message_*`, `tool_execution_*`, and `plan_updated` events from the run stream.

### 2.2 End-to-end sequence diagram (user message)

```mermaid
sequenceDiagram
  participant User
  participant ToolBelt as ToolBelt UI
  participant ChatPage as ChatPage (client)
  participant Controller as Controller (/api/proxy)
  participant Agent as Pi agent runtime
  participant LLM as Inference (/v1)

  User->>ToolBelt: Type message / attach / record
  ToolBelt->>ChatPage: onSubmit(text, attachments)

  ChatPage->>Controller: create session if needed\nPOST /chats
  ChatPage->>Controller: POST /chats/:id/turn (SSE run)

  Controller->>Agent: start run (Pi agent core)
  Agent->>LLM: chat/completions

  Agent-->>Controller: message_*\n tool_execution_*\n plan_updated\n run_end
  Controller-->>ChatPage: SSE events (stream)

  ChatPage->>Controller: abort run (optional)
```

### 2.3 Agent Plan state machine

```mermaid
stateDiagram-v2
  [*] --> NoPlan

  NoPlan --> Planned: create_plan(tasks)
  Planned --> Executing: update_plan(step, running)
  Executing --> Planned: update_plan(step, done)\n(next step becomes current)

  Executing --> Blocked: update_plan(step, blocked)
  Blocked --> Planned: update_plan(next step, running)

  Planned --> Done: all steps done
  Done --> NoPlan: clearPlan()
```

Where it lives:
- Tool definitions + execution: controller `services/agent-runtime/tool-registry.ts` (out of scope).
- UI: `src/app/chat/_components/agent/agent-plan-drawer.tsx` + `chat-page.tsx` event handling.

### 2.4 Session lifecycle state machine

```mermaid
stateDiagram-v2
  [*] --> NoSession

  NoSession --> SessionSelected: URL has ?session=...\n(loadSession)
  NoSession --> PendingCreate: first user send\n(createSessionWithMessage)

  PendingCreate --> ActiveSession: controller returns session id

  SessionSelected --> LoadingMessages: controller returns stored messages
  LoadingMessages --> ActiveSession: ChatPage.setMessages(mapped)

  ActiveSession --> Forking: forkChatSession(messageId)
  Forking --> ActiveSession: navigate to /chat?session=newId

  ActiveSession --> NewSession: ?new=1 OR user starts new
  NewSession --> NoSession

  ActiveSession --> Deleted: deleteSession
  Deleted --> NoSession
```

### 2.5 Attachments lifecycle (UI)

```mermaid
stateDiagram-v2
  [*] --> Empty

  Empty --> Picking: user opens file/image picker
  Picking --> Selected: file(s) chosen\n(attachments[] in Zustand)

  Selected --> Selected: add more
  Selected --> Empty: remove last attachment

  Selected --> Submitting: user hits Send
  Submitting --> Empty: ToolBelt clears attachments

  note right of Selected
    Current send pipeline
    does NOT pass binary files
    to the model. It only adds
    text placeholders.
  end note
```

### 2.6 Voice recording + transcription lifecycle

```mermaid
stateDiagram-v2
  [*] --> Idle

  Idle --> Recording: startRecording()\n(MediaRecorder.start)
  Recording --> Stopping: stopRecording()
  Stopping --> Transcribing: POST /api/voice/transcribe

  Transcribing --> Idle: success\nappend transcript to input
  Transcribing --> Error: failure\nshow transcriptionError
  Error --> Idle: dismiss or timeout
```

### 2.7 Artifact lifecycle (extraction → preview → modal)

```mermaid
graph TD
  A["Assistant ChatMessage parts - type:text"] --> B["ChatPage: extractArtifacts"]
  B --> C["sessionArtifacts + artifactsByMessage Map"]

  C --> D["UnifiedSidebar: ArtifactPreviewPanel"]
  C --> E["ChatMessageItem: MiniArtifactCard chips"]

  E -->|"click"| F["Zustand: activeArtifactId"]
  F --> G["ArtifactModal"]
  G --> H["ArtifactViewer - iframe runner"]
```

### 2.8 Context compaction lifecycle (auto)

```mermaid
stateDiagram-v2
  [*] --> Normal

  Normal --> High: utilization >= threshold
  High --> Compacting: runAutoCompaction

  Compacting --> Normal: success - setMessages
  Compacting --> Normal: failure - compactionError
```

### 2.9 Intra-chat component graph (in-scope)

```mermaid
graph TD
  ChatRoutePage["page.tsx"] --> ChatPage["chat-page.tsx"]

  ChatPage --> useChatSessions["use-chat-sessions"]
  ChatPage --> useChatTools["use-chat-tools"]
  ChatPage --> useChatDerived["use-chat-derived"]
  ChatPage --> useChatUsage["use-chat-usage"]
  ChatPage --> useAgentFiles["use-agent-files"]
  ChatPage --> useAgentState["use-agent-state"]

  ChatPage --> UnifiedSidebar["unified-sidebar"]
  UnifiedSidebar --> ChatConversation["chat-conversation"]
  ChatConversation --> ChatMessageList["chat-message-list"]
  ChatMessageList --> ChatMessageItem["chat-message-item"]
  ChatMessageItem --> MessageRenderer["message-renderer"]
  MessageRenderer --> EnhancedCodeBlock["enhanced-code-block"]

  ChatPage --> ChatToolbeltDock["chat-toolbelt-dock"]
  ChatToolbeltDock --> ToolBelt["tool-belt"]
  ToolBelt --> ToolBeltToolbar["tool-belt-toolbar"]
  ToolBeltToolbar --> ToolDropdown["tool-dropdown"]
  ToolBeltToolbar --> AgentModeToggle["agent-mode-toggle"]

  ChatPage --> ChatModals["chat-modals"]
  ChatModals --> ChatSettingsModal["chat-settings-modal"]
  ChatModals --> MCPSettingsModal["mcp-settings-modal"]
  ChatModals --> UsageModal["usage-modal"]
  ChatModals --> ExportModal["export-modal"]

  ChatPage --> ArtifactModal["artifact-modal"]
  ArtifactModal --> ArtifactViewer["artifact-viewer"]

  UnifiedSidebar --> ArtifactPreviewPanel["artifact-preview-panel"]
  UnifiedSidebar --> ActivityPanel["ActivityPanel - from chat-side-panel"]
  UnifiedSidebar --> ContextPanel["ContextPanel - from chat-side-panel"]
  UnifiedSidebar --> AgentFilesPanel["agent-files-panel"]
  ToolBelt --> AgentPlanDrawer["agent-plan-drawer"]
```

---

## 3) Feature map (what’s implemented vs partial vs missing)

Legend:
- ✅ Implemented + integrated
- 🟡 Implemented but partial / missing wiring
- 🔴 Missing (UI stub or config only)

| Feature | Status | Primary files | Notes |
|---|---:|---|---|
| Basic chat with streaming | ✅ | `chat-page.tsx` | Uses controller run stream (`/chats/:id/turn`) via `api.streamChatRun`. |
| Session history (list/load/fork) | ✅ | `use-chat-sessions.ts`, `chat-page.tsx` | Uses controller `/chats`. Messages loaded into local state via `setMessages()`. |
| System prompt editing | ✅ | `chat-settings-modal.tsx`, `chat-page.tsx` | Stored in Zustand, sent in run payload to controller. |
| MCP tools execution | ✅ | `use-chat-tools.ts`, `chat-page.tsx` | Tools execute on the controller; UI renders `tool_execution_*` events. |
| Activity view (thinking + tools timeline) | ✅ | `use-chat-derived.ts`, `chat-side-panel.tsx` (ActivityPanel) | Groups by run (one user prompt), showing tool calls + thinking extraction. |
| Context stats + auto-compaction | ✅/🟡 | `chat-page.tsx` + `src/lib/services/context-management/*` | Auto-compaction is implemented and updates session/messages; heavy coupling in ChatPage. |
| Artifact extraction + preview UI | ✅/🟡 | `artifact-renderer.tsx` (extract), `artifact-preview-panel.tsx`, `artifact-modal.tsx`, `artifact-viewer.tsx` | Uses `extractArtifacts` + preview panel + modal viewer; legacy sandbox removed. |
| File attachments | 🟡 | `tool-belt.tsx` | UI supports adding files/images. **Sending to model is currently text placeholders** (not actual file parts). |
| Image attachments | 🟡 | `tool-belt.tsx` | Base64 is computed for images, but not passed to model in current send path. |
| Audio recording | 🟡 | `tool-belt.tsx`, `/api/voice/transcribe` (external) | Records audio, transcribes to text, appends to input. Not sent as audio part. |
| Deep Research | 🟡 | `chat-settings-modal.tsx`, `tool-belt-toolbar.tsx`, `chat-page.tsx` | Toggle is forwarded to the controller run (influences thinking level). |
| Agent Files / virtual filesystem | 🟡 | `agent-files-panel.tsx`, `use-agent-files.ts` | Wired to `/chats/:sessionId/files` via `use-agent-files`; panel lists the workspace tree but has no inline editor. |
| Agent planning tools (`create_plan`, `update_plan`) | ✅ | `agent-plan-drawer.tsx`, `chat-page.tsx`, `use-controller-events.ts` | Plan updates arrive from controller tools via run stream + SSE. |
| TTS | 🔴/🟡 | `tool-belt.tsx`, `tool-belt-toolbar.tsx`, store | Toggle exists; no speech synthesis in chat rendering here. |
| Queue next message while streaming | 🟡 | `tool-belt.tsx`, store `queuedContext` | UI supports entering `queuedContext` during streaming; no auto-submit logic found in this directory. |

---

## 4) State management model (Zustand)

**Important:** messages are NOT stored in Zustand.
- Messages live inside `chat-page.tsx` local state.
- Zustand stores UI state, sessions list/metadata, tool execution status, attachments, artifacts UI state, etc.

### 4.1 Zustand keys used directly by chat UI

Primary store file (external dependency): `src/store/chat-slice.ts`

Core keys used by ChatPage:
- Input: `input`, `setInput`
- Model: `selectedModel`, `availableModels`
- System prompt: `systemPrompt`
- Feature toggles: `mcpEnabled`, `artifactsEnabled`, `deepResearch`, `agentMode`
- Timing: `streamingStartTime`, `elapsedSeconds`
- Context queue: `queuedContext`
- Artifacts: `activeArtifactId`
- Session metadata: `currentSessionId`, `currentSessionTitle`, `sessions[]`
- Tool execution: `executingTools`, `toolResultsMap`
- Agent plan: `agentPlan`

### 4.2 Legacy state cleanup (done)

Legacy panel + artifact renderer keys were removed (`toolPanelOpen`, `activePanel`,
`artifactPanelSelectedId`, `artifactRendererState`, `codeSandboxState`) to align with `UnifiedSidebar`.

---

## 5) Directory inventory (every file)

### 5.1 In-scope file tree

```
src/app/chat/
  page.tsx
  types.ts
  utils/index.ts
  hooks/
    use-agent-files.ts
    use-agent-state.ts
    use-chat-derived.ts
    use-chat-sessions.ts
    use-chat-tools.ts
    use-chat-usage.ts
  _components/
    agent/
      agent-files-panel.tsx
      agent-mode-toggle.tsx
      agent-plan-drawer.tsx
      agent-types.ts
      index.ts
    artifacts/
      artifact-modal.tsx
      artifact-preview-panel.tsx
      artifact-renderer.tsx
      artifact-viewer.tsx
      mini-artifact-card.tsx
    code/
      enhanced-code-block.tsx
    input/
      attachments-preview.tsx
      recording-indicator.tsx
      tool-belt-toolbar.tsx
      tool-belt.tsx
      tool-dropdown.tsx
      transcription-status.tsx
    layout/
      chat-action-buttons.tsx
      chat-conversation.tsx
      chat-modals.tsx
      chat-page.tsx
      chat-side-panel.tsx
      chat-splash-canvas.tsx
      chat-toolbelt-dock.tsx
      chat-top-controls.tsx
      unified-sidebar.tsx
    messages/
      chat-message-item.tsx
      chat-message-list.tsx
      message-renderer.tsx
      typing-indicator.tsx
```

---

## 6) File-by-file documentation (with “status”)

### src/app/chat/page.tsx (✅ ACTIVE)

**Role:** `/chat` page entry. Uses dynamic import:
- `dynamic(() => import("./_components/layout/chat-page"), { ssr:false })`

**Why:** avoids SSR/hydration problems for browser-only APIs (media recorder, localStorage, SSE, etc).

---

### src/app/chat/types.ts (✅ ACTIVE)

**Role:** Shared UI-level types.

Key exports:
- `Attachment` (UI attachment object)
- `ModelOption` (for model dropdown)
- `ActivityItem`, `ActivityGroup`, `ThinkingState` (for activity panel)

---

### src/app/chat/utils/index.ts (✅ ACTIVE)

**Active exports used in chat:**
- `stripThinkingForModelContext(text)` → used in `chat-page.tsx` when building model context.
- `tryParseNestedJsonString(raw)` → used when loading stored tool calls in `chat-page.tsx`.

## 6.1 Hooks

### hooks/use-chat-sessions.ts (✅ ACTIVE)

**Role:** Session list + current session metadata manager.

- Uses controller API: `api.getChatSessions()`, `api.getChatSession(id)`.
- Stores sessions + selection in Zustand.
- **Does not** load messages into UI; `chat-page.tsx` calls `setMessages()` after fetching.

---

### hooks/use-chat-tools.ts (✅ ACTIVE)

**Role:** MCP tool discovery + execution.

- `loadMCPServers()` → controller `/mcp/servers`
- `loadMCPTools()` → controller `/mcp/tools` (or per-server tools)
- `getToolDefinitions()` → formats tool names as `${server}__${tool}`
- `executeTool({ toolCallId, toolName, args })` → controller `/mcp/tools/{server}/{tool}`

Tracks ephemeral UI state:
- `executingTools: Set<toolCallId>`
- `toolResultsMap: Map<toolCallId, ToolResult>`

---

### hooks/use-chat-derived.ts (✅ ACTIVE)

**Role:** Derived UI data:
- Thinking extraction (reasoning parts + `<think>` tags)
- Activity timeline groups (per assistant message)

Depends on:
- `thinkingParser` from `src/lib/services/message-parsing` (external)

---

### hooks/use-chat-usage.ts (✅ ACTIVE)

**Role:** Fetch + store session usage.

Calls controller:
- `api.getChatUsage(sessionId)`

---

## 6.2 Layout

### _components/layout/chat-page.tsx (✅ ACTIVE, very large)

**Role:** The orchestrator (“god component”).

Major responsibilities:
- Owns controller run stream lifecycle:
  - `api.streamChatRun()` for SSE
  - `handleRunEvent()` for `message_*`, `tool_execution_*`, `plan_updated`, `run_end`
- Loads sessions and restores messages (`setMessages(mapStoredMessages(...))`).
- Loads models list and stores in Zustand.
- Builds `effectiveSystemPrompt` (system + agent-mode block).
- Builds context stats + auto-compaction.
- Extracts artifacts from assistant messages.
- Renders full UI via `UnifiedSidebar` + `ChatConversation` + `ToolBelt` + modals.

Known architectural smells:
- Mixes UI rendering, persistence, model IO, compaction, artifact parsing, and sidebar behavior.

---

### _components/layout/unified-sidebar.tsx (✅ ACTIVE)

**Role:** Desktop-only right sidebar with resize.

Tabs:
- Activity
- Context
- Preview (artifacts)
- Files (agent mode)

Agent toggle exists here too.

---

### _components/layout/chat-conversation.tsx (✅ ACTIVE)

**Role:** Scroll container + empty-state splash + message list.

- Empty state shows splash canvas + tool belt on desktop.
- Non-empty state shows `ChatMessageList`.

---

### _components/layout/chat-toolbelt-dock.tsx (✅ ACTIVE)

**Role:** Places `ToolBelt` at bottom on mobile, inline on desktop.

---

### _components/layout/chat-top-controls.tsx (✅ ACTIVE)

**Role:** Mobile-only top-left menu + top-right settings buttons.

---

### _components/layout/chat-action-buttons.tsx (✅ ACTIVE)

**Role:** Desktop floating action buttons (open activity/context/settings/mcp/usage/export).

---

### _components/layout/chat-modals.tsx (✅ ACTIVE)

**Role:** Simple aggregator that renders modals:
- `ChatSettingsModal`
- `MCPSettingsModal`
- `UsageModal`
- `ExportModal`

---

### _components/layout/chat-splash-canvas.tsx (✅ ACTIVE but cosmetic)

**Role:** Decorative canvas animation for the empty chat state.

---

### _components/layout/chat-side-panel.tsx (✅ ACTIVE)

**Exports:**
- `ActivityPanel` (USED)
- `ContextPanel` (USED)

Legacy `ChatSidePanel` was removed after `UnifiedSidebar` adoption.

---

## 6.3 Input

### _components/input/tool-belt.tsx (✅ UI ACTIVE, 🟡 attachment sending partial)

**Role:** Main input component (textarea + attachments + recording + toolbar).

Implements:
- File/image attachment selection (stores `attachments[]` in Zustand)
- Image base64 conversion (currently unused by send pipeline)
- Voice recording (MediaRecorder) + transcription via `/api/voice/transcribe`
- “Queued context” UI while streaming
- Renders optional `planDrawer` header (agent mode)

**Important:** actual sending of binary attachments to the model is not implemented here; only stored.

---

### _components/input/tool-belt-toolbar.tsx (✅ ACTIVE)

**Role:** Buttons row: attachments dropdown, mic, tools, agent toggle, system prompt, model dropdown, send/stop.

**DeepResearch + TTS:** toggles exist but behavior is not implemented in this directory.

---

### _components/input/tool-dropdown.tsx (✅ ACTIVE)

**Role:** Generic dropdown used by toolbar.

---

### _components/input/attachments-preview.tsx (✅ ACTIVE)

**Role:** Displays selected attachments with remove button.

---

### _components/input/recording-indicator.tsx (✅ ACTIVE)

**Role:** “Recording…” pill + stop button.

---

### _components/input/transcription-status.tsx (✅ ACTIVE)

**Role:** “Transcribing…” status + errors.

---

## 6.4 Messages

### _components/messages/chat-message-list.tsx (✅ ACTIVE)

**Role:** Iterates `messages[]` and renders `ChatMessageItem`.

Also:
- Copy-to-clipboard handling
- Per-message markdown export

---

### _components/messages/chat-message-item.tsx (✅ ACTIVE)

**Role:** Renders one user/assistant message.

Key behaviors:
- Extracts text parts, tool parts, reasoning parts.
- Parses thinking tags via `thinkingParser`.
- Mobile inline “Reasoning” collapsible.
- Mobile inline tool list collapsible.
- Desktop tool-call summary line.
- Renders mini artifact chips that open `ArtifactModal`.

Note:
- Context token indicator opens the `UnifiedSidebar` context tab.

---

### _components/messages/message-renderer.tsx (✅ ACTIVE)

**Role:** Markdown + code block rendering.

Features:
- Uses `MessageParsingService` to split markdown/code segments.
- Renders code blocks with `EnhancedCodeBlock`.
- Renders Mermaid diagrams with dynamic `import("mermaid")` and sanitization.

---

### _components/messages/typing-indicator.tsx (✅ ACTIVE)

**Role:** Animated dots + streaming cursor.

---

## 6.5 Artifacts

### _components/artifacts/artifact-renderer.tsx (✅ ACTIVE — extraction only)

**Export used by ChatPage:**
- `extractArtifacts(content, options)`

Note: Artifact parsing also exists in `src/lib/services/message-parsing` (external) → duplication.

---

### _components/artifacts/artifact-preview-panel.tsx (✅ ACTIVE)

**Role:** Sidebar artifact preview (simple iframe).

Provides:
- Preview/Code tab
- Multiple artifacts navigation
- Play/pause (stop iframe)

---

### _components/artifacts/artifact-modal.tsx (✅ ACTIVE)

**Role:** Fullscreen modal wrapper around `ArtifactViewer`.

---

### _components/artifacts/artifact-viewer.tsx (✅ ACTIVE)

**Role:** Advanced artifact execution preview.

Supports:
- HTML / React / JS execution in iframe
- SVG rendering via iframe template
- Run/stop/refresh
- Copy/download/open in new tab
- Fullscreen + zoom/pan for modal view

Pairs with `ArtifactPreviewPanel` for a lightweight sidebar view and `ArtifactModal` for full preview.

---

### _components/artifacts/mini-artifact-card.tsx (✅ ACTIVE)

**Role:** Small pill button representing an artifact (used in message items).

---

## 6.6 Agent mode

### _components/agent/agent-plan-drawer.tsx (✅ ACTIVE)

**Role:** Collapsible plan checklist UI.

- Displays progress + current step.
- Clear button calls `clearPlan()`.

---

### _components/agent/agent-files-panel.tsx (🟡 PARTIAL)

**Role:** Agent workspace tree viewer.

- Receives `files: AgentFileEntry[]` from ChatPage (loaded via `use-agent-files`).
- Read-only UI: no open/edit flow; edits happen through tools + backend.

---

### _components/agent/agent-mode-toggle.tsx (✅ ACTIVE)

**Role:** Small toggle button used in toolbar.

---

### _components/agent/agent-types.ts (✅ ACTIVE)

Defines plan types + normalization.

---

### _components/agent/index.ts (✅ ACTIVE)

Barrel exports.

---

## 6.7 Code

### _components/code/enhanced-code-block.tsx (✅ ACTIVE)

**Role:** Syntax highlighting + copy + expand/collapse for long code.

---

## 6.8 Modals

### _components/modals/chat-settings-modal.tsx (✅ ACTIVE)

Edits:
- Selected model
- System prompt
- Deep research toggle (config only)

---

### _components/modals/mcp-settings-modal.tsx (✅ ACTIVE)

Manages MCP servers:
- Add server (uses `McpServerForm` external component)
- Enable/disable
- Remove

---

### _components/modals/usage-modal.tsx (✅ ACTIVE)

Displays session usage stats from controller.

---

### _components/modals/export-modal.tsx (✅ ACTIVE)

Exports whole chat (JSON/Markdown).

---

## 7) Dead/legacy/unintegrated code summary (actionable inventory)

### 7.1 Cleared

- Legacy side-panel + sandbox artifacts removed (Feb 2026 cleanup).

### 7.2 Remaining duplication

- Artifact extraction still exists in both `extractArtifacts()` and `MessageParsingService` (external).

### 7.3 Unintegrated feature toggles (UI exists, pipeline doesn’t change)

- TTS toggle (`isTTSEnabled`) does not change output rendering.

- Queued context (`queuedContext`) is writable while streaming but has no auto-send path in this directory.

- Agent file system: panel is wired to controller; no inline editor yet.

---

## 8) Suggested re-organization targets (no code changes here)

These are *organizational* recommendations to reduce confusion:

1) **Split `chat-page.tsx`** into hooks/modules:
   - `use-run-stream.ts` (send + SSE event handling)
   - `use-session-restore.ts` (URL params + loading + setMessages)
   - `use-artifacts.ts` (artifact extraction + modal selection)
   - `use-context-stats.ts` (token counting + compaction)

2) **Unify artifact preview components**
   - Today there are 2 experiences:
     - `ArtifactPreviewPanel` (sidebar simple iframe)
     - `ArtifactModal` + `ArtifactViewer` (full featured)

3) **Unify artifact extraction logic**
   - Artifact extraction exists twice:
     - `extractArtifacts()` (artifact-renderer.tsx)
     - `MessageParsingService` artifacts parser (external)

4) **Make attachments “real” or drop them**
   - Current send path uses text placeholders; it does not pass binary parts to the controller run.

---

## 9) Quick debugging checklist (chat-focused)

- If the model stops after tool calls:
  - Check controller logs for tool execution errors.
  - Confirm `tool_execution_end` events reach the client.
  - Ensure the run ends with `run_end` (not aborted).

- If session reload loses tool results:
  - Check controller persistence (`tool_calls[].result` + `chat_tool_executions`).

- If SSE stream stalls:
  - Verify `/chats/:id/turn` response headers and proxy setup.
  - Check `api.streamChatRun` parsing (event/data framing).

- If hydration errors occur:
  - Check for invalid HTML nesting (e.g., button inside button).

---

If you want, next step can be: generate a **“delete/merge plan”** as a concrete checklist that keeps the UI identical while reducing files and removing dead code.

---

## Codex Skills

- `skills/vllm-studio` — ops/deploy/env keys.
- `skills/vllm-studio-backend` — backend architecture + OpenAI compatibility.
