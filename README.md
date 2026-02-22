<!-- CRITICAL -->
# vLLM Studio

Model lifecycle management for vLLM, SGLang, TabbyAPI, and llama.cpp inference servers.

## What It Does

- **Launch/evict models** on vLLM, SGLang, TabbyAPI, or llama.cpp backends
- **Save recipes** — reusable model configurations with full parameter support
- **Reasoning support** — auto-detection for DeepSeek-R1, GLM, MiniMax, and other reasoning parsers
- **Tool calling** — native function calling with MCP server integration
- **Agent mode** — multi-turn tool-use agent with plan/execute workflow
- **Web UI** for chat, model management, and usage analytics
- **CLI** — terminal UI for managing models and monitoring
- **iOS client** — native Swift client
- **LiteLLM integration** for API gateway features (optional)

## Prerequisites

| Tool | Version | Required |
|------|---------|----------|
| [Bun](https://bun.sh) | >= 1.0 | Yes |
| [Node.js](https://nodejs.org) | >= 20 | Yes (frontend) |
| [Docker](https://docs.docker.com/get-docker/) | Latest | No — only for LiteLLM, Postgres, Redis |
| GPU | CUDA-capable | No — mock inference works without one |

## Quick Start (No GPU Required)

Get the UI running in under 2 minutes with mock inference:

```bash
# Clone and install
git clone https://github.com/0xSero/vllm-studio.git
cd vllm-studio
cd controller && bun install && cd ..
cd frontend && npm install && cd ..

# Start controller (mock inference, no Docker)
./start.sh --direct

# In a separate terminal — start frontend
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The controller API runs on `http://localhost:8080`.

## Full Setup (GPU Server)

For real inference with a GPU:

```bash
# 1. Install dependencies (same as above)
cd controller && bun install && cd ..
cd frontend && npm install && cd ..

# 2. Configure environment
cp .env.example .env
# Edit .env — set VLLM_STUDIO_MODELS_DIR to your model weights directory

# 3. Start controller (connects to real inference backend)
VLLM_STUDIO_MOCK_INFERENCE=0 ./start.sh --direct

# 4. Start frontend
cd frontend && npm run dev
```

To also run Docker services (LiteLLM, Postgres, Redis, Prometheus):

```bash
./start.sh   # Without --direct, starts Docker Compose automatically
```

## Docker Services

All optional. Only needed for specific features:

| Service | Port | Purpose |
|---------|------|---------|
| LiteLLM | 4100 | API gateway, OpenAI format translation |
| PostgreSQL | 5432 | Usage analytics (LiteLLM) |
| Redis | 6379 | Response caching |
| Prometheus | 9090 | Metrics collection |
| Temporal | 7233 | Workflow orchestration |

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│   Frontend   │────▶│     Controller      │────▶│  vLLM / SGLang /     │
│  Next.js     │     │  Bun + Hono + SQLite│     │  TabbyAPI / llama.cpp│
│  :3000       │     │  :8080              │     │  :8000               │
└──────────────┘     └─────────┬───────────┘     └──────────────────────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
               LiteLLM    Postgres     Redis
               (opt)      (opt)        (opt)
```

## Project Structure

```
vllm-studio/
├── controller/          # API server (Bun + Hono + SQLite)
│   └── src/
│       ├── main.ts              # Entry point
│       ├── config/              # Environment & persisted settings
│       ├── core/                # Logger, errors, async utilities
│       ├── http/                # Hono app, SSE
│       ├── routes/              # API route handlers
│       ├── services/            # Backends, GPU, process management, agent runtime
│       ├── stores/              # SQLite stores (recipes, chats, MCP, metrics)
│       └── types/               # Zod schemas, branded types
├── cli/                 # Terminal UI (Bun)
│   └── src/
│       ├── main.ts              # Entry point
│       └── views/               # Dashboard, recipes, config, status
├── frontend/            # Web UI (Next.js + React + TypeScript)
│   └── src/
│       ├── app/                 # Pages (chat, recipes, logs, discover, usage)
│       ├── components/          # React components
│       ├── hooks/               # useSSE, useContextManager
│       └── lib/                 # API client, types, utilities
├── swift-client/        # iOS client (Swift)
├── desktop/             # Desktop application
├── config/              # Service configs (litellm.yaml, prometheus.yml)
├── start.sh             # Launch script
└── docker-compose.yml   # Optional service orchestration
```

## `start.sh` Reference

```bash
./start.sh                # Start controller + Docker services
./start.sh --direct       # Controller only, no Docker (mock inference auto-enabled)
./start.sh --dev          # Development mode with auto-reload
./start.sh --port 9090    # Custom controller port
```

## Configuration

Copy `.env.example` to `.env` and uncomment what you need. See [`.env.example`](.env.example) for all options.

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `VLLM_STUDIO_PORT` | `8080` | Controller port |
| `VLLM_STUDIO_INFERENCE_PORT` | `8000` | Backend inference port |
| `VLLM_STUDIO_MODELS_DIR` | `/models` | Model weights directory |
| `VLLM_STUDIO_MOCK_INFERENCE` | `true` (in `--direct` mode) | Enable mock inference |
| `VLLM_STUDIO_API_KEY` | — | Optional API authentication |
| `VLLM_STUDIO_DATA_DIR` | `./data` | SQLite database and logs |

## API Reference

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with backend status |
| `/status` | GET | Running process details |
| `/gpus` | GET | GPU info (memory, utilization) |
| `/config` | GET | System topology and service discovery |

### Recipes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/recipes` | GET | List all recipes |
| `/recipes` | POST | Create recipe |
| `/recipes/{id}` | GET | Get recipe |
| `/recipes/{id}` | PUT | Update recipe |
| `/recipes/{id}` | DELETE | Delete recipe |

### Model Lifecycle

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/launch/{recipe_id}` | POST | Launch model from recipe |
| `/evict` | POST | Stop running model |
| `/wait-ready` | GET | Wait for backend ready |

### Chat Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chats` | GET | List sessions |
| `/chats` | POST | Create session |
| `/chats/{id}` | GET | Get session with messages |
| `/chats/{id}` | PUT | Update session |
| `/chats/{id}` | DELETE | Delete session |
| `/chats/{id}/messages` | POST | Add message |
| `/chats/{id}/fork` | POST | Fork session |

### MCP (Model Context Protocol)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/servers` | GET | List MCP servers |
| `/mcp/servers` | POST | Add server |
| `/mcp/tools` | GET | List available tools |
| `/mcp/tools/{server}/{tool}` | POST | Call tool |

### Monitoring

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/events` | GET | SSE stream (status, GPU, metrics, logs) |
| `/metrics` | GET | Prometheus metrics |
| `/usage` | GET | Usage analytics |

## Recipe Example

```json
{
  "id": "llama3-8b",
  "name": "Llama 3 8B",
  "model_path": "/models/Meta-Llama-3-8B-Instruct",
  "backend": "vllm",
  "tensor_parallel_size": 1,
  "max_model_len": 8192,
  "gpu_memory_utilization": 0.9,
  "trust_remote_code": true
}
```

### All Recipe Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `model_path` | string | Path to model weights |
| `backend` | string | `vllm`, `sglang`, `tabbyapi`, or `llamacpp` |
| `tensor_parallel_size` | int | GPU parallelism |
| `pipeline_parallel_size` | int | Pipeline parallelism |
| `max_model_len` | int | Max context length |
| `gpu_memory_utilization` | float | VRAM usage (0-1) |
| `kv_cache_dtype` | string | KV cache type |
| `quantization` | string | Quantization method |
| `dtype` | string | Model dtype |
| `served_model_name` | string | Name exposed via API |
| `tool_call_parser` | string | Tool calling parser |
| `reasoning_parser` | string | Reasoning/thinking parser (auto-detected) |
| `enable_auto_tool_choice` | bool | Enable automatic tool selection |
| `trust_remote_code` | bool | Allow remote code |
| `extra_args` | object | Additional CLI args |

## License

Apache 2.0
