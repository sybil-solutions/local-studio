# GLM-4.7 Production Setup

## Configuration Summary

**Model**: GLM-4.7-EXL3-3bpw_H6 (355B MoE parameters)
**Hardware**: 8x NVIDIA RTX 3090 (24GB each)
**Context**: 160k tokens
**GPU Mode**: Tensor Parallelism

---

## Key Files

### TabbyAPI Config
**Location**: `/home/ser/workspace/projects/tabbyAPI/config-glm47.yml`

```yaml
model:
  model_dir: /mnt/llm_models
  model_name: GLM-4.7-EXL3-3bpw_H6
  prompt_template: glm4-official

  # 160k context window
  max_seq_len: 163840
  max_context_length: 163840

  # Q4 KV cache to save VRAM
  cache_mode: Q4
  cache_size: 163840

  chunk_size: 8192

  # Enable tensor parallelism for parallel GPU usage
  tensor_parallel: true
  tensor_parallel_backend: native

  # Manual GPU split with 17GB per GPU for tensor parallel mode
  gpu_split: [17, 17, 17, 17, 17, 17, 17, 17]

  use_flash_attn_2: true
  max_batch_size: 1

sampling:
  temperature: 0.7
  min_p: 0.05
  repetition_penalty: 1.05
  frequency_penalty: 0.1
```

---

## Tool Calling Fix

**Problem**: GLM-4.7 outputs tool calls in non-standard format:
```
Invokeread filePath="/path/to/file"Result
```

**Solution**: Updated `/home/ser/workspace/projects/tabbyAPI/endpoints/OAI/utils/tools.py`

The `ToolCallProcessor.from_xml()` method now handles:
1. JSON format: `Invoke{"name": "fn", "arguments": {...}}Result`
2. Key-value format: `InvokefunctionName key="value" key2="value2"Result`
3. Malformed/unclosed tags

---

## GPU Utilization

### Configuration
- **Tensor Parallel**: Enabled
- **VRAM per GPU**: ~18GB (model + KV cache)
- **Headroom**: ~6GB per GPU
- **Total Effective VRAM**: ~144GB

### Performance
- **Idle Utilization**: 0-5% per GPU
- **Generation Utilization**: **95-98% on all 8 GPUs**
- **All GPUs work in parallel** (not sequential)

---

## Architecture

```
Client (Claude Code, etc.)
    ↓
api.homelabai.org (tunnel)
    ↓
Controller (8080) - proxies to LiteLLM
    ↓
LiteLLM (4100) - routes to backend
    ↓
Tabby Proxy (8001) - tool call parsing
    ↓
TabbyAPI (8000) - runs GLM-4.7 on ExLlamaV3
    ↓
8x RTX 3090 GPUs (Tensor Parallel)
```

---

## Startup Commands

### Start TabbyAPI
```bash
cd /home/ser/workspace/projects/tabbyAPI
nohup .venv/bin/python -m main --config config-glm47.yml > /tmp/tabbyapi.log 2>&1 &
```

### Start Proxy
```bash
cd /home/ser/workspace/projects/lmvllm/scripts
nohup python3 tabby_proxy.py > /tmp/tabby_proxy.log 2>&1 &
```

### Check Health
```bash
# TabbyAPI
curl http://localhost:8000/health

# Proxy
curl http://localhost:8001/health

# GPU utilization
nvidia-smi --query-gpu=index,utilization.gpu,memory.used --format=csv
```

---

## Verification Tests

### Test Tool Calling
```bash
curl -s http://localhost:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 2203f577688173dad689c6f65884778c" \
  -d '{
    "model": "glm-4.7",
    "messages": [{"role": "user", "content": "List files in /tmp"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "list_directory",
        "description": "List files in a directory",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {"type": "string"}
          }
        }
      }
    }]
  }' | jq '.choices[0].message.tool_calls'
```

### Test GPU Parallelism
```bash
# Run generation and monitor all 8 GPUs
curl -s http://localhost:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 2203f577688173dad689c6f65884778c" \
  -d '{"model": "glm-4.7", "messages": [{"role": "user", "content": "Explain AI"}]}' > /dev/null &

watch -n 1 'nvidia-smi --query-gpu=index,utilization.gpu --format=csv,noheader | head -8'
```

---

## Logs

- TabbyAPI: `/tmp/tabbyapi.log`
- Proxy: `/tmp/tabby_proxy.log`

---

## Troubleshooting

### Out of Memory
Reduce `cache_size` or `max_seq_len` in config.

### Low GPU Utilization
Verify `tensor_parallel: true` is set in config.

### Tool Calls Not Working
Check proxy is running on port 8001 and parsing is enabled.

---

## Performance Specs

| Metric | Value |
|--------|-------|
| Context Length | 160k tokens |
| GPU Utilization | 95-98% (all 8 GPUs) |
| VRAM per GPU | ~18GB |
| KV Cache | Q4 quantized |
| Batch Size | 1 |
| Throughput | ~15-20 tokens/sec |
