# AGENTS.md

Comprehensive module mapping, state machines, and architectural patterns for vLLM Studio.

## Module Dependency Graph

```
                              ┌─────────────┐
                              │   cli.py    │
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │   app.py    │ ◄── Entry point, lifespan
                              └──────┬──────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│   config.py   │           │   events.py   │           │   store.py    │
│   Settings    │           │ EventManager  │           │  *Store       │
└───────────────┘           └───────────────┘           └───────────────┘
        │                            │                            │
        │                            │                            │
        ▼                            ▼                            ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│  models.py    │           │  routes/*     │◄──────────│  models.py    │
│ Recipe, MCP   │◄──────────│  API handlers │           │ Pydantic      │
└───────────────┘           └───────┬───────┘           └───────────────┘
        │                           │
        │                           │
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│ backends.py   │◄──────────│  process.py   │
│ Cmd builders  │           │ Launch/Evict  │
└───────────────┘           └───────────────┘
                                    │
                                    ▼
                            ┌───────────────┐
                            │   gpu.py      │
                            │ GPU detection │
                            └───────────────┘
```

## State Machines

### 1. Model Launch State Machine

```
                    ┌─────────────────┐
                    │      IDLE       │
                    └────────┬────────┘
                             │ POST /launch/{recipe_id}
                             ▼
                    ┌─────────────────┐
             ┌──────│  CHECK_LOCK     │──────┐
             │      └─────────────────┘      │
             │ locked                        │ available
             ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ WAIT_LOCK (2s)  │────────────▶│  ACQUIRE_LOCK   │
    └────────┬────────┘ timeout     └────────┬────────┘
             │ preempt                       │
             ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ CANCEL_OTHER    │             │   EVICTING      │ ◄── Progress: 0%
    └────────┬────────┘             └────────┬────────┘
             │                               │ kill process, wait 1s
             └──────────────┬────────────────┘
                            ▼
                   ┌─────────────────┐
                   │  CHECK_CANCEL   │──────────────┐
                   └────────┬────────┘              │ cancelled
                            │ continue              ▼
                            ▼                ┌─────────────┐
                   ┌─────────────────┐       │ CANCELLED   │
                   │   LAUNCHING     │ ◄──   └─────────────┘
                   │  Progress: 25%  │
                   └────────┬────────┘
                            │ subprocess.Popen, wait 3s
                            ▼
                   ┌─────────────────┐
                   │ CHECK_STABILITY │
                   └────────┬────────┘
                            │
             ┌──────────────┴──────────────┐
             │ crashed                     │ stable
             ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │  READ_LOGS      │           │    WAITING      │ ◄── Progress: 50%
    └────────┬────────┘           └────────┬────────┘
             │                             │ poll /health (300s timeout)
             ▼                             │
    ┌─────────────────┐           ┌────────┴────────┐
    │     ERROR       │           │                 │
    └─────────────────┘           ▼                 ▼
                         ┌─────────────┐   ┌─────────────────┐
                         │   READY     │   │    TIMEOUT      │
                         │ Progress:   │   └─────────────────┘
                         │   100%      │
                         └─────────────┘
```

**Events emitted:**
- `launch_progress` at each state transition (0%, 25%, 50%, 100%)
- `status` when model becomes ready
- `error` on failure

