# Scope: Pi Agent Integration for vLLM Studio

> **Branch:** `scope/pi-agent-integration`
> **Date:** 2026-04-26
> **Goal:** Deeply integrate Pi coding agent capabilities into vLLM Studio's chat, transforming it from a model-chat interface into a full coding-agent platform with reliable, scalable, multi-week uptime.

---

## 1. Reference Architecture Overview

### 1.1 Pi Mono (`badlogic/pi-mono`) — Three-Layer Stack

```
┌─────────────────────────────────────────────────────┐
│  @mariozechner/pi-coding-agent                       │
│  (Coding agent: filesystem tools, sessions,          │
│   extensions, skills, modes, config, auth)           │
├─────────────────────────────────────────────────────┤
│  @mariozechner/pi-agent-core                         │
│  (Agent loop: events, tools, steering, follow-up,    │
│   message flow, parallel/sequential exec)            │
├─────────────────────────────────────────────────────┤
│  @mariozechner/pi-ai                                 │
│  (Unified LLM API: models, streaming, tokens, cost,  │
│   cross-provider handoff, OAuth, env-auth)           │
└─────────────────────────────────────────────────────┘
```

### 1.2 T3 Code (`pingdotgg/t3code`) — Web UI for Coding Agents

Two-stream architecture (shell + detail), TanStack Router, Zustand store. Sessions map to `OrchestrationSession` (provider, status, activeTurnId). Events drive UI via `applyOrchestrationEvent`. Composer input with file attachment, command palette, diff panel, terminal drawer, plan sidebar.

### 1.3 vLLM Studio (Current State)

Already has significant agent infrastructure:
- **Controller:** Pi agent core integration (`@mariozechner/pi-agent-core` v0.0.50), run manager, tool registries (agentFS/local/plan/circuit-breaker), SSE streaming, SQLite persistence, message mapping, compaction
- **Frontend:** Chat UI with message list, artifacts, agent files panel, computer viewport, tool belt, sidebar activity/turn groups, plan drawer
- **Infrastructure:** Controller runs natively (port 8080), frontend Next.js (port 3000), external vLLM/SGLang backends (port 8000)

---

## 2. What We Can Implement from Pi Packages

### 2.1 From `@mariozechner/pi-ai`

| Feature | Current State | Implementation |
|---|---|---|
| **Multi-provider model registry** | Hardcoded OpenAI-compatible models | Implement `ModelRegistry` class: discover all backends (vLLM, SGLang, proxy), build model list from `/v1/models`, add external API providers (Anthropic, OpenAI, Groq, etc.) |
| **Token & cost tracking** | Per-message `prompt_tokens`/`completion_tokens` in SQLite | Full `Usage` type with `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost` breakdown. Derive from actual LLM response metadata |
| **Cross-provider context conversion** | Not implemented | Transform message formats when switching between providers (thinking→text wrapping, tool call normalization). Essential for multi-backend routing |
| **OAuth credential management** | Not implemented | `AuthStorage` class for API key/OAuth token management, `login` flows for external providers |
| **Stream proxy pattern** | Client proxies through Next.js API routes | Full `streamProxy` implementation: browser → server → LLM, SSE event passthrough, auth management on server side, `partial` message reconstruction on client |
| **Compatibility field normalization** | Not implemented | `compat` field on models: max_tokens vs max_completion_tokens, thinking_format, cache_control, strict mode, role mapping (system/developer) |
| **Inline model discovery** | Static model lists | Auto-discovery from `getProviders()` → `getModels()`, refresh on backend changes |

### 2.2 From `@mariozechner/pi-agent-core`

| Feature | Current State | Implementation |
|---|---|---|
| **Agent event system** | ✅ Already integrated | Full event pipeline: agent_start → turns → messages → tool execution → agent_end |
| **Tool execution (parallel/sequential)** | ✅ Already integrated | `parallel` (default) and `sequential` modes, per-tool overrides |
| **Before/after tool hooks** | ✅ Already integrated | `beforeToolCall` (block validation), `afterToolCall` (result transformation) |
| **Tool execution streaming** | Partial | Implement `tool_execution_update` with `onUpdate` callback for progress reporting |
| **Steering queue** | Not implemented | `steer()` — inject messages mid-run while tools execute |
| **Follow-up queue** | Not implemented | `followUp()` — queue messages after agent stops (user types while waiting) |
| **`continue()` from existing context** | Not implemented | Resume agent from last state without new user message |
| **`transformContext` pruning** | Not implemented | Automatic message pruning/compaction before LLM conversion |
| **Custom agent message types** | Not implemented | `CustomAgentMessages` declaration merging for `notification`, `status`, etc. |
| **Stream proxy (browser → server)** | Partial | Full proxy pattern with `streamFn` → `streamProxy` → server-side API route |
| **Thinking budget management** | Not implemented | Per-level token budgets for reasoning models |

