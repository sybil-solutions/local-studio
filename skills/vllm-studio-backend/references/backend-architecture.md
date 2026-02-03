# Backend Architecture Map

## Core Components
- **Controller (Bun + Hono)**: primary API server, runs on port 8080.
- **Inference backend**: vLLM/SGLang/TabbyAPI (default port 8000).
- **LiteLLM**: proxy/gateway on port 4100 for routing + cost tracking.
- **Postgres/Redis**: LiteLLM persistence + cache (docker services).

## Request Paths
- **Chat UI**: `/chats/:id/turn` -> `ChatRunManager` (Pi-mono agent runtime) -> inference/LiteLLM.
- **OpenAI-compatible API**: `/v1/chat/completions` -> `routes/proxy.ts` -> LiteLLM or direct inference.
- **Models**: `/v1/models` -> `routes/models.ts` -> inference + recipes.

## Pi-mono Runtime
- `controller/src/services/agent-runtime/run-manager.ts` owns agent loop.
- `tool-registry.ts` defines MCP + AgentFS + plan tools.
- Run events are persisted in `chat_run_events` and streamed as SSE.

## Storage
- `chat_sessions` stores `agent_state` (plan/files).
- `chat_messages` store `parts`, `tool_calls`, `metadata` (including runId/turnIndex).
- `chat_tool_executions` stores tool execution results by run.