### 2. Chat Message Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Input ──▶ buildAPIMessages() ──▶ getOpenAITools()        │
│       │                                       │                 │
│       ▼                                       ▼                 │
│  ┌─────────────────────────────────────────────────┐           │
│  │              POST /api/chat                     │           │
│  │  { messages, model, tools }                     │           │
│  └───────────────────────┬─────────────────────────┘           │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTE                            │
├─────────────────────────────────────────────────────────────────┤
│  /api/chat/route.ts                                            │
│       │                                                         │
│       ▼                                                         │
│  Stream to LiteLLM:4100/v1/chat/completions                    │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LITELLM (4100)                             │
├─────────────────────────────────────────────────────────────────┤
│  config/litellm.yaml routing                                   │
│       │                                                         │
│       ├──▶ GLM models      ──▶ vLLM with glm45 parser          │
│       ├──▶ MiniMax models  ──▶ vLLM with minimax parser        │
│       ├──▶ INTELLECT-3     ──▶ vLLM with hermes parser         │
│       └──▶ * (wildcard)    ──▶ vLLM default                    │
│                                                                 │
│  Callbacks:                                                     │
│    - tool_call_handler (MCP processing)                        │
│    - prometheus_callback (metrics)                             │
│    - spend_logs (PostgreSQL)                                   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    vLLM/SGLang (8000)                          │
├─────────────────────────────────────────────────────────────────┤
│  Inference with:                                               │
│    - Tool call parsing (function calling)                      │
│    - Reasoning token extraction                                │
│    - Streaming response                                        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼ SSE Stream
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND                                   │
├─────────────────────────────────────────────────────────────────┤
│  parseSSEEvents() processes:                                   │
│    │                                                            │
│    ├──▶ type: "text"       ──▶ Append to message content       │
│    ├──▶ type: "tool_calls" ──▶ Display in ToolBelt             │
│    ├──▶ type: "thinking"   ──▶ Show in thinking modal          │
│    └──▶ type: "error"      ──▶ Display error                   │
│                                                                 │
│  If tool_calls present:                                        │
│    └──▶ executeMCPTool() ──▶ Loop back with tool results       │
│                                                                 │
│  Save to ChatStore via POST /chats/{id}/messages               │
└─────────────────────────────────────────────────────────────────┘
```

### 3. MCP Tool Execution Flow

```
┌─────────────────┐
│  Model Request  │
│  tool_call:     │
│  {              │
│   name: "exa__  │
│    web_search"  │
│   arguments:{}  │
│  }              │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Parse Tool Name │
│ server = "exa"  │
│ tool = "web_    │
│        search"  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     POST /mcp/tools/{server}/{tool}
│  API Request    │────────────────────────────────────▶
└─────────────────┘
                                                        │
                        ┌───────────────────────────────┘
                        │
                        ▼
               ┌─────────────────┐
               │  Controller     │
               │  routes/mcp.py  │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │  Load MCPServer │
               │  from MCPStore  │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────────────────────────────┐
               │           _run_mcp_command()            │
               ├─────────────────────────────────────────┤
               │                                         │
               │  1. spawn subprocess (node/npx)         │
               │     stdin=PIPE, stdout=PIPE             │
               │                                         │
               │  2. Initialize (JSON-RPC 2.0):          │
               │     ──▶ {"method": "initialize",        │
               │          "params": {                    │
               │            "protocolVersion":           │
               │              "2024-11-05"}}             │
               │     ◀── {"result": {serverInfo}}        │
               │                                         │
               │  3. Send initialized notification:      │
               │     ──▶ {"method":                      │
               │          "notifications/initialized"}   │
               │                                         │
               │  4. Call tool:                          │
               │     ──▶ {"method": "tools/call",        │
               │          "params": {                    │
               │            "name": "web_search",        │
               │            "arguments": {...}}}         │
               │     ◀── {"result": {content: [...]}}    │
               │                                         │
               │  5. Terminate subprocess                │
               └────────┬────────────────────────────────┘
                        │
                        ▼
               ┌─────────────────┐
               │  Return Result  │
               │  to Frontend    │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │  Add to Message │
               │  tool_results[] │
               └────────┬────────┘
                        │
                        ▼
               ┌─────────────────┐
               │ Resubmit to LLM │
               │ with results    │
               └─────────────────┘
```

### 4. SSE Event Broadcasting

```
┌─────────────────────────────────────────────────────────────────┐
│                    BACKGROUND TASK                              │
│               _collect_and_broadcast_metrics()                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Every 5 seconds:                                               │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │find_inference│    │  get_gpus()  │    │scrape vLLM   │      │
│  │  _process()  │    │              │    │  /metrics    │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └───────────────────┴───────────────────┘               │
│                             │                                   │
│                             ▼                                   │
│                   ┌──────────────────┐                          │
│                   │ Calculate rates  │                          │
│                   │ Update lifetime  │                          │
│                   │ Update peak      │                          │
│                   └────────┬─────────┘                          │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EVENT MANAGER                              │
│                       events.py                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Channels:                                                      │
│    "default"           ──▶ status, gpu, metrics events          │
│    "logs:{session_id}" ──▶ log line events                      │
│                                                                 │
│  ┌─────────────────┐                                            │
│  │   publish()     │                                            │
│  └────────┬────────┘                                            │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────┐                    │
│  │         For each subscriber:            │                    │
│  │                                         │                    │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐│                    │
│  │  │ Queue 1  │  │ Queue 2  │  │Queue N ││                    │
│  │  │(max 100) │  │(max 100) │  │        ││                    │
│  │  └──────────┘  └──────────┘  └────────┘│                    │
│  │                                         │                    │
│  │  If queue full: drop oldest event       │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND                                   │
│                     useSSE.ts                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EventSource connection to /events                             │
│                                                                 │
│  onmessage:                                                     │
│    │                                                            │
│    ├──▶ event.type = "status"                                  │
│    │    └── Update running model, inference_ready              │
│    │                                                            │
│    ├──▶ event.type = "gpu"                                     │
│    │    └── Update GPU cards display                           │
│    │                                                            │
│    ├──▶ event.type = "metrics"                                 │
│    │    └── Update throughput, cache, energy stats             │
│    │                                                            │
│    ├──▶ event.type = "launch_progress"                         │
│    │    └── Update progress bar (0-100%)                       │
│    │                                                            │
│    └──▶ event.type = "log"                                     │
│         └── Append to log viewer                               │
│                                                                 │
│  Reconnection: exponential backoff (1s, 2s, 4s, 8s, 16s)       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Module Reference