### 2.3 From `@mariozechner/pi-coding-agent`

| Feature | Current State | Implementation |
|---|---|---|
| **Filesystem tools** | ✅ Already implemented | `list_files`, `read_file`, `write_file`, `delete_file`, `make_directory`, `move_file` |
| **Shell execution tool** | ✅ Already implemented | `execute_command` with sudo support |
| **Browser/computer tools** | ✅ Already implemented | `computer_use`, `browser_open_url` |
| **Session branching/forking** | Not implemented | `/fork` to create session from checkpoint, `/clone` to duplicate active branch |
| **Session tree visualization** | Not implemented | `/tree` to navigate session history, parent_id tracking already in schema |
| **Skill system** | Not implemented | `SKILL.md` files in `.pi/skills/`, `/skill:name` invocation, auto-discovery |
| **Prompt templates** | Not implemented | Markdown templates with `{{variable}}` syntax, `/templatename` expansion |
| **Package/extension API** | Not implemented | Pi package manifest (`pi` key in package.json), `registerTool()`, `registerCommand()`, `pi.on()` events |
| **Theme system** | Not implemented | JSON theme files with hot-reload |
| **Configuration system** | Not implemented | Layered config: global → project → session, settings.json, models.json |
| **Modes (print/json/rpc)** | Not implemented | Non-interactive output modes for integration |
| **Compaction** | ✅ Already implemented | LLM-based context compaction, summarization, preservation of first/last |
| **Auth storage** | Not implemented | `AuthStorage.create()` for managing API keys and OAuth tokens across providers |
| **Command palette** | Not implemented | `/commands` for agent control, tools, and extensions |

---

## 3. Token Tracking: Data We Need in Session

### 3.1 Pi AI Data Model

```
Usage {
  input: number          // prompt tokens
  output: number         // completion tokens
  cacheRead: number      // cached input tokens read
  cacheWrite: number     // cached input tokens written
  totalTokens: number
  cost: {
    input: number        // cost in USD
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}
```

Per-message metadata already stored in SQLite `chat_messages`:
- `request_prompt_tokens`
- `request_tools_tokens`
- `request_total_input_tokens`
- `request_completion_tokens`

### 3.2 What We Need to Add

| Field | Source | Notes |
|---|---|---|
| `cache_read_tokens` | vLLM/SGLang response `usage` | Track prompt cache hits |
| `cache_write_tokens` | vLLM/SGLang response `usage` | Track prompt cache writes |
| `cost_breakdown` | Computed from model pricing | Input/output/cache per-million-token rates |
| `thinking_tokens` | Response `usage.completion_tokens_details.thinking_tokens` | Separate reasoning vs output tokens |
| `provider_model_id` | Request model | The actual model used (for cost calculation) |
| `session_accumulated_cost` | Sum over session messages | Real-time budget tracking |
| `streaming_usage_deltas` | Per-chunk usage from streaming | Real-time token reporting during generation |

### 3.3 How to Capture

1. **In the streaming proxy** – Parse `usage` from the final SSE chunk (vLLM includes it in the last delta)
2. **In `streamOpenAiCompletionsSafe`** – Extract from the raw API response before forwarding
3. **After run completion** – Aggregate per-turn usage from persisted messages
4. **On the frontend** – Display real-time via `chat_usage_updated` SSE events

### 3.4 Cost Model

Require a `model_pricing` table or config mapping model IDs to per-million-token costs:
```json
{
  "qwen/Qwen3.5-264B-A3B": {
    "input": 0.15,
    "output": 0.60,
    "cacheRead": 0.075,
    "cacheWrite": 0.15
  }
}
```

Prices default to `0` for unknown models. Cost ticks computed as:
```
cost.input = (input_tokens / 1_000_000) * pricing.input
cost.cacheRead = (cache_read_tokens / 1_000_000) * pricing.cacheRead
...etc
```

