# vLLM Studio

Model lifecycle management for vLLM and SGLang inference servers.

## What It Does

- **Launch/evict models** on vLLM or SGLang backends
- **Save recipes** - reusable model configurations with full parameter support
- **Reasoning support** - auto-detection for GLM (`glm45`), INTELLECT-3 (`deepseek_r1`), and MiniMax (`minimax_m2_append_think`) parsers
- **Tool calling** - native function calling with auto tool choice (auto-detected for GLM and INTELLECT-3 models)
- **Web UI** for chat, model management, and usage analytics
- **LiteLLM integration** for API gateway features (optional)

## Architecture

```
┌──────────┐      ┌────────────┐      ┌─────────────┐
│  Client  │─────▶│ Controller │─────▶│ vLLM/SGLang │
│          │      │   :8080    │      │    :8000    │
└──────────┘      └────────────┘      └─────────────┘
                        │
                  ┌─────┴─────┐
                  │  Web UI   │
                  │   :3000   │
                  └───────────┘
```

**Optional:** Add LiteLLM as an API gateway for OpenAI/Anthropic format translation, cost tracking, and routing.

## Quick Start

```bash
# Install controller
pip install -e .

# Run controller
vllm-studio

# (Optional) Run frontend
cd frontend && npm install && npm run dev
```

## API Reference

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with backend status |
| `/status` | GET | Running process details |
| `/gpus` | GET | GPU info (memory, utilization) |

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

## Configuration

### Environment Variables

```bash
VLLM_STUDIO_PORT=8080           # Controller port
VLLM_STUDIO_INFERENCE_PORT=8000 # vLLM/SGLang port
VLLM_STUDIO_API_KEY=your-key    # Optional auth
```

### Recipe Example

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
| `backend` | string | `vllm` or `sglang` |
| `tensor_parallel_size` | int | GPU parallelism |
| `pipeline_parallel_size` | int | Pipeline parallelism |
| `max_model_len` | int | Max context length |
| `gpu_memory_utilization` | float | VRAM usage (0-1) |
| `kv_cache_dtype` | string | KV cache type |
| `quantization` | string | Quantization method |
| `dtype` | string | Model dtype |
| `served_model_name` | string | Name exposed via API |
| `tool_call_parser` | string | Tool calling parser |
| `reasoning_parser` | string | Reasoning/thinking parser (auto-detected for GLM, MiniMax) |
| `enable_auto_tool_choice` | bool | Enable automatic tool selection |
| `trust_remote_code` | bool | Allow remote code |
| `extra_args` | object | Additional CLI args |

## Directory Structure

```
vllm-studio/
├── controller/
│   ├── app.py         # FastAPI endpoints
│   ├── process.py     # Process management
│   ├── backends.py    # vLLM/SGLang command builders
│   ├── models.py      # Pydantic models
│   ├── store.py       # SQLite storage
│   ├── config.py      # Settings
│   └── cli.py         # Entry point
├── frontend/          # Next.js web UI
├── config/
│   └── litellm.yaml   # LiteLLM config (optional)
└── docker-compose.yml
```

## With LiteLLM (Optional)

For OpenAI/Anthropic API compatibility:

```bash
docker compose up litellm
```

Then use `http://localhost:4100` as your API endpoint with any OpenAI-compatible client.

## License

Apache 2.0
