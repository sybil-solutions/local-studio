# vLLM Studio Architecture

A comprehensive guide to the system architecture, components, data flows, and integration patterns.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Backend Components](#backend-components)
4. [Frontend Components](#frontend-components)
5. [Infrastructure Layer](#infrastructure-layer)
6. [Data Flows](#data-flows)
7. [State Management](#state-management)
8. [API Endpoints](#api-endpoints)
9. [Configuration Management](#configuration-management)
10. [Extension Points](#extension-points)

---

## System Overview

vLLM Studio is a model lifecycle management system that provides a web interface for managing, launching, and interacting with LLM inference servers (vLLM, SGLang, Transformers).

### Core Responsibilities

- **Model Lifecycle**: Launch, monitor, switch, and evict inference backends
- **Chat Interface**: Persistent chat sessions with streaming responses, tool calls, and multi-modal support
- **Metrics & Observability**: Real-time GPU metrics, token counting, energy tracking, and performance benchmarks
- **API Gateway**: LiteLLM proxy for routing, format translation, and cost tracking
- **State Management**: SQLite-based persistence for recipes, chats, and metrics

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, Lucide Icons |
| Backend | Python 3.11, FastAPI, Pydantic, SQLite |
| Inference | vLLM, SGLang, Transformers |
| API Gateway | LiteLLM (Docker) |
| Database | PostgreSQL 16 (LiteLLM), SQLite (Controller) |
| Caching | Redis 7 |
| Monitoring | Prometheus, Grafana |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser / Client                               │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP/WS
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend (4100)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Dashboard  │  │     Chat     │  │   Recipes    │  │    Usage     │   │
│  │   /          │  │   /chat      │  │   /recipes   │  │   /usage     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ /api/proxy/*
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LiteLLM API Gateway (4100)                             │
│  • Request routing & format translation                                     │
│  • Tool call parsing & think tag extraction                                 │
│  • Response caching (Redis)                                                 │
│  • Metrics collection (Prometheus)                                          │
└───────────────┬─────────────────────────────────────┬───────────────────────┘
                │                                     │
                ▼                                     ▼
┌───────────────────────────────┐    ┌───────────────────────────────────────┐
│  Controller Backend (8080)    │    │   PostgreSQL + Redis                  │
│  ┌─────────────────────────┐  │    │   • LiteLLM state                     │
│  │   FastAPI App           │  │    │   • Cache & rate limiting             │
│  │   • Model lifecycle     │  │    └───────────────────────────────────────┘
│  │   • Chat sessions       │  │
│  │   • Metrics & SSE       │  │
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │   SQLite Databases      │  │
│  │   • recipes.db          │  │
│  │   • chats.db            │  │
│  │   • metrics.db          │  │
│  │   • lifetime.db         │  │
│  └─────────────────────────┘  │
└───────────┬───────────────────┘
            │ health checks, commands
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Inference Backend (8000)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐                              │
│  │   vLLM   │  │ SGLang   │  │ Transformers │                              │
│  └──────────┘  └──────────┘  └──────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Backend Components

### 1. Controller (`controller/app.py`)

The central FastAPI application that orchestrates all backend operations.

#### Global State

```python
_store: RecipeStore              # Model recipes
_chat_store: ChatStore           # Chat sessions & messages
_peak_metrics_store: PeakMetricsStore    # Peak performance per model
_lifetime_metrics_store: LifetimeMetricsStore  # Cumulative metrics
_switch_lock: asyncio.Lock       # Prevents concurrent model switches
_broadcast_task: asyncio.Task    # SSE metrics broadcasting
_watchdog_task: asyncio.Task     # Backend health monitoring
_last_launched_recipe_id: str    # Auto-restart tracking
_current_launch_cancelled: asyncio.Event  # Launch cancellation
```

#### Key Responsibilities

- **Health Monitoring**: Periodic backend health checks via SSE
- **Model Switching**: Launch/evict models with preemption support
- **Chat Management**: Create, list, fork, delete chat sessions
- **Token Tracking**: Per-session and lifetime token counting
- **Metrics Broadcasting**: Real-time SSE stream of GPU/metrics to frontend
- **OpenAI Compatibility**: Proxy `/v1/*` endpoints to inference backend

#### Startup & Shutdown

```python
@app.on_event("startup")
async def startup():
    # Initialize stores, start metrics broadcast, start watchdog
    # Load MCP servers, restore last model if configured

@app.on_event("shutdown")
async def shutdown():
    # Cancel background tasks, close connections
```

#### SSE Event Broadcasting

The controller broadcasts real-time events to connected clients:

```python
async def broadcast_metrics():
    while True:
        data = {
            "status": "running",
            "process": process_info,
            "gpus": gpu_info,
            "metrics": vllm_metrics,
        }
        await event_manager.broadcast(Event(data))
```

Events include:
- Status changes (idle → launching → running)
- GPU metrics (utilization, memory, temperature, power)
- vLLM metrics (tokens/second, cache hit rates)
- Launch progress updates

### 2. Models (`controller/models.py`)

Pydantic models for type-safe data validation.

#### Core Models

```python
class Recipe(BaseModel):
    """Model launch configuration - defines HOW to launch a model."""
    id: str                          # Unique identifier
    name: str                        # Display name
    model_path: str                  # Path to model weights
    backend: Backend                 # vllm | sglang | transformers
    tensor_parallel_size: int        # TP degree
    pipeline_parallel_size: int      # PP degree
    max_model_len: int               # Context window
    gpu_memory_utilization: float    # GPU memory fraction (0.9)
    trust_remote_code: bool          # Trust model code
    tool_call_parser: Optional[str]  # Custom tool parsing
    # ... 20+ more configuration fields
```

#### State Models

```python
class ProcessInfo:
    """Running inference process."""
    pid: int
    backend: str
    model_path: Optional[str]
    port: int

class HealthResponse:
    """Health check response."""
    status: str                      # "ok" | "error"
    inference_ready: bool            # Can backend accept requests?
    backend_reachable: bool          # Can we reach the backend?
    running_model: Optional[str]     # Currently loaded model
```

### 3. Process Management (`controller/process.py`)

Manages the lifecycle of inference server processes.

#### Process Detection

```python
def find_inference_process(port: int) -> Optional[ProcessInfo]:
    """Scan running processes to find vLLM/SGLang on given port."""
    for proc in psutil.process_iter():
        cmdline = proc.cmdline()
        backend = _is_inference_process(cmdline)
        if backend and port_matches:
            return ProcessInfo(...)
```

Supported backends:
- **vLLM**: `vllm.entrypoints.openai.api_server` or `vllm serve`
- **SGLang**: `python -m sglang.launch_server`
- **Transformers**: Custom FastAPI server in `scripts/deepseek/transformers_server.py`
- **TabbyAPI**: ExLlamaV3-based backend

#### Launch流程

```python
async def launch_recipe(recipe: Recipe) -> LaunchResult:
    1. Check if port is already in use
    2. Evict existing model if force=True
    3. Build command line arguments
    4. Set up environment (CUDA_VISIBLE_DEVICES, etc.)
    5. Create log directory
    6. Start subprocess with Popen
    7. Wait for health endpoint to respond (with timeout)
    8. Update peak metrics store
```

#### Command Builders

Each backend has a dedicated command builder:

```python
# vLLM: build_vllm_command(recipe) -> List[str]
# SGLang: build_sglang_command(recipe) -> List[str]
# Transformers: build_transformers_command(recipe) -> List[str]
```

Example vLLM command:
```bash
python -m vllm.entrypoints.openai.api_server \
  --model /path/to/model \
  --port 8000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --tool-call-parser pythonic  # For tool calling
```

### 4. Storage Layer (`controller/store.py`)

SQLite-based persistence with context managers for safe connections.

#### RecipeStore

```python
# Schema: recipes (id, data, created_at, updated_at)
# Data format: JSON-serialized Recipe model

recipes = store.list()           # Get all recipes
recipe = store.get(id)           # Get single recipe
store.save(recipe)               # Create or update
store.delete(id)                 # Delete recipe
store.import_from_json(path)     # Bulk import
```

Migration support:
- Legacy schema: `json` column
- New schema: `data` column
- Auto-detection on startup

#### ChatStore

```python
# Schema:
#   chat_sessions (id, title, model, parent_id, created_at, updated_at)
#   chat_messages (id, session_id, role, content, model, tool_calls,
#                  request_prompt_tokens, request_tools_tokens,
#                  request_total_input_tokens, request_completion_tokens,
#                  created_at)

sessions = store.list_sessions()
session = store.get_session(id)    # Includes messages
store.create_session(id, title, model, parent_id)
store.add_message(session_id, message_id, role, content, ...)
store.fork_session(id, new_id, message_id)  # Branch chat
```

Token tracking:
- `request_prompt_tokens`: Input message tokens
- `request_tools_tokens`: Tool definition tokens
- `request_total_input_tokens`: Sum of both
- `request_completion_tokens`: Output tokens

#### PeakMetricsStore

Tracks best performance per model:

```python
# Schema: peak_metrics (model_id, prefill_tps, generation_tps, ttft_ms,
#                       total_tokens, total_requests, updated_at)

metrics = store.get(model_id)
store.update_if_better(model_id, prefill_tps=1000, generation_tps=80)
store.add_tokens(model_id, tokens=100, requests=1)
```

#### LifetimeMetricsStore

Cumulative metrics across all sessions:

```python
# Schema: lifetime_metrics (key, value, updated_at)
# Keys: tokens_total, prompt_tokens_total, completion_tokens_total,
#       energy_wh, uptime_seconds, requests_total, first_started_at

lifetime.add_tokens(1000)
lifetime.add_energy(0.05)  # Watt-hours
lifetime.add_uptime(60)    # Seconds
```

---

## Frontend Components

### Page Structure

```
frontend/src/app/
├── page.tsx              # Dashboard - model management, metrics
├── chat/
│   └── page.tsx          # Chat interface - persistent sessions
├── recipes/
│   └── page.tsx          # Recipe CRUD operations
├── usage/
│   └── page.tsx          # Usage analytics dashboard
└── api/
    ├── title/route.ts    # Chat title generation endpoint
    └── proxy/
        └── [...route].ts # Backend proxy for CORS handling
```

### 1. Dashboard (`app/page.tsx`)

Main landing page for model management.

#### State Management

```typescript
const {
  status: realtimeStatus,        // Backend status
  gpus: realtimeGpus,            // GPU metrics
  metrics: realtimeMetrics,      // vLLM metrics
  launchProgress,                // Launch stages
  isConnected,                   // SSE connection
} = useRealtimeStatus();

const [recipes, setRecipes] =               // All model recipes
  useState<RecipeWithStatus[]>([]);

const [currentRecipe, setCurrentRecipe] =   // Currently running
  useState<RecipeWithStatus | null>(null);

const [searchQuery, setSearchQuery] =       // Recipe search
  useState<string>('');
```

#### Key Features

- **Recipe Search**: Filter by name, ID, or model path
- **Model Launch**: Switch models with force option
- **Real-time Metrics**: GPU utilization, memory, temperature, power
- **Benchmarking**: Run performance benchmarks (TTFT, throughput)
- **Log Streaming**: View backend logs during launch

### 2. Chat Interface (`app/chat/page.tsx`)

Persistent multi-session chat with streaming, tools, and vision.

#### Core State

```typescript
// Session Management
const [sessions, setSessions] =               // All sessions
  useState<ChatSession[]>([]);

const [currentSessionId, setCurrentSessionId] =  // Active session
  useState<string | null>(null);

// Messages
const [messages, setMessages] =
  useState<Message[]>([]);

const [input, setInput] =
  useState<string>('');

const [isLoading, setIsLoading] =
  useState<boolean>(false);

// Model Selection
const [selectedModel, setSelectedModel] =
  useState<string>('');

const [availableModels, setAvailableModels] =
  useState<Array<{ id: string }>>([]);

// UI State
const [sidebarCollapsed, setSidebarCollapsed] =
  useState<boolean>(false);

const [queuedContext, setQueuedContext] =
  useState<string>('');  // Additional context during streaming
```

#### Message Flow

```typescript
1. User submits message
2. Create user message object, append to messages
3. Open SSE connection to /api/proxy/v1/chat/completions
4. Stream response chunks:
   - text delta → append to assistant message
   - tool_calls → parse and display tool cards
   - done → finalize, save to backend, update token counts
5. Handle tool results if tools were called
6. Update session metadata (title, token counts)
```

#### Think Tag Handling

Special parsing for reasoning content:

```typescript
// Strip think tags before sending to model
const stripThinkingForModelContext = (text: string) => {
  // Remove <|begin_of_box|>...<|end_of_box|>
  // Extract renderable code blocks from <think>...</think>
  // Preserve HTML/SVG/React artifacts
  // Strip thinking content to avoid feeding chain-of-thought
};

// Display logic:
// - Show reasoning in collapsible "Thinking" section
// - Show main content as message body
// - Extract and render code blocks from thinking
```

#### Tool Call Rendering

```typescript
interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
  result?: {
    output: string;
    error?: string;
  };
}
```

Tool calls are displayed as expandable cards with syntax-highlighted arguments.

### 3. Recipes Page (`app/recipes/page.tsx`)

CRUD interface for model recipes.

#### Features

- **List Recipes**: Table view with status badges
- **Create Recipe**: Form with all configuration fields
- **Edit Recipe**: Update existing recipes
- **Delete Recipe**: Remove recipes (with confirmation)
- **Import JSON**: Bulk import from file
- **Status Indicator**: Show if recipe is currently running

#### Recipe Form Fields

Basic:
- ID, Name, Model Path
- Backend (vllm/sglang/transformers)

Memory & Parallelism:
- Max Model Length (context window)
- GPU Memory Utilization
- Tensor Parallel Size
- Pipeline Parallel Size

Features:
- Trust Remote Code
- Tool Call Parser
- Enable Auto Tool Choice

Quantization:
- Quantization method (awq, gptq, squeezellm, etc.)
- Data type (float16, bfloat16, etc.)

Networking:
- Host, Port
- Served Model Name (alias)

Advanced:
- Custom Python path
- Environment variables
- Extra CLI arguments

### 4. Usage Page (`app/usage/page.tsx`)

Analytics dashboard for token consumption and costs.

#### Metrics Display

```typescript
interface UsageStats {
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
  };
  cache: {
    hits: number;
    misses: number;
    hit_tokens: number;
    miss_tokens: number;
  };
  by_model: Array<{
    model: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    requests: number;
  }>;
  daily: Array<{
    date: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    requests: number;
  }>;
}
```

Visualizations:
- Total token counts (prompt vs completion)
- Request count over time
- Per-model breakdown
- Cache hit/miss rates

---

## Infrastructure Layer

### Docker Compose Services

```yaml
services:
  postgres:           # LiteLLM database
  litellm:           # API gateway
  redis:             # Caching
  prometheus:        # Metrics collection
  grafana:           # Dashboards
  frontend:          # Next.js UI
```

#### PostgreSQL (port 5432)

- **Purpose**: LiteLLM state (API keys, spend tracking, user management)
- **Connection pooling**: `pool_pre_ping=true`, `pool_size=5`, `max_overflow=10`
- **Health check**: `pg_isready -U postgres`
- **Restart policy**: `unless-stopped`

#### LiteLLM (port 4100)

- **Purpose**: API gateway, routing, format translation
- **Configuration**: `config/litellm.yaml`
- **Tool call handler**: Custom Python callback in `config/tool_call_handler.py`
- **Health check**: Python-based (curl not available in container)
- **Restart policy**: `unless-stopped`

Key features:
- Model aliasing (case-insensitive matching)
- Wildcard routing (`*` → local inference server)
- Redis caching for responses
- Prometheus metrics export
- Tool call format conversion

#### Redis (port 6379)

- **Purpose**: Response caching, rate limiting
- **Persistence**: AOF enabled (`appendonly yes`)
- **TTL**: 3600 seconds (1 hour)
- **Restart policy**: `unless-stopped`

#### Prometheus (port 9090)

- **Purpose**: Time-series metrics storage
- **Retention**: 30 days
- **Configuration**: `config/prometheus.yml`
- **Restart policy**: `unless-stopped`

Scrapes metrics from:
- LiteLLM (request counts, latencies, errors)
- Controller (GPU metrics, model status)

#### Grafana (port 3001)

- **Purpose**: Visualization dashboards
- **Authentication**: admin/admin (changeable)
- **Provisioning**: Dashboards auto-loaded from `config/grafana/dashboards/`
- **Restart policy**: `unless-stopped`

#### Frontend (host network mode)

- **Purpose**: Next.js web UI
- **Build context**: `./frontend`
- **Environment variables**:
  - `BACKEND_URL`: Controller API
  - `LITELLM_URL`: LiteLLM proxy
  - `NEXT_PUBLIC_LITELLM_URL`: Client-side URL
- **Restart policy**: `unless-stopped`

---

## Data Flows

### 1. Model Launch Flow

```
User clicks "Launch" on Dashboard
  ↓
Frontend: POST /launch/{recipeId}?force=true
  ↓
Controller: launch_recipe()
  ├─ Check port availability
  ├─ Evict existing model if needed
  ├─ Build command (vllm/sglang/transformers)
  ├─ Start subprocess
  └─ Wait for /health endpoint
  ↓
Controller: Broadcast SSE events
  ├─ {status: "launching", stage: "starting"}
  ├─ {status: "launching", stage: "loading_weights"}
  └─ {status: "running", process: {...}}
  ↓
Frontend: Update UI with progress
  ↓
Model ready to serve requests
```

### 2. Chat Completion Flow

```
User sends message in chat interface
  ↓
Frontend: POST /api/proxy/v1/chat/completions
  {
    messages: [...],
    model: "model-name",
    stream: true,
    tools: [...]
  }
  ↓
Next.js API Route (/api/proxy/[...route].ts)
  ├─ Validate request
  ├─ Forward to http://localhost:8080/v1/chat/completions
  └─ Stream response back to client
  ↓
Controller: Proxy to inference backend (8000)
  ├─ Add metadata (session_id, timestamp)
  ├─ Parse tokens from response
  └─ Update token counts
  ↓
LiteLLM: Route to configured model
  ├─ Resolve model alias
  ├─ Convert tool formats if needed
  ├─ Apply callbacks (tool_call_handler)
  └─ Return response
  ↓
Inference Backend (vLLM/SGLang)
  ├─ Load model weights
  ├─ Process tokens
  └─ Stream response
  ↓
Tool Call Handler (if tools in response)
  ├─ Parse tool_calls from content
  ├─ Extract <think> tag content
  ├─ Set reasoning_content field
  └─ Return formatted response
  ↓
Frontend: Stream chunks to UI
  ├─ Append text delta
  ├─ Update token counts
  ├─ Display tool calls
  ├─ Save message to ChatStore
  └─ Update session metadata
```

### 3. Token Tracking Flow

```
Chat completion request
  ↓
Controller: parse_tokens_from_response()
  ├─ Extract usage from response
  ├─ If no usage, estimate via tokenizer
  └─ Return {prompt, completion, total}
  ↓
Controller: update session token counts
  ├─ chat_store.add_message(
        session_id, message_id,
        request_prompt_tokens,
        request_completion_tokens
      )
  ├─ chat_store.update_session(
        session_id,
        total_tokens=...
      )
  ↓
Controller: update lifetime metrics
  ├─ lifetime_metrics.add_tokens(total)
  ├─ lifetime_metrics.add_prompt_tokens(prompt)
  └─ lifetime_metrics.add_completion_tokens(completion)
  ↓
Frontend: Display token counts
  ├─ Per-message tokens
  ├─ Session total tokens
  └─ Usage page aggregates
```

### 4. Metrics Broadcasting Flow

```
Controller startup
  ↓
Start broadcast_metrics() task
  ↓
Loop (every 1 second):
  ├─ Check backend health
  ├─ Get GPU info (nvidia-smi)
  ├─ Get vLLM metrics from /metrics
  ├─ Calculate energy consumption
  └─ Update peak/lifetime stores
  ↓
Broadcast to SSE clients
  ├─ Event: "metrics"
  ├─ Data: {status, gpus, metrics, process}
  └─ Send to all connected EventSource clients
  ↓
Frontend: useRealtimeStatus() hook
  ├─ Connect to /api/proxy/events
  ├─ Parse SSE events
  └─ Update component state
```

---

## State Management

### Backend State

**SQLite Databases**:
- `data/recipes.db`: Model recipes
- `data/chats.db`: Chat sessions and messages
- `data/metrics.db`: Peak performance metrics
- `data/lifetime.db`: Cumulative metrics

**In-Memory State**:
```python
_switch_lock: asyncio.Lock           # Prevent concurrent switches
_last_launched_recipe_id: str        # Auto-restart tracking
_current_launch_cancelled: Event     # Cancel in-progress launch
_sse_connections: Set[EventSource]   # Connected clients
```

### Frontend State

**Server State** (Next.js):
- Session data stored in SQLite
- Recipe configuration in SQLite
- No server-side session cache (stateless API)

**Client State** (React):
- Component-level `useState` for UI state
- `useRealtimeStatus` hook for SSE metrics
- `loadState`/`saveState` for localStorage persistence

**Persistence**:
```typescript
// Chat state persistence (localStorage)
const state = {
  messages: [...],
  input: "...",
  selectedModel: "...",
  queuedContext: "...",
};
saveState(sessionId, state);
```

---

## API Endpoints

### Controller API (port 8080)

#### Health & Status
- `GET /health` - Health check
- `GET /status` - Full status with GPU/metrics
- `GET /events` - SSE metrics stream

#### Recipes
- `GET /recipes` - List all recipes
- `GET /recipes/{id}` - Get recipe details
- `POST /recipes` - Create recipe
- `PUT /recipes/{id}` - Update recipe
- `DELETE /recipes/{id}` - Delete recipe

#### Model Lifecycle
- `POST /launch/{recipeId}?force=true` - Launch model
- `POST /evict?force=true` - Stop current model
- `POST /switch/{recipeId}?force=true` - Switch model
- `GET /wait-ready?timeout=300` - Wait for model ready

#### Chat Sessions
- `GET /chats` - List sessions
- `GET /chats/{id}` - Get session with messages
- `POST /chats` - Create session
- `PUT /chats/{id}` - Update session
- `DELETE /chats/{id}` - Delete session
- `POST /chats/{id}/fork` - Fork session at message

#### OpenAI Compatibility
- `GET /v1/models` - List available models
- `GET /v1/chat/completions` - Chat completions
- `GET /v1/completions` - Text completions
- `POST /v1/chat/completions/tokenize` - Count tokens
- `GET /v1/studio/models` - Discover models

#### Metrics
- `GET /metrics/gpu` - GPU metrics
- `GET /metrics/vllm` - vLLM metrics
- `GET /metrics/peak?model_id=` - Peak metrics per model
- `GET /logs/{recipeId}?limit=100` - Backend logs

#### Usage Analytics
- `GET /usage` - Token usage statistics

### LiteLLM API (port 4100)

- `POST /v1/chat/completions` - Main chat endpoint
- `POST /v1/completions` - Text completions
- `GET /v1/models` - Available models
- `GET /health` - Health check (requires auth)

---

## Configuration Management

### Environment Variables

**Controller**:
```bash
VLLM_STUDIO_PORT=8080                    # Controller port
VLLM_STUDIO_INFERENCE_PORT=8000          # Inference port
VLLM_STUDIO_API_KEY=sk-xxx               # Optional auth
```

**LiteLLM** (docker-compose.yml):
```bash
LITELLM_MASTER_KEY=sk-master             # Admin key
DATABASE_URL=postgresql://...            # PostgreSQL URL
INFERENCE_API_BASE=http://...            # Backend URL
INFERENCE_API_KEY=sk-placeholder         # Backend key
```

**Frontend**:
```bash
BACKEND_URL=http://localhost:8080        # Controller URL
LITELLM_URL=http://localhost:4100        # LiteLLM URL
NEXT_PUBLIC_LITELLM_URL=http://...       # Client-side URL
```

### Configuration Files

**LiteLLM** (`config/litellm.yaml`):
- Model list with aliases
- Router settings
- Caching configuration
- Callback registration
- Database connection

**Prometheus** (`config/prometheus.yml`):
- Scrape configs
- Retention policies
- Target definitions

**Grafana** (`config/grafana/`):
- Datasource provisioning
- Dashboard provisioning
- User settings

---

## Extension Points

### 1. Custom Tool Call Parser

Add a custom tool call parser:

```python
# In recipe model
tool_call_parser: "pythonic"  # or "jinja", "custom"

# In backend (controller/process.py)
if recipe.tool_call_parser == "pythonic":
    cmd.extend(["--tool-call-parser", "pythonic"])
```

### 2. Custom Inference Backend

Add support for a new backend:

1. Create command builder in `controller/backends.py`:
```python
def build_custom_command(recipe: Recipe) -> List[str]:
    return ["custom-server", "--model", recipe.model_path, ...]
```

2. Add to `Backend` enum in `controller/models.py`:
```python
class Backend(str, Enum):
    CUSTOM = "custom"
```

3. Add process detection in `controller/process.py`:
```python
def _is_inference_process(cmdline):
    if "custom-server" in joined:
        return "custom"
```

### 3. Custom Callback Handler

Add LiteLLM callback:

1. Implement in `config/tool_call_handler.py`:
```python
class CustomHandler(CustomLogger):
    async def async_post_call_success_hook(self, data, ...):
        # Custom logic
```

2. Register in `config/litellm.yaml`:
```yaml
litellm_settings:
  callbacks: tool_call_handler.custom_handler_instance
```

### 4. Custom Metrics

Add custom metric collection:

1. Add to `controller/metrics.py`:
```python
async def collect_custom_metrics():
    # Your metric collection logic
    return {"custom_metric": value}
```

2. Include in broadcast:
```python
metrics_data["custom"] = await collect_custom_metrics()
```

### 5. Frontend Plugin System

Add custom components:

1. Create component in `frontend/src/components/`
2. Import and use in page
3. Fetch data from backend API
4. Display with UI components

---

## Performance Considerations

### Backend

- **Connection Pooling**: PostgreSQL uses connection pooling (pool_size=5)
- **Async Operations**: All I/O is async (asyncio, httpx)
- **Subprocess Management**: Non-blocking process launches
- **SSE Broadcasting**: Efficient fan-out to multiple clients

### Frontend

- **Code Splitting**: Pages are split by Next.js
- **Lazy Loading**: Components loaded on demand
- **Streaming Responses**: SSE for real-time updates
- **Local Caching**: Recipe/metadata caching in memory

### Inference

- **GPU Utilization**: Default 90% (configurable)
- **Batching**: max_num_seqs=256 (configurable)
- **Context Window**: Per-model configuration
- **Tensor Parallelism**: Multi-GPU support

---

## Security Considerations

### Authentication

- **LiteLLM**: Master key required for admin operations
- **Controller**: Optional API key via `VLLM_STUDIO_API_KEY`
- **Frontend**: Cookie-based auth (if configured)

### Network Isolation

- **Internal Networks**: Docker services on internal network
- **Host Gateway**: `host.docker.internal` for host access
- **Port Exposure**: Only necessary ports exposed

### Data Protection

- **No Secrets in Git**: All secrets via environment variables
- **SQLite Permissions**: Database files in `data/` directory
- **CORS**: Configured for local development

---

## Troubleshooting

### Common Issues

**LiteLLM healthcheck failing**:
- Cause: `curl` not installed in container
- Fix: Use Python-based healthcheck (already applied)

**Database connection errors**:
- Cause: Connection pool exhausted
- Fix: Add `pool_pre_ping=true`, increase `pool_size`

**Model launch timeout**:
- Cause: Model loading takes longer than timeout
- Fix: Increase timeout in launch logic or use larger GPU

**SSE connection drops**:
- Cause: Network issues or server restart
- Fix: Frontend auto-reconnects with exponential backoff

**Token counts mismatch**:
- Cause: Model doesn't return usage field
- Fix: Estimate with local tokenizer (already implemented)

---

## Future Enhancements

Potential areas for improvement:

1. **Multi-Model Support**: Run multiple models simultaneously
2. **Model Sharding**: Distribute large models across GPUs
3. **A/B Testing**: Compare model performance
4. **Cost Optimization**: Automated model selection based on cost/quality
5. **Federation**: Support for distributed inference across machines
6. **Model Caching**: Cache model weights on SSD for faster loading
7. **Advanced Metrics**: Per-request latency tracking, error rates
8. **Auto-Scaling**: Automatically scale GPU resources based on load
9. **Fine-Tuning UI**: Web interface for LoRA fine-tuning
10. **Model Versioning**: Track and rollback model versions

---

## Contributing

When adding new features:

1. **Backend**: Add Pydantic models for type safety
2. **Frontend**: Use TypeScript strict mode
3. **API**: Follow OpenAI-compatible patterns
4. **Storage**: Use SQLite stores for persistence
5. **Metrics**: Include in SSE broadcast
6. **Documentation**: Update this file

---

## License

See LICENSE file for details.