---

## 4. API Stability & Performance for Multi-Week Uptime

### 4.1 Stability Measures

| Concern | Mitigation |
|---|---|
| **Memory leaks** | Weekly controller restart (scheduled), active run timeout (30min max), message cap (2000 per thread) |
| **SQLite corruption** | WAL mode, regular `PRAGMA integrity_check`, automatic backup on schema migration |
| **Unresponsive LLM backend** | Tool circuit breaker (trip after N failures, auto-reset), streaming timeouts (30s silence → abort) |
| **SSE connection drops** | Keepalive every 15s, client auto-reconnect, grace timers for run_end |
| **OOM from long sessions** | Automatic compaction after N messages (configurable), message cap enforcement |
| **Run registry growth** | Evict finished runs from memory after 5min, persist to SQLite only |
| **File descriptor leaks** | Monitor open FDs, enforce per-session file limits |
| **Concurrent run conflicts** | `isSendingRef` + run registry guards, single-run-per-session enforcement |

### 4.2 Performance Targets

| Metric | Target | Measurement |
|---|---|---|
| First token latency | < 500ms (from submit to first stream event) | Server-side timing |
| SSE event throughput | Match model generation rate | No artificial throttling |
| Time to interactive (new session) | < 100ms | Load session metadata only, lazy-load messages |
| Message list render (1000 msgs) | < 200ms | Virtualized list |
| Compaction speed | < 30s for 500 messages | Benchmark on server GPU |
| Search load time | < 5s for 10k sessions | Indexed queries |
| Memory per active agent run | < 50MB | Track in process metrics |

### 4.3 Scalability Architecture

```
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Browser     │◄──►│  Controller   │◄──►│  vLLM/SGLang    │
│  (Next.js)   │SSE │  (Bun :8080) │API │  (Python :8000)  │
└─────────────┘    └──────┬───────┘    └──────────────────┘
                          │
                    ┌─────┴─────┐
                    │  SQLite    │
                    │  (persist) │
                    └───────────┘
```

- **No Redis/Prometheus dependency** — gracefully degrades without them
- **SQLite is the single store** — sessions, messages, runs, events, agent files, usage
- **SSE is the streaming transport** — no WebSocket complexity
- **Controller is stateful** — active runs in memory, everything else in SQLite
- **Scaling vertically** — 504GB RAM, 24 cores, adequate for single-user multi-week sessions

### 4.4 Monitoring for Uptime

| Signal | Collection |
|---|---|
| Active run count | `GET /metrics` (in-memory counter) |
| Run duration histogram | `runDurationsByRunId` |
| SSE keepalive gaps | `lastEventTimeRef` + idle timeout alerts |
| SQLite WAL size | Periodic check, force checkpoint at threshold |
| Process memory/RSS | `process.memoryUsage()` logged every 5min |
| Tool failure rate | Circuit breaker trip counter |
| Event queue backpressure | `RUN_EVENT_QUEUE_CAPACITY` (1024) overflow counter |

---

## 5. Agent & Coding Agent Deep Integration into Chat

### 5.1 Core Architecture Changes

Replace the current flat chat flow with the T3 Code-inspired two-tier architecture:

```
Current:
  [User Input] → [API Call (stream)] → [Message Append]

Target (T3 Code pattern):
  [User Input] → [Send Message] → [Run Manager] → [Agent Loop]
                                                    ├─ [Tool Execution]
                                                    ├─ [Stream Events]
                                                    └─ [Message Persist]
       ↓
  [Orchestration Events] → [Event Handler] → [State Store] → [React UI]
```

### 5.2 Frontend Architecture (T3 Code-Inspired)

#### 5.2.1 State Management

Adopt T3 Code's two-stream separation:
- **Shell stream** (lightweight): session list, titles, models, timestamps — updates all-threads sidebar
- **Detail stream** (per-thread): messages, activities, tool executions, proposed plans — updates active thread

Current Zustand store (`chat-slice.ts`) already has most shell-state. Need to add:
- `threadDerivation.ts` → `derivePhase()`, `deriveActiveWorkStartedAt()`, `deriveTimelineEntries()`
- `session-logic.ts` → active turn detection, pending approvals, plan state
- Sidebar summaries pre-computed server-side like T3 Code's `sidebarThreadSummaryById`

