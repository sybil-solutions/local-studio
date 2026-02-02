<!-- CRITICAL -->
# vLLM Studio — Pi-Mono Migration + Cleanup Plan (Major Release Readiness)

## Summary (what we’re doing)
We will **move the agent loop to the controller (port 8080)** using **Pi-Mono primitives** (`@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`), then **migrate the existing `/chat` UI (no visual changes)** to consume a **controller-run SSE run stream** instead of AI SDK (`useChat`, Next `/api/chat`, and client-owned tool loop). We will simplify `/chat`, agents, AgentFS, and configuration handling, pay down the accumulated technical debt, and **resolve/close all open PRs**. We will **land to `main` early and often**, and finish with a deployment-ready, verifiably-green `main`.

## Non-negotiables / Constraints
- **Frontend UI must not change visually** (CSS/layout/spacing/typography must remain identical).
- **Agent loop ownership: controller-owned** (single loop for web+iOS long-term; web first in this plan).
- **Adopt Pi-Mono primitives** (Pi AI message/tool primitives + Pi agentic loop), and remove AI SDK logic.
- **Backend deploy happens on GPU server** (controller on `:8080`, frontend on `:3000`).
- Verification gates must follow `expected.md` (automated checks + manual checklist).
- Repo conventions from root `AGENTS.md` apply (Swift rules if Swift touched; frontend/controller checks if touched).

## Primary deliverables
1. Controller: **Pi agent runtime** endpoints + run-event SSE stream + persistence.
2. Frontend: `/chat` uses controller agent runtime stream (no Next `/api/chat`, no `useChat`, no client tool loop).
3. Agents/tools/files: consolidated tool definitions and execution in controller (MCP + AgentFS + plan tools).
4. Config: simplified, single-source-of-truth settings model.
5. PRs: all open PRs either merged (with verification) or closed (with reason).
6. Release readiness: `main` passes all checks in `expected.md`, deployment steps documented and repeatable.

---

## Phase 0 — Freeze, snapshot, and make `main` the source of truth (must be first)

### 0.1 Ensure a clean local baseline
**Goal:** stop accumulating untracked state; ensure we can merge to `main` safely.

Steps:
1. Record current local state:
   - `git status --porcelain`
   - `git log -n 20 --oneline --decorate`
2. If there are local-only commits or uncommitted changes:
   - Create a safety branch: `git switch -c backup/pre-cleanup-<date>`
   - Commit or stash everything so we can return to it later:
     - If work is coherent: commit with message `backup: snapshot before pi-mono migration`
     - If not: `git stash push -u -m "snapshot before pi-mono migration"`

Verification:
- `git status --porcelain` is empty on the branch you will use to land changes.

### 0.2 Normalize `main` against `origin/main`
**Goal:** `origin/main` is canonical and deployable.

Steps:
1. `git fetch origin`
2. `git switch main`
3. Choose canonical rule (default):
   - **Treat `origin/main` as canonical**.
4. If local `main` diverges:
   - Move local `main` ahead commits to a rescue branch:
     - `git branch rescue/local-main-<date> main`
   - Reset local `main` to `origin/main`:
     - `git reset --hard origin/main`

Verification:
- `git rev-parse main` equals `git rev-parse origin/main`.

### 0.3 Close/merge all GitHub PRs (before large refactors)
**Goal:** no PR backlog; either merged into `main` (green) or closed.

Steps (requires GitHub CLI):
1. List PRs:
   - `gh pr list --state open --limit 200`
2. For each PR, classify:
   - **Merge now** (small, green, on-topic, no UI changes)  
   - **Close** (superseded, stale, conflicts with Pi-mono migration direction)
   - **Convert to issue** (good idea but out-of-scope for “by morning”)
3. For PRs to merge:
   - Pull PR branch locally, run relevant checks (`expected.md` sections).
   - Merge **squash** into `main` to reduce history noise:
     - `gh pr merge <id> --squash --delete-branch`
4. For PRs to close:
   - Close with a short reason + pointer to this plan:
     - `gh pr close <id> --comment "Closing as part of Pi-Mono migration + controller-owned agent loop consolidation. Superseded by plan.md."`

Verification:
- `gh pr list --state open` returns empty (or only a single “tracking PR” if you insist on one).

### 0.4 Land a “pre-flight” commit to `main` immediately
**Goal:** satisfy “commit to main first” with a safe, verifiable commit that does not change UI.

Content of this commit (minimal, safe):
- Add `plan.md` (this file).
- Add/refresh documentation pointers if currently misleading (no code behavior changes).

