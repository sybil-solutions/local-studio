<!-- CRITICAL -->
# frontend/src/app/recipes/AGENTS.md

Recipe management - create, edit, and launch model configurations.

## Structure

```
recipes/
├── page.tsx      # Recipe list and management
└── hooks/        # Recipe-specific hooks
```

## Features

### Recipe List
- Display all saved recipes
- Show status (running/starting/stopped)
- Quick launch/evict actions
- Delete with confirmation

### Recipe Editor
- Full recipe configuration form
- All vLLM/SGLang parameters
- Environment variables
- Extra CLI arguments

### Model Launching
- One-click launch from recipe
- Progress indicator via SSE
- Automatic eviction of running model

## Recipe Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `model_path` | string | Path to model weights |
| `backend` | enum | `vllm`, `sglang`, `tabbyapi` |
| `tensor_parallel_size` | number | GPU parallelism |
| `max_model_len` | number | Context length |
| `gpu_memory_utilization` | number | VRAM usage (0-1) |
| `quantization` | string | Quantization method |
| `tool_call_parser` | string | Tool calling parser |
| `reasoning_parser` | string | Reasoning token parser |
| `trust_remote_code` | boolean | Allow remote code |
| `extra_args` | object | Additional CLI flags |

## API Integration

| Endpoint | Action |
|----------|--------|
| `GET /recipes` | List all recipes |
| `POST /recipes` | Create recipe |
| `PUT /recipes/:id` | Update recipe |
| `DELETE /recipes/:id` | Delete recipe |
| `POST /launch/:id` | Launch model |
| `POST /evict` | Stop running model |

## Runtime Management

- Runtime discovery and upgrades live in `src/app/recipes/_components/vllm-runtime-panel.tsx` and call `src/lib/api/studio.ts` runtime endpoints under `/runtime/*`.
- Keep this panel aligned with `controller/src/modules/lifecycle/runtime-routes.ts` and `controller/src/modules/lifecycle/runtime-info.ts` whenever upgrade behavior or payload shapes change.

## Status Colors

- 🟢 **running** - Model is active and ready
- 🟡 **starting** - Model is launching
- ⚫ **stopped** - Model is not running
