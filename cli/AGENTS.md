<!-- CRITICAL -->
# vLLM Studio CLI - Agent Interface

Headless CLI for AI agents to manage vLLM/SGLang inference servers.

## Installation

```bash
# Install globally
cd cli && bun run build && cp vllm-studio ~/.local/bin/

# Or run directly
bun /path/to/cli/src/main.ts <command>
```

## Environment

```bash
export VLLM_STUDIO_URL=http://localhost:8080  # Default
```

## Commands

All commands output JSON for easy parsing.

### status
Get current model status.
```bash
vllm-studio status
```
```json
{
  "running": true,
  "launching": false,
  "model": "qwen-72b",
  "backend": "vllm",
  "pid": 12345,
  "port": 8000
}
```

### gpus
List available GPUs.
```bash
vllm-studio gpus
```
```json
[
  {
    "index": 0,
    "name": "NVIDIA RTX 4090",
    "memory_used": 20000000000,
    "memory_total": 24000000000,
    "utilization": 85,
    "temperature": 65,
    "power_draw": 320
  }
]
```

### recipes
List available model recipes.
```bash
vllm-studio recipes
```
```json
[
  {
    "id": "qwen-72b-awq",
    "name": "Qwen 72B AWQ",
    "model_path": "/models/Qwen-72B-AWQ",
    "backend": "vllm",
    "tensor_parallel_size": 4
  }
]
```

### launch
Launch a recipe by ID.
```bash
vllm-studio launch <recipe-id>
```
```json
{"success": true, "recipe_id": "qwen-72b-awq"}
```
Exit code: 0 on success, 1 on failure.

### evict
Stop the running model.
```bash
vllm-studio evict
```
```json
{"success": true}
```
Exit code: 0 on success, 1 on failure.

### config
Get system configuration.
```bash
vllm-studio config
```
```json
{
  "port": 8080,
  "inference_port": 8000,
  "models_dir": "/models",
  "data_dir": "/data"
}
```

### metrics
Get lifetime usage metrics.
```bash
vllm-studio metrics
```
```json
{
  "total_tokens": 12500000,
  "total_requests": 45200,
  "total_energy_kwh": 2.3
}
```

## Common Workflows

### Check if model is running
```bash
vllm-studio status | jq -r '.running'
```

### Get first available recipe ID
```bash
vllm-studio recipes | jq -r '.[0].id'
```

### Launch first recipe if idle
```bash
if [ "$(vllm-studio status | jq -r '.running')" = "false" ]; then
  RECIPE=$(vllm-studio recipes | jq -r '.[0].id')
  vllm-studio launch "$RECIPE"
fi
```

### Wait for model to be ready
```bash
while [ "$(vllm-studio status | jq -r '.running')" != "true" ]; do
  sleep 2
done
```

### Get total GPU memory available
```bash
vllm-studio gpus | jq '[.[].memory_total] | add'
```

## Error Handling

- Non-zero exit codes indicate failure
- Errors are written to stderr
- JSON output includes error details when applicable

## TUI Mode

Run without arguments for interactive TUI:
```bash
vllm-studio
```

Navigation: `1-4` views, `↑↓` select, `Enter` launch, `e` evict, `q` quit.
