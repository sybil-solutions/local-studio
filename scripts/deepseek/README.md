# DeepSeek V3.2 REAP 345B (W3A16) on 8×3090 (Ampere)

This model is **3-bit GPTQ weights + A16**, including MoE experts. Current `vLLM` / `SGLang` fused-MoE backends commonly assume MoE quantization is **4/8-bit** (e.g. `moe_wna16` / Marlin), which fails on this checkpoint.

The workaround that **does run on 8×3090** is to load the checkpoint with **Transformers + AutoGPTQ/AutoRound integration** and use `accelerate`'s `device_map` to shard across all GPUs.

## What’s here

- `scripts/deepseek/run_transformers_server.sh`: launches an OpenAI-compatible HTTP server on `:8000`
- `scripts/deepseek/transformers_server.py`: the FastAPI app (loads the model once, then serves requests)

## Requirements

- Model directory: `/home/ser/models/DeepSeek-V3.2-REAP-345B-W3A16`
- Venv with `transformers`, `auto_gptq`, `auto_round`, `accelerate`: `/opt/venvs/active/deepseek-w3a16`

## Run

```bash
scripts/deepseek/run_transformers_server.sh
```

This defaults to running in the background (writes PID to `/tmp/deepseek_w3a16_transformers_server.pid` and logs to `/tmp/deepseek_w3a16_transformers_server.log`). For foreground mode:

```bash
DEEPSEEK_FOREGROUND=1 scripts/deepseek/run_transformers_server.sh
```

### 64k context

This server enforces a max prompt length via `DEEPSEEK_MAX_CONTEXT_TOKENS` (default `65536`).

## Stop

```bash
scripts/deepseek/stop_transformers_server.sh
```

## Ensure the recipe exists (DB)

This project stores recipes in `data/controller.db`. To (re)create the DeepSeek recipe entry:

```bash
python scripts/deepseek/upsert_recipe.py
```

## Smoke test

```bash
curl -s http://127.0.0.1:8000/v1/models

curl -s http://127.0.0.1:8000/v1/chat/completions \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "deepseek-v3.2-reap-w3a16",
    "messages": [{"role":"user","content":"Say hello in one short sentence."}],
    "temperature": 0
  }' | head
```

## Notes

- The checkpoint omits `g_idx` tensors for GPTQ modules; the server zeros any present `g_idx` buffers after load to avoid non-deterministic initialization warnings.
- `device_map="auto"` + `max_memory=18GiB/GPU` is chosen to avoid tight VRAM packing on 24GB cards.
- `kv_cache_dtype=fp8` can be set in the *recipe* for bookkeeping, but this Transformers server does not currently expose a vLLM-style KV-cache dtype switch.