### Controller Core

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `app.py` | FastAPI app, lifespan, singletons | `lifespan()`, `get_*_store()` |
| `config.py` | Settings with env vars | `Settings` class |
| `models.py` | Pydantic data models | `Recipe`, `MCPServer`, `ProcessInfo` |
| `backends.py` | Build vLLM/SGLang commands | `build_vllm_command()`, `build_sglang_command()` |
| `process.py` | Process management | `find_inference_process()`, `launch_model()`, `evict_model()` |
| `store.py` | SQLite persistence | `RecipeStore`, `ChatStore`, `MCPStore`, `PeakMetricsStore` |
| `events.py` | SSE broadcasting | `EventManager.publish()`, `subscribe()` |
| `thinking_config.py` | Reasoning tokens | `calculate_thinking_tokens()` |
| `metrics.py` | Prometheus export | Counters, Gauges, Histograms |
| `gpu.py` | GPU info | `get_gpu_list()` |

### Routes

| Route File | Endpoints | Purpose |
|------------|-----------|---------|
| `system.py` | `/health`, `/status`, `/gpus`, `/config` | System info & health |
| `lifecycle.py` | `/recipes/*`, `/launch/*`, `/evict` | Model lifecycle |
| `models.py` | `/v1/models`, `/v1/studio/models` | OpenAI compatibility |
| `chats.py` | `/chats/*` | Chat session CRUD |
| `logs.py` | `/logs/*`, `/events` | Logs & SSE stream |
| `monitoring.py` | `/metrics`, `/peak-metrics` | Prometheus & benchmarks |
| `usage.py` | `/usage` | Analytics dashboard |
| `proxy.py` | Chat completions proxy | Auto-model-switching |
| `mcp.py` | `/mcp/*` | MCP server & tool management |

### Frontend

| Module | Purpose |
|--------|---------|
| `lib/api.ts` | APIClient with retry logic |
| `lib/types.ts` | TypeScript interfaces |
| `hooks/useSSE.ts` | SSE connection with reconnection |
| `hooks/useContextManager.ts` | Token tracking & compaction |
| `app/chat/page.tsx` | Main chat interface |
| `app/chat/utils/index.ts` | SSE parsing, helpers |
| `components/chat/*` | Chat UI components |

## Configuration Reference

### LiteLLM (`config/litellm.yaml`)

```yaml
model_list:
  - model_name: "model-alias"
    litellm_params:
      model: "openai/model-id"
      api_base: "http://localhost:8000/v1"

litellm_settings:
  callbacks:
    - tool_call_handler  # MCP integration
    - prometheus_callback
  cache: true
  cache_params:
    type: "redis"
    ttl: 3600
```

### Database Seeding

On first run, `MCPStore._migrate()` seeds:
- **Exa Search** server (if `exa-mcp-server` is installed globally)
  - Falls back to `npx -y exa-mcp-server` if not found
  - Requires `EXA_API_KEY` environment variable

## Error Handling Patterns

### Launch Failure Recovery
1. Check process crashed → Read last 100 lines of log
2. Timeout waiting for ready → Report timeout with log path
3. Lock contention → Preempt existing launch after 2s

### SSE Reconnection
1. Connection lost → Exponential backoff retry
2. Max reconnects reached → Show reconnect button
3. Server restart → Auto-reconnect on next event

### MCP Tool Errors
1. Server not found → Return 404 with server ID
2. Tool execution timeout → 30s timeout, return error
3. JSON-RPC error → Extract message, return to model