#### 5.2.2 Chat View Redesign (T3 Code Pattern)

```
┌────────────────────────────────────────────────────────┐
│  ┌────────┐  ┌─────────────────────────────────────┐   │
│  │Sidebar │  │  Messages/Activity                  │   │
│  │- History│  │                                     │   │
│  │- Files  │  │  [user message]                     │   │
│  │- Plan   │  │  [assistant response with tools]    │   │
│  │- Browser│  │  ├─ thinking block                 │   │
│  │- Activity│  │  ├─ tool calls + results           │   │
│  │         │  │  └─ text response                  │   │
│  │         │  │                                     │   │
│  │         │  │  [next turn...]                     │   │
│  └────────┘  │                                     │   │
│              │  ┌────────────────────────────────┐  │   │
│              │  │  Composer Input                │  │   │
│              │  │  [text] [@mentions] [attach]   │  │   │
│              │  └────────────────────────────────┘  │   │
└────────────────────────────────────────────────────────┘
```

Key components to implement from T3 Code:
1. **ComposerPromptEditor.tsx** — Rich text input with `@file` mentions, `/command` autocomplete, attachment preview, multi-line support
2. **ChatMarkdown.tsx** — Streaming markdown rendering with collapsible sections, code highlighting, inline diffs
3. **CommandPalette.tsx** — `/` commands (fork, clone, compact, settings, model picker)
4. **PlanSidebar.tsx** — Active plan visualization with step tracking
5. **DiffPanel.tsx** — File diff display for agent edits
6. **ThreadTerminalDrawer.tsx** — Terminal output viewer for shell commands

#### 5.2.3 Event-Driven UI Updates

Replace polling with SSE event bus (already partially in place):
- `handleRunEvent()` dispatches to `useRunMachine()` → state transitions
- Frontend subscribes to SSE per-run events
- Events drive all UI: messages, tool status, plan updates, usage

Need to add T3 Code event types:
- `thread.turn-start-requested` / `thread.turn-interrupt-requested`
- `thread.proposed-plan-upserted`
- `thread.turn-diff-completed` (checkpoint system)
- `approval.requested` / `approval.resolved` (command/file-change approvals)
- `user-input.requested` / `user-input.resolved`

### 5.3 Agent Mode Improvements

#### 5.3.1 Tool System Enhancements

| Tool | Status | Enhancement |
|---|---|---|
| `list_files` | ✅ Done | Add glob patterns, recursive limiting |
| `read_file` | ✅ Done | Add line range support, max size enforcement |
| `write_file` | ✅ Done | Add diff preview before write (file change approval) |
| `delete_file` | ✅ Done | Add trash/recycle option |
| `make_directory` | ✅ Done | — |
| `move_file` | ✅ Done | — |
| `execute_command` | ✅ Done | Add timeout control, working directory, env var passthrough, **command approval** UI |
| `computer_use` | ✅ Done | Add screenshot capture, click coordination |
| `browser_open_url` | ✅ Done | Add URL validation, content type detection |
| `grep` | ❌ Missing | Search file contents |
| `search` | ❌ Missing | Web search via external API |
| `task` | ❌ Missing | Background task management |

#### 5.3.2 Command Approval Flow (from T3 Code)

Add `approval.requested` / `approval.resolved` event types:
1. Agent calls `execute_command` → before execution, emit `approval.requested` with command details
2. Frontend shows approval dialog (allow/deny/always-allow)
3. On approval → emit `approval.resolved`, proceed with execution
4. On denial → tool returns error result, agent adjusts

#### 5.3.3 Plan System Improvements

Current plan system uses `create_plan` / `update_plan` tools. Enhance to T3 Code's `proposedPlan` pattern:
1. Agent proposes plan → `proposed-plan-upserted` event
2. Frontend renders plan as sidebar checklist
3. User can approve/modify/reject proposed plan via UI
4. On approval → `PlanApproved` event → agent executes steps
5. Step status tracked in real-time via `update_plan` events
6. Checkpoints created per completed turn for easy revert

### 5.4 Session Management & Forking

#### 5.4.1 Branching Model

