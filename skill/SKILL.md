<!-- CRITICAL -->
---
name: vllm-studio
description: Manage vLLM/SGLang inference servers. Use for checking GPU status, listing/launching/evicting models, and viewing metrics. Requires vllm-studio CLI installed.
---

# vLLM Studio

Manage local LLM inference servers (vLLM, SGLang, TabbyAPI).

## Prerequisites

The `vllm-studio` CLI must be installed and the controller running at `http://localhost:8080` (or set `VLLM_STUDIO_URL`).

## Commands

Use Bash to run these commands. All output is JSON.

### Check Status
```bash
vllm-studio status
```
Returns: `running` (bool), `launching` (bool), `model`, `backend`, `pid`, `port`

### List GPUs
```bash
vllm-studio gpus
```
Returns array of GPUs with `index`, `name`, `memory_used`, `memory_total`, `utilization`, `temperature`, `power_draw`

### List Recipes
```bash
vllm-studio recipes
```
Returns array of recipes with `id`, `name`, `model_path`, `backend`, `tensor_parallel_size`

### Launch Model
```bash
vllm-studio launch <recipe-id>
```
Launches a model recipe. Get recipe IDs from `vllm-studio recipes`.

### Evict Model
```bash
vllm-studio evict
```
Stops the currently running model.

### View Metrics
```bash
vllm-studio metrics
```
Returns `total_tokens`, `total_requests`, `total_energy_kwh`

### View Config
```bash
vllm-studio config
```
Returns `port`, `inference_port`, `models_dir`, `data_dir`

## Examples

Check if a model is running:
```bash
vllm-studio status | jq '.running'
```

Launch a specific model:
```bash
vllm-studio launch qwen-72b-awq
```

Get available VRAM:
```bash
vllm-studio gpus | jq '.[0].memory_total - .[0].memory_used'
```

## When to Use

- User asks about GPU status or utilization
- User wants to load/switch/stop a model
- User needs to check what models are available
- User asks about inference server status
- Before making API calls to check if model is ready