Verification:
- No UI or runtime behavior changes.
- `git push origin main` succeeds.

---

## Phase 1 — Introduce controller-owned Pi agent runtime (Pi-Mono primitives)

### 1.1 Add Pi-Mono dependencies to controller
Files:
- `controller/package.json`

Add:
- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`

Notes:
- Controller runs on Bun; confirm these packages work under Bun ESM.

Verification:
- `cd controller && bun install`
- `cd controller && bun run typecheck`

### 1.2 Add run persistence schema + tool linkage fixes
We will implement the **recommended schema** already described in `docs/sessions.md`, and also fix the existing iOS linkage bug.

Changes:
1. In `controller/src/stores/chat-store.ts` migration:
   - Add tables:
     - `chat_runs`
     - `chat_run_events`
     - `chat_tool_executions`
   - Add columns to existing `chat_messages` (for compatibility + iOS):
     - `tool_call_id TEXT` (nullable)
     - `name TEXT` (nullable)
2. Update `controller/src/routes/chats.ts` to accept/store:
   - `tool_call_id`
   - `name`

Verification:
- New unit tests:
  - Insert a tool message with `tool_call_id` and read back identical.
  - Insert run events and verify ordering (`seq`) uniqueness.
- `cd controller && bun test`

### 1.3 Implement Pi agent runtime service (single canonical loop)
New module:
- `controller/src/services/pi-agent-runtime.ts` (or `controller/src/services/agent-runtime/pi-agent-runtime.ts`)

Responsibilities:
- Load session + stored messages from `ChatStore`.
- Project stored messages into Pi `Message[]` (pi-ai primitives):
  - user → `UserMessage`
  - assistant → `AssistantMessage` with `TextContent` + `ThinkingContent` + `ToolCall`
  - tool results are reconstructed from `assistant.tool_calls[].result` into `ToolResultMessage` inserted after the toolCall message in the in-memory context (not stored as separate chat row unless needed).
- Create `Agent` (`@mariozechner/pi-agent-core`) with:
  - `systemPrompt` resolved from session + request.
  - `model` resolved to an OpenAI-completions model pointed at **LiteLLM** (default) or directly to inference (optional flag).
  - `thinkingLevel` mapped from request.
  - `tools` built by a tool registry (below).
- Run one “turn” via `agent.prompt(...)`.
- Emit run events (SSE + persisted `chat_run_events`):
  - `run_start`, `agent_start`, `turn_start`
  - all `AgentEvent`s (`message_*`, `tool_execution_*`, `turn_end`, `agent_end`)
  - `run_end` (status + error if any)
- Persist final projection back into `ChatStore`:
  - user message row
  - assistant message row with:
    - `content` (text-only)
    - `parts` containing:
      - `{type:"text",text}`
      - `{type:"reasoning",text}` (from Pi thinking blocks)
      - tool parts matching existing UI conventions (`tool-<name>` / `dynamic-tool`)
    - `tool_calls` including results
    - `metadata.usage` + `metadata.model`

Verification:
- Controller tests cover:
  - “no tools” run
  - “tool call” run (stub tool) with persisted `tool_calls[].result`
  - aborted run behavior (see 1.5)

### 1.4 Implement controller-side tool registry (single source of tools)
New module:
- `controller/src/services/pi-tools.ts` (or `controller/src/services/agent-runtime/tools/*`)

Tool sets:
1. **MCP tools**
   - Discover enabled servers from `McpStore`.
   - For each tool from `tools/list`, create an `AgentTool`:
     - `name`: `${serverId}__${toolName}` (canonical)
     - `parameters`: use the MCP JSON schema object as-is (cast), to avoid lossy conversions
     - `execute`: calls `runMcpCommand(..., "tools/call", ...)`
     - Publishes controller `Event("mcp_tool_called", ...)` with `session_id` + `run_id` linkage.
2. **AgentFS tools** (controller executes directly)
   - Implement: `list_files`, `read_file`, `write_file`, `delete_file`, `make_directory`, `move_file`
   - Use `getAgentFs(context, sessionId)` and perform operations without routing back through HTTP.
3. **Plan tools**
   - Implement `create_plan` / `set_plan` / `update_plan` server-side.
   - Store plan in `chat_sessions.agent_state` (versioned):
     - `{ format: "vllm-studio-agent", schema: 1, plan: { tasks:[...] } }`
   - Emit SSE events like `plan_updated` so the UI can update instantly without reloading.
4. Keep tool execution bounded:
   - max tool rounds per turn (e.g., 20)
   - max wall clock per run (configurable)
   - max tool execution time per tool (configurable)

Verification:
- Controller unit tests for:
  - name canonicalization (`server__tool`)
  - AgentFS path normalization rejects traversal
  - Plan state persistence round-trip

### 1.5 Add run lifecycle endpoints (stream + abort)
New routes:
- `POST /chats/:sessionId/turn`
  - returns **SSE** stream of events for that run.
- `POST /chats/:sessionId/runs/:runId/abort`
  - aborts active run via AbortController in a `RunManager`.

Implementation details:
- Maintain `activeRuns: Map<runId, { abortController, sessionId }>` in controller memory.
- If the client disconnects, abort the run.

Verification:
- Manual:
  - Start a run, call abort endpoint, confirm stream ends with `run_end` status `aborted`.
- Automated:
  - controller test that abort flips state and closes stream.

---

## Phase 2 — Migrate frontend `/chat` logic to controller agent runtime (no visual changes)

### 2.1 Add an SSE client for run streams
New module:
- `frontend/src/lib/agent-runtime/sse.ts` (name can vary, must be kebab-case file name)

Requirements:
- Parse `text/event-stream` from `fetch("/api/proxy/chats/:id/turn")`.
- Deliver events to the chat UI reducer/store.

Verification:
- Unit test for SSE parsing with fixtures.

### 2.2 Replace AI SDK `useChat` with controller-run stream driver
Files to modify (primary):
- `frontend/src/app/chat/_components/layout/chat-page.tsx`
- `frontend/src/app/chat/hooks/use-chat-transport.ts` (either delete or repurpose)
- `frontend/src/lib/api.ts` (add `streamChatTurn` helper)

Implementation approach (keeps UI components intact):
- Keep `UIMessage[]` as the UI rendering model for now.
- Create a mapping layer:
  - Controller `message_*` + `tool_execution_*` → update `UIMessage.parts` exactly as today.
  - Pi “thinking” → UIMessage `{type:"reasoning",text}` (so `chat-message-item.tsx` renders it).
  - Tool calls/results → tool parts (so tool cards render exactly the same).
- Remove:
  - `useChat(...)`
  - `DefaultChatTransport`
  - client-side `onToolCall` execution loop
  - post-tool persistence effects
- Replace with:
  - `startTurn(sessionId, text, settings)` that:
    1) optimistically appends user message to UI
    2) opens SSE stream from controller
    3) updates streaming assistant message + tool cards as events arrive
    4) ends by reloading session from controller (or trusting projection) to ensure durable sync

Verification:
- Manual smoke:
  - Create session
  - Send message
  - Tools execute (when enabled)
  - Refresh page: history persists, tool outputs remain visible
- Automated:
  - `cd frontend && npm test`
  - `cd frontend && npm run test:integration`

### 2.3 Remove legacy Next `/api/chat`
Files:
- `frontend/src/app/api/chat/route.ts`

Action:
- Delete the route (or make it return 404).
- Update any references so nothing calls it.

Verification:
- `GET /api/chat` returns 404 in dev/prod.
- No runtime errors in `/chat`.

### 2.4 Maintain “no visual change” guarantee
Add a hard gate:
1. **Before changes**, capture Playwright screenshots of:
   - `/` dashboard
   - `/chat` empty state
   - `/chat` with a seeded conversation
   - `/configs`, `/usage`, `/discover`, `/setup`
2. **After changes**, rerun and require pixel-identical output.

Verification:
- `cd frontend && npm run test:integration` includes screenshot assertions (or an equivalent diff-based check).
- If screenshots differ, treat as a release blocker.

---

## Phase 3 — Simplify agents, filesystem, and configuration

### 3.1 Agents: make the controller the only executor
Actions:
- Remove browser-local implementations of:
  - plan tool execution
  - AgentFS tool execution
  - MCP tool execution
- Browser becomes:
  - renderer + input sender
  - run stream consumer
  - settings UI only

Verification:
- Search-based:
  - `rg "useChat\\(|streamText\\(|addToolOutput\\(|onToolCall" frontend/src/app/chat` returns no runtime references.
- Behavioral:
  - tools still work end-to-end via controller runtime.

### 3.2 Filesystem: consolidate around AgentFS in controller
Actions:
- Ensure all file ops happen via:
  - controller `getAgentFs(...)`
  - controller-run tools
- Frontend file panel only reads state via controller APIs and/or run events.

Verification:
- `expected.md` manual: Agent files panel still lists/reads/writes files without breaking sessions.

### 3.3 Configuration: single source of truth
Goal:
- Eliminate split-brain config between frontend settings + controller config.

Actions:
- Define one canonical “connection settings” model:
  - controller URL
  - LiteLLM URL (internal)
  - inference URL (internal)
  - auth (API key)
- Keep frontend `api-settings.json` as UI-level convenience, but controller owns operational truth.

Verification:
- Fresh browser profile + configured backend URL works.
- No duplicated env var precedence bugs.

---

## Phase 4 — Remove duplicated parsing and AI-SDK-era slop

### 4.1 Deprecate/remove controller proxy stream rewrite (where safe)
Goal:
- Pi-AI provider already handles streaming + tool calls + reasoning.

Actions:
- For the new agent runtime, call Pi-AI providers directly against LiteLLM/inference.
- Gradually reduce reliance on:
  - `controller/src/services/proxy-streamer.ts`
  - `controller/src/services/proxy-parsers.ts`
  - `config/tool_call_handler.py` parsing logic

Verification:
- Tool calls still work for the models you care about (GLM, DeepSeek, MiniMax, etc.).
- No regressions in `/v1/chat/completions` for existing clients until you intentionally cut them over.

---

## Phase 5 — Repo cleanliness + “one month of debt” cleanup

### 5.1 Documentation correctness
Fix drift so new contributors don’t get misled:
- Root `README.md` must match reality (Bun controller, Next frontend, Docker services).
- If Python packaging is no longer real, explicitly deprecate/remove `pyproject.toml` and related claims OR implement a minimal wrapper that actually starts the Bun controller.

Verification:
- “Quick Start” from a clean machine is accurate (at least internally).

### 5.2 Code quality gates (run exactly as `expected.md` requires)
Frontend:
- `cd frontend && npm run check && npm run lint && npm run build && npm test && npm run test:integration`

Controller (if changed):
- `cd controller && bun run typecheck && bun test && bun run check`

Swift (only if changed):
- `cd swift-client && ./setup.sh && xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio -destination 'platform=iOS Simulator,name=iPhone 15' clean build`

Verification:
- All exit codes are 0, warnings documented.

---

## Phase 6 — Deployment (GPU server) + smoke tests

> Note: I can’t reach `<your-server-ip>` from this environment, so these steps must be executed on your network.

On the server:
1. SSH:
   - `ssh -i ~/.ssh/linux-ai ser@<your-server-ip>`
2. Pull latest `main` in your prod directory:
   - `cd /workspace/projects/lmvllm`
   - `git fetch origin && git checkout main && git pull --ff-only`
3. Backend services:
   - `docker compose up -d postgres redis litellm temporal prometheus`
4. Controller restart (choose the one your server uses; standardize after):
   - If systemd: `sudo systemctl restart vllm-studio`
   - If tmux: restart the running session
   - If manual: `./start.sh --port 8080`
5. Frontend rebuild/restart:
   - `docker compose up -d --build frontend` (if frontend containerized)
   - or `cd frontend && npm run build && PORT=3000 npm run start`

Smoke checks (server):
- `curl -sSf http://localhost:8080/health`
- `curl -sSf http://localhost:3000/`
- Open `/chat`, send a message, verify streaming + persistence.

Rollback plan:
- If any critical issue:
  - `git reset --hard <previous-good-sha>`
  - restart controller + frontend
  - keep DB files intact (no destructive migration without backups)

---

## Ralph Wiggum execution loop (how we iterate safely overnight)
We will use Ralph-style state files to keep context clean and ensure verifiable progress:

Create and maintain:
- `.ralph/state.md`:
  - current iteration number
  - current “one task”
  - completion criteria for that task
- `.ralph/progress.md`: append-only notes per iteration
- `.ralph/guardrails.md`: “signs” discovered during failures
- `.ralph/failures.md`: repeated failure patterns

Iteration protocol (repeat until done):
1. Pick **one** vertical slice task (e.g., “controller `/turn` streams message deltas”).
2. Implement + add tests.
3. Run the smallest relevant verification commands.
4. Commit checkpoint to `main` (small, reversible).
5. If a mistake happens, add a guardrail entry immediately.

---

## Acceptance criteria (definition of done for “ready for major release”)
- `expected.md` full automated checklist passes.
- Manual QA checklist passes, especially:
  - `/chat` unchanged visually
  - sessions persist and reload correctly
  - tool calls + tool results persist and render correctly after refresh
  - configs/usage/discover/setup pages still render without runtime errors
- No open PRs remaining.
- Production deploy on GPU server is running:
  - controller `:8080` healthy
  - frontend `:3000` healthy
- A short `CHANGELOG.md` entry documents the major change (Pi-Mono migration + controller-owned agent loop).