Current session schema already has `parent_id`. Build on this:
- `/fork` at any message → new child session branching from that point
- Session tree view (T3 Code's `/tree`) showing parent → child → sibling relationships
- Forked sessions inherit parent's system prompt, model, and agent files
- Lazy-load: only load forked session messages on navigation

#### 5.4.2 Session Continuation

Add `continue()` support:
- If last message is assistant (with or without tool calls), `continue()` triggers another turn
- Agent re-reads context and continues generating
- Useful for "keep going" / "continue" patterns

### 5.5 Coding Agent Deep Integration

#### 5.5.1 Workspace Model

Replace current agent-files abstraction with Pi's workspace model:
- Workspace = project directory on the server
- `agent_files` = filesystem under workspace root
- Agent always sees relative paths within workspace
- User can configure workspace path per session
- Built-in `.gitignore`-style exclusion patterns

#### 5.5.2 Skill System

Implement Pi's SKILL.md format:
```
# Skill: test
---
description: Run tests for the current project
---

## Instructions
1. Find test files in the project
2. Run the test command
3. Report results
```

Discovery: `.pi/skills/`, `~/.pi/agent/skills/`
Invocation: `/skill:test` in chat input or agent prompt

#### 5.5.3 Extension API (future phase)

Pi's extension system with:
- `registerTool()` — add custom tools
- `registerCommand()` — add `/` commands
- `pi.on()` — lifecycle event hooks
- Custom UI components (status line, editors, etc.)

---

## 6. Implementation Phases

### Phase 1: Foundation (Current + 2 weeks)
- [ ] Full token tracking: cache tokens, thinking tokens, cost calculation
- [ ] Cross-provider context conversion (thinking→text wrapping)
- [ ] Stream proxy pattern for external API providers
- [ ] Command approval UI flow
- [ ] Agent session `continue()` support
- [ ] Steering/follow-up queues
- [ ] ComposerPromptEditor with `@file` mentions

### Phase 2: T3 Code UI Parity (2-4 weeks)
- [ ] Command palette with `/fork`, `/clone`, `/compact`, `/tree`
- [ ] Plan sidebar with step tracking and approval
- [ ] Diff panel for file changes
- [ ] Terminal drawer for command output
- [ ] Thread derivation (phase, timeline, work log)
- [ ] Proposed plan workflow (review/approve/deny)
- [ ] Session tree visualization
- [ ] Message virtual scrolling for large histories

### Phase 3: Coding Agent Depth (4-6 weeks)
- [ ] Skill system (SKILL.md discovery and invocation)
- [ ] `grep` and `search` tools
- [ ] Background task management
- [ ] Checkpoint system (turn-diff snapshots)
- [ ] External provider integration (OAuth, API keys)
- [ ] Compact-on-idle with configurable thresholds
- [ ] Cost tracking dashboard

### Phase 4: Platform Stability (6-8 weeks)
- [ ] Automatic weekly controller restart
- [ ] SQLite health monitoring + WAL management
- [ ] Long-session stress testing (10k+ messages)
- [ ] Memory leak detection and remediation
- [ ] Graceful degradation without external dependencies
- [ ] Performance benchmarking suite

### Phase 5: Extensions & Ecosystem (8-10 weeks)
- [ ] Pi package/extension API
- [ ] Theme system
- [ ] Prompt templates
- [ ] Modes (print, JSON, RPC)
- [ ] Custom provider registration

---

## 7. Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| State management | Zustand (current) + derivation layer | Already in use, T3 Code pattern adapts well |
| Routing | TanStack Router (future) | T3 Code uses it, better chat route params |
| Streaming | SSE (current) | No WebSocket complexity, works with proxy |
| Persistence | SQLite (current) | Single binary, no external DB needed |
| Agent loop | Pi agent-core (current) | Already integrated at v0.0.50 |
| UI framework | Next.js + Tailwind (current) | Already in use |
| Compaction | LLM-based (current) | Via inference client, configurable |
| Approval flow | SSE events + React dialog | Non-blocking, async |

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pi package version mismatch | Agent loop breaks | Pin versions, add integration tests |
| Long-running agent OOM | Controller crash | Active run timeout (30min), memory monitoring |
| SSE stream memory growth | Frontend slowdown | Event cap, cleanup old events, virtual scroll |
| SQLite WAL unbounded growth | Disk full | Auto-checkpoint at 100MB, periodic VACUUM |
| External API rate limits | Agent stalls | Backoff strategy, user notification, fallback |
| vLLM backend crash mid-session | Message loss | Persist every turn, auto-reconnect on next message |
