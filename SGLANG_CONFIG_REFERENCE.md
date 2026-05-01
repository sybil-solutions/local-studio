# SGLang Complete Configuration Reference

> Comprehensive documentation of every configuration option in SGLang (latest version, researched 2026-05).
> Source: https://docs.sglang.io and https://github.com/sgl-project/sglang

---

## Table of Contents

1. [Server Launch](#1-server-launch)
2. [Model & Tokenizer](#2-model--tokenizer)
3. [HTTP Server](#3-http-server)
4. [Quantization & Data Type](#4-quantization--data-type)
5. [Memory & Scheduling](#5-memory--scheduling)
6. [Runtime Options](#6-runtime-options)
7. [Logging & Metrics](#7-logging--metrics)
8. [API Related](#8-api-related)
9. [Data Parallelism](#9-data-parallelism)
10. [Multi-Node Distributed Serving](#10-multi-node-distributed-serving)
11. [LoRA Serving](#11-lora-serving)
12. [Kernel Backends](#12-kernel-backends)
13. [Speculative Decoding](#13-speculative-decoding)
14. [Ngram Speculative Decoding](#14-ngram-speculative-decoding)
15. [MoE (Mixture of Experts)](#15-moe-mixture-of-experts)
16. [Mamba Cache](#16-mamba-cache)
17. [Hierarchical Cache (HiCache)](#17-hierarchical-cache-hicache)
18. [Hierarchical Sparse Attention](#18-hierarchical-sparse-attention)
19. [LMCache](#19-lmcache)
20. [KTransformers](#20-ktransformers)
21. [Diffusion LLM](#21-diffusion-llm)
22. [Offloading](#22-offloading)
23. [Optimization/Debug Options](#23-optimizationdebug-options)
24. [Dynamic Batch Tokenizer](#24-dynamic-batch-tokenizer)
25. [Debug Tensor Dumps](#25-debug-tensor-dumps)
26. [PD Disaggregation](#26-pd-disaggregation)
27. [Encode Prefill Disaggregation](#27-encode-prefill-disaggregation)
28. [Custom Weight Loader](#28-custom-weight-loader)
29. [PD-Multiplexing](#29-pd-multiplexing)
30. [Configuration File Support](#30-configuration-file-support)
31. [Multi-Modal](#31-multi-modal)
32. [Checkpoint Decryption](#32-checkpoint-decryption)
33. [Forward Hooks](#33-forward-hooks)
34. [Deprecated Arguments](#34-deprecated-arguments)
35. [Sampling Parameters (Per-Request)](#35-sampling-parameters-per-request)
36. [API Endpoints](#36-api-endpoints)
37. [Structured Outputs](#37-structured-outputs)
38. [Environment Variables](#38-environment-variables)

---

## 1. Server Launch

Launch command: `python -m sglang.launch_server [OPTIONS]`

YAML config file support via `--config config.yaml`. CLI args override config file values.

---

## 2. Model & Tokenizer

| Argument | Type | Default | Description |
|---|---|---|---|
| `--model-path` / `--model` | str | None | Path of model weights (local folder or Hugging Face repo ID) |
| `--tokenizer-path` | str | None | Path of the tokenizer |
| `--tokenizer-mode` | str | `auto` | `auto` (fast if available) or `slow` |
| `--tokenizer-backend` | str | `huggingface` | `huggingface` or `fastokens` (faster tokenization) |
| `--tokenizer-worker-num` | int | `1` | Worker count for tokenizer manager |
| `--skip-tokenizer-init` | bool | `False` | Skip init tokenizer, pass input_ids directly |
| `--load-format` | str | `auto` | Weight format: `auto`, `pt`, `safetensors`, `npcache`, `dummy`, `sharded_state`, `gguf`, `bitsandbytes`, `layered`, `flash_rl`, `remote`, `remote_instance`, `fastsafetensors`, `private`, `runai_streamer` |
| `--model-loader-extra-config` | str | `{}` | Extra config for model loader |
| `--trust-remote-code` | bool | `False` | Allow custom models from Hub |
| `--context-length` | int | None | Override max context length (default: from config.json) |
| `--is-embedding` | bool | `False` | Use CausalLM as embedding model |
| `--enable-multimodal` | bool | None | Enable multimodal functionality |
| `--revision` | str | None | Specific model version (branch/tag/commit) |
| `--model-impl` | str | `auto` | Model implementation: `auto`, `sglang`, `transformers` |

---

## 3. HTTP Server

| Argument | Type | Default | Description |
|---|---|---|---|
| `--host` | str | `127.0.0.1` | HTTP server host |
| `--port` | int | `30000` | HTTP server port |
| `--fastapi-root-path` | str | `""` | Path-based routing proxy support |
| `--grpc-mode` | bool | `False` | Use gRPC server instead of HTTP |
| `--skip-server-warmup` | bool | `False` | Skip server warmup |
| `--warmups` | str | None | Custom warmup functions (CSV) |
| `--nccl-port` | int | None | NCCL distributed port (random if unset) |
| `--checkpoint-engine-wait-weights-before-ready` | bool | `False` | Wait for initial weights before serving |

---

## 4. Quantization & Data Type

| Argument | Type | Default | Description |
|---|---|---|---|
| `--dtype` | str | `auto` | Data type: `auto`, `half`, `float16`, `bfloat16`, `float`, `float32` |
| `--quantization` | str | None | Quantization method: `awq`, `fp8`, `gptq`, `marlin`, `gptq_marlin`, `awq_marlin`, `bitsandbytes`, `gguf`, `modelopt`, `modelopt_fp8`, `modelopt_fp4`, `petit_nvfp4`, `w8a8_int8`, `w8a8_fp8`, `moe_wna16`, `qoq`, `w4afp8`, `mxfp4`, `mxfp8`, `auto-round`, `compressed-tensors`, `modelslim`, `quark_int4fp8_moe` |
| `--quantization-param-path` | str | None | Path to KV cache scaling factors JSON |
| `--kv-cache-dtype` | str | `auto` | KV cache dtype: `auto`, `fp8_e5m2`, `fp8_e4m3`, `bf16`, `bfloat16`, `fp4_e2m1` |
| `--enable-fp32-lm-head` | bool | `False` | FP32 LM head logits |
| `--modelopt-quant` | str | None | ModelOpt config: `fp8`, `int4_awq`, `w4a8_awq`, `nvfp4`, `nvfp4_awq` |
| `--modelopt-checkpoint-restore-path` | str | None | Restore ModelOpt quantized checkpoint |
| `--modelopt-checkpoint-save-path` | str | None | Save ModelOpt quantized checkpoint |
| `--modelopt-export-path` | str | None | Export quantized model in HF format |
| `--quantize-and-serve` | bool | `False` | Quantize with ModelOpt and serve immediately |
| `--rl-quant-profile` | str | None | FlashRL quantization profile path |
| `--torchao-config` | str | `""` | Torchao quantization: `int8dq`, `int8wo`, `fp8wo`, `fp8dq-per_tensor`, `fp8dq-per_row`, `int4wo-32`, `int4wo-64`, `int4wo-128`, `int4wo-256` |

### FP8 GEMM Backend (`--fp8-gemm-backend`)
Options: `auto`, `deep_gemm`, `flashinfer_trtllm`, `flashinfer_cutlass`, `flashinfer_deepgemm`, `cutlass`, `triton`, `aiter`

### FP4 GEMM Backend (`--fp4-gemm-backend`)
Options: `auto`, `flashinfer_cudnn`, `flashinfer_cutlass`, `flashinfer_trtllm`

### Platform Compatibility Matrix
| Method | NVIDIA | AMD | Ascend |
|---|---|---|---|
| `fp8` | Yes | Yes | WIP |
| `mxfp4` | Yes | Yes | WIP |
| `awq` | Yes | Yes | Yes |
| `gptq` | Yes | Yes | Yes |
| `awq_marlin` | Yes | No | No |
| `gptq_marlin` | Yes | No | No |
| `gguf` | Yes | No | Yes |
| `modelopt_fp8` | Yes (Hopper+) | No | No |
| `modelopt_fp4` | Yes (Blackwell+) | No | No |
| `petit_nvfp4` | No | Yes | No |
| `bitsandbytes` | Yes | Experimental | No |
| `compressed-tensors` | Yes | Yes | Partial |
| `modelslim` | No | No | Yes |

---

## 5. Memory & Scheduling

| Argument | Type | Default | Description |
|---|---|---|---|
| `--mem-fraction-static` | float | None | Fraction of memory for static allocation (weights + KV cache). Default 0.9 |
| `--max-running-requests` | int | None | Max concurrent running requests |
| `--max-queued-requests` | int | None | Max queued requests |
| `--max-total-tokens` | int | None | Max tokens in memory pool |
| `--chunked-prefill-size` | int | None | Max tokens per chunked prefill chunk. -1 to disable |
| `--prefill-max-requests` | int | None | Max requests in a prefill batch |
| `--enable-dynamic-chunking` | bool | `False` | Dynamic chunk sizing for pipeline parallelism |
| `--max-prefill-tokens` | int | `16384` | Max tokens in a prefill batch |
| `--schedule-policy` | str | `fcfs` | Scheduling: `lpm`, `random`, `fcfs`, `dfs-weight`, `lof`, `priority`, `routing-key` |
| `--enable-priority-scheduling` | bool | `False` | Enable priority scheduling |
| `--abort-on-priority-when-disabled` | bool | `False` | Abort priority requests when scheduling disabled |
| `--schedule-low-priority-values-first` | bool | `False` | Schedule lower priority values first |
| `--priority-scheduling-preemption-threshold` | int | `10` | Min priority diff for preemption |
| `--schedule-conservativeness` | float | `1.0` | Larger = more conservative |
| `--page-size` | int | `1` | Tokens per page |
| `--swa-full-tokens-ratio` | float | `0.8` | SWA/full KV token ratio |
| `--disable-hybrid-swa-memory` | bool | `False` | Disable hybrid SWA memory |
| `--radix-eviction-policy` | str | `lru` | `lru` or `lfu` |
| `--enable-prefill-delayer` | bool | `False` | Prefill delayer for DP attention |
| `--prefill-delayer-max-delay-passes` | int | `30` | Max forward passes to delay prefill |
| `--prefill-delayer-token-usage-low-watermark` | float | None | Token usage low watermark |
| `--prefill-delayer-forward-passes-buckets` | List[float] | None | Custom buckets for forward passes histogram |
| `--prefill-delayer-wait-seconds-buckets` | List[float] | None | Custom buckets for wait seconds histogram |

---

## 6. Runtime Options

| Argument | Type | Default | Description |
|---|---|---|---|
| `--device` | str | None | Device: `cuda`, `xpu`, `hpu`, `npu`, `cpu` |
| `--tensor-parallel-size` / `--tp-size` | int | `1` | Tensor parallelism size |
| `--pipeline-parallel-size` / `--pp-size` | int | `1` | Pipeline parallelism size |
| `--attention-context-parallel-size` / `--attn-cp-size` | int | `1` | Attention context parallelism |
| `--moe-data-parallel-size` / `--moe-dp-size` | int | `1` | MoE data parallelism |
| `--pp-max-micro-batch-size` | int | None | Max micro batch in pipeline parallelism |
| `--pp-async-batch-depth` | int | `0` | Async batch depth in pipeline parallelism |
| `--stream-interval` | int | `1` | Streaming buffer size in tokens |
| `--incremental-streaming-output` | bool | `False` | Output as disjoint segments |
| `--random-seed` | int | None | Random seed |
| `--constrained-json-whitespace-pattern` | str | None | Regex for whitespace in JSON constrained output |
| `--constrained-json-disable-any-whitespace` | bool | `False` | Compact JSON output |
| `--watchdog-timeout` | float | `300` | Forward batch timeout (seconds) |
| `--soft-watchdog-timeout` | float | None | Soft watchdog timeout for debug dumps |
| `--dist-timeout` | int | None | torch.distributed init timeout |
| `--download-dir` | str | None | HuggingFace model download directory |
| `--model-checksum` | str | None | Model file integrity verification |
| `--base-gpu-id` | int | `0` | Base GPU ID for allocation |
| `--gpu-id-step` | int | `1` | Delta between consecutive GPU IDs |
| `--sleep-on-idle` | bool | `False` | Reduce CPU usage when idle |
| `--custom-sigquit-handler` | str | None | Custom SIGQUIT handler for cleanup |

---

## 7. Logging & Metrics

| Argument | Type | Default | Description |
|---|---|---|---|
| `--log-level` | str | `info` | Logging level |
| `--log-level-http` | str | None | HTTP server log level |
| `--log-requests` | bool | `False` | Log all request metadata/inputs/outputs |
| `--log-requests-level` | int | `2` | 0=metadata, 1=+sampling_params, 2=+partial I/O, 3=full I/O |
| `--log-requests-format` | str | `text` | `text` or `json` |
| `--log-requests-target` | List[str] | None | Targets: `stdout` and/or file paths |
| `--uvicorn-access-log-exclude-prefixes` | List[str] | `[]` | Exclude uvicorn access log prefixes |
| `--crash-dump-folder` | str | None | Dump requests from last 5 min on crash |
| `--show-time-cost` | bool | `False` | Show custom mark time costs |
| `--enable-metrics` | bool | `False` | Enable Prometheus metrics |
| `--enable-mfu-metrics` | bool | `False` | Enable MFU-related metrics |
| `--enable-metrics-for-all-schedulers` | bool | `False` | Metrics on all TP ranks |
| `--tokenizer-metrics-custom-labels-header` | str | `x-custom-labels` | HTTP header for custom labels |
| `--tokenizer-metrics-allowed-custom-labels` | List[str] | None | Allowed custom label keys |
| `--bucket-time-to-first-token` | List[float] | None | TTFT histogram buckets |
| `--bucket-inter-token-latency` | List[float] | None | ITL histogram buckets |
| `--bucket-e2e-request-latency` | List[float] | None | E2E latency buckets |
| `--collect-tokens-histogram` | bool | `False` | Collect prompt/generation token histograms |
| `--prompt-tokens-buckets` | List[str] | None | Prompt token bucket rules |
| `--generation-tokens-buckets` | List[str] | None | Generation token bucket rules |
| `--gc-warning-threshold-secs` | float | `0.0` | Long GC warning threshold |
| `--decode-log-interval` | int | `40` | Decode batch log interval |
| `--enable-request-time-stats-logging` | bool | `False` | Per-request time stats |
| `--kv-events-config` | str | None | NVIDIA Dynamo KV event config (JSON) |
| `--enable-trace` | bool | `False` | Enable OpenTelemetry trace |
| `--otlp-traces-endpoint` | str | `localhost:4317` | OTLP collector endpoint |
| `--export-metrics-to-file` | bool | `False` | Export per-request metrics to file |
| `--export-metrics-to-file-dir` | str | None | Directory for metrics files |

---

## 8. API Related

| Argument | Type | Default | Description |
|---|---|---|---|
| `--api-key` | str | None | API key for server |
| `--admin-api-key` | str | None | Admin API key for control endpoints |
| `--served-model-name` | str | None | Override model name in v1/models |
| `--weight-version` | str | `default` | Model weights version identifier |
| `--chat-template` | str | None | Builtin or path to chat template |
| `--hf-chat-template-name` | str | None | Named HF chat template (e.g., `tool_use`) |
| `--completion-template` | str | None | Builtin or path to completion template |
| `--file-storage-path` | str | `sglang_storage` | Backend file storage path |
| `--enable-cache-report` | bool | `False` | Report cached tokens in prompt_tokens_details |
| `--reasoning-parser` | str | None | Parser for reasoning: `deepseek-r1`, `deepseek-v3`, `glm45`, `gpt-oss`, `kimi`, `qwen3`, `qwen3-thinking`, `step3` |
| `--tool-call-parser` | str | None | Tool-call parser: `deepseekv3`, `deepseekv31`, `glm`, `glm45`, `glm47`, `gpt-oss`, `kimi_k2`, `llama3`, `mistral`, `pythonic`, `qwen`, `qwen25`, `qwen3_coder`, `step3`, `gigachat3` |
| `--tool-server` | str | None | Tool server: `demo` or comma-separated URLs |
| `--sampling-defaults` | str | `model` | `openai` (temp=1, top_p=1) or `model` (from generation_config.json) |
| `--json-model-override-args` | str | `{}` | JSON to override model config |
| `--preferred-sampling-params` | str | None | JSON sampling settings for /get_model_info |

---

## 9. Data Parallelism

| Argument | Type | Default | Description |
|---|---|---|---|
| `--data-parallel-size` / `--dp-size` | int | `1` | Data parallelism size |
| `--load-balance-method` | str | `auto` | `auto`, `round_robin`, `follow_bootstrap_room`, `total_requests`, `total_tokens` |

---

## 10. Multi-Node Distributed Serving

| Argument | Type | Default | Description |
|---|---|---|---|
| `--dist-init-addr` / `--nccl-init-addr` | str | None | Host:port for distributed init |
| `--nnodes` | int | `1` | Number of nodes |
| `--node-rank` | int | `0` | Node rank |

---

## 11. LoRA Serving

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-lora` | bool | `False` | Enable LoRA support (auto-set if `--lora-paths` provided) |
| `--enable-lora-overlap-loading` | bool | `False` | Async LoRA weight loading (overlap H2D with compute) |
| `--max-lora-rank` | int | None | Max LoRA rank (inferred if unset) |
| `--lora-target-modules` | str | None | Target modules: `q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`, `qkv_proj`, `gate_up_proj`, `all` |
| `--lora-paths` | List[str] | None | Adapter paths: `<PATH>`, `<NAME>=<PATH>`, or JSON `{"lora_name":str,"lora_path":str,"pinned":bool}` |
| `--max-loras-per-batch` | int | `8` | Max adapters per batch (including base) |
| `--max-loaded-loras` | int | None | Max adapters in CPU memory |
| `--lora-eviction-policy` | str | `lru` | `lru` or `fifo` |
| `--lora-backend` | str | `csgmv` | `triton`, `csgmv`, `ascend`, `torch_native` |
| `--max-lora-chunk-size` | int | `16` | Chunk size for csgmv backend: `16`, `32`, `64`, `128` |

**Dynamic LoRA APIs:**
- `/load_lora_adapter` — Load adapter at runtime
- `/unload_lora_adapter` — Unload adapter at runtime
- Pinned adapters: permanently assigned to GPU slot, never evicted

---

## 12. Kernel Backends

### Attention Backend (`--attention-backend`)
Options: `triton`, `torch_native`, `flex_attention`, `nsa`, `cutlass_mla`, `fa3`, `fa4`, `flashinfer`, `flashmla`, `trtllm_mla`, `trtllm_mha`, `dual_chunk_flash_attn`, `aiter`, `wave`, `intel_amx`, `ascend`

- `--prefill-attention-backend` — Override for prefill stage
- `--decode-attention-backend` — Override for decode stage
- `--mm-attention-backend` — Multimodal attention: `sdpa`, `fa3`, `fa4`, `triton_attn`, `ascend_attn`, `aiter_attn`

### NSA Backend
- `--nsa-prefill-backend`: `flashmla_sparse`, `flashmla_kv`, `flashmla_auto`, `fa3`, `tilelang`, `aiter`, `trtllm` (default: `flashmla_sparse`)
- `--nsa-decode-backend`: Same options (default: `fa3`)

### Sampling Backend (`--sampling-backend`)
Options: `flashinfer`, `pytorch`, `ascend`

### Grammar Backend (`--grammar-backend`)
Options: `xgrammar` (default), `outlines`, `llguidance`, `none`

### GEMM Backends
- `--fp8-gemm-backend`: `auto`, `deep_gemm`, `flashinfer_trtllm`, `flashinfer_cutlass`, `flashinfer_deepgemm`, `cutlass`, `triton`, `aiter`
- `--fp4-gemm-backend`: `auto`, `flashinfer_cudnn`, `flashinfer_cutlass`, `flashinfer_trtllm`
- `--disable-flashinfer-autotune`: Disable FlashInfer autotune

---

## 13. Speculative Decoding

| Argument | Type | Default | Description |
|---|---|---|---|
| `--speculative-algorithm` | str | None | `EAGLE`, `EAGLE3`, `NEXTN`, `STANDALONE`, `NGRAM` |
| `--speculative-draft-model-path` | str | None | Draft model path |
| `--speculative-draft-model-revision` | str | None | Draft model version |
| `--speculative-draft-load-format` | str | None | Draft model load format |
| `--speculative-num-steps` | int | None | Draft model sampling steps |
| `--speculative-eagle-topk` | int | None | Top-k tokens per EAGLE2 step |
| `--speculative-num-draft-tokens` | int | None | Draft tokens count |
| `--speculative-accept-threshold-single` | float | `1.0` | Single token acceptance threshold |
| `--speculative-accept-threshold-acc` | float | `1.0` | Accumulated acceptance threshold |
| `--speculative-token-map` | str | None | Small vocab table path |
| `--speculative-attention-mode` | str | `prefill` | `prefill` or `decode` |
| `--speculative-draft-attention-backend` | str | None | Attention backend for drafting |
| `--speculative-moe-runner-backend` | str | None | MoE backend for EAGLE |
| `--speculative-moe-a2a-backend` | str | None | MoE A2A backend for EAGLE |
| `--speculative-draft-model-quantization` | str | None | Quantization for speculative model |
| `--enable-multi-layer-eagle` | bool | `False` | Multi-layer Eagle speculative decoding |

---

## 14. Ngram Speculative Decoding

| Argument | Type | Default | Description |
|---|---|---|---|
| `--speculative-ngram-min-bfs-breadth` | int | `1` | Min BFS breadth |
| `--speculative-ngram-max-bfs-breadth` | int | `10` | Max BFS breadth |
| `--speculative-ngram-match-type` | str | `BFS` | `BFS` or `PROB` |
| `--speculative-ngram-max-trie-depth` | int | `18` | Max suffix length in ngram trie |
| `--speculative-ngram-capacity` | int | `10000000` | Cache capacity |

---

## 15. MoE (Mixture of Experts)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--expert-parallel-size` / `--ep-size` | int | `1` | Expert parallelism |
| `--moe-a2a-backend` | str | `none` | All-to-all backend: `none`, `deepep`, `mooncake`, `mori`, `nixl`, `ascend_fuseep` |
| `--moe-runner-backend` | str | `auto` | Runner: `auto`, `deep_gemm`, `triton`, `triton_kernel`, `flashinfer_trtllm`, `flashinfer_trtllm_routed`, `flashinfer_cutlass`, `flashinfer_mxfp4`, `flashinfer_cutedsl`, `cutlass` |
| `--flashinfer-mxfp4-moe-precision` | str | `default` | `default` or `bf16` |
| `--enable-flashinfer-allreduce-fusion` | bool | `False` | FlashInfer allreduce fusion with Residual RMSNorm |
| `--enable-aiter-allreduce-fusion` | bool | `False` | Aiter allreduce fusion |
| `--deepep-mode` | str | `auto` | `normal`, `low_latency`, `auto` |
| `--ep-num-redundant-experts` | int | `0` | Redundant experts in EP |
| `--ep-dispatch-algorithm` | str | None | Dispatch algorithm for redundant experts |
| `--init-expert-location` | str | `trivial` | Initial EP expert location |
| `--enable-eplb` | bool | `False` | Enable EPLB algorithm |
| `--eplb-algorithm` | str | `auto` | EPLB algorithm choice |
| `--eplb-rebalance-num-iterations` | int | `1000` | Auto-rebalance iterations |
| `--eplb-rebalance-layers-per-chunk` | int | None | Layers per rebalance chunk |
| `--eplb-min-rebalancing-utilization-threshold` | float | `1.0` | Min utilization threshold [0.0, 1.0] |
| `--expert-distribution-recorder-mode` | str | None | Expert distribution recorder mode |
| `--expert-distribution-recorder-buffer-size` | int | None | Circular buffer size (-1 = infinite) |
| `--enable-expert-distribution-metrics` | bool | `False` | Log expert balance metrics |
| `--deepep-config` | str | None | DeepEP config (JSON string or file path) |
| `--moe-dense-tp-size` | int | `none` | TP size for MoE dense MLP layers |
| `--elastic-ep-backend` | str | `none` | `none` or `mooncake` |
| `--enable-elastic-expert-backup` | bool | `False` | Backup expert weights in DRAM |
| `--mooncake-ib-device` | str | None | InfiniBand devices for Mooncake |
| `--multi-item-scoring-delimiter` | int | None | Delimiter token ID for multi-item scoring |

---

## 16. Mamba Cache

| Argument | Type | Default | Description |
|---|---|---|---|
| `--max-mamba-cache-size` | int | None | Max mamba cache size |
| `--mamba-ssm-dtype` | str | `float32` | `float32`, `bfloat16`, `float16` |
| `--mamba-full-memory-ratio` | float | `0.9` | Mamba state to full KV cache ratio |
| `--mamba-scheduler-strategy` | str | `auto` | `auto`, `no_buffer`, `extra_buffer` |
| `--mamba-track-interval` | int | `256` | Token interval for mamba state tracking |

---

## 17. Hierarchical Cache (HiCache)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-hierarchical-cache` | bool | `False` | Enable hierarchical cache |
| `--hicache-ratio` | float | `2.0` | Host/device KV cache ratio |
| `--hicache-size` | int | `0` | Host KV cache size in GB (overrides ratio) |
| `--hicache-write-policy` | str | `write_through` | `write_back`, `write_through`, `write_through_selective` |
| `--hicache-io-backend` | str | `kernel` | `direct`, `kernel`, `kernel_ascend` |
| `--hicache-mem-layout` | str | `layer_first` | `layer_first`, `page_first`, `page_first_direct`, `page_first_kv_split`, `page_head` |
| `--hicache-storage-backend` | str | None | `file`, `mooncake`, `hf3fs`, `nixl`, `aibrix`, `dynamic`, `eic` |
| `--hicache-storage-prefetch-policy` | str | `best_effort` | `best_effort`, `wait_complete`, `timeout` |
| `--hicache-storage-backend-extra-config` | str | None | Extra config (JSON or @file) |

---

## 18. Hierarchical Sparse Attention

| Argument | Type | Default | Description |
|---|---|---|---|
| `--hierarchical-sparse-attention-extra-config` | str | None | JSON config with `algorithm`, `backend`, and algorithm-specific fields |

---

## 19. LMCache

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-lmcache` | bool | `False` | Use LMCache as alternative hierarchical cache |

---

## 20. KTransformers

| Argument | Type | Default | Description |
|---|---|---|---|
| `--kt-weight-path` | str | None | Quantized expert weights path (local) |
| `--kt-method` | str | `AMXINT4` | Quantization format for CPU |
| `--kt-cpuinfer` | int | None | CPUInfer thread count |
| `--kt-threadpool-count` | int | `2` | Thread pools (one per NUMA node) |
| `--kt-num-gpu-experts` | int | None | Number of GPU experts |
| `--kt-max-deferred-experts-per-token` | int | None | Max CPU-deferred experts per token |

---

## 21. Diffusion LLM

| Argument | Type | Default | Description |
|---|---|---|---|
| `--dllm-algorithm` | str | None | Diffusion LLM algorithm (e.g., `LowConfidence`) |
| `--dllm-algorithm-config` | str | None | Algorithm config (YAML file) |

---

## 22. Offloading

| Argument | Type | Default | Description |
|---|---|---|---|
| `--cpu-offload-gb` | int | `0` | GB of RAM for CPU offloading |
| `--offload-group-size` | int | `-1` | Layers per group |
| `--offload-num-in-group` | int | `1` | Layers to offload per group |
| `--offload-prefetch-step` | int | `1` | Prefetch steps |
| `--offload-mode` | str | `cpu` | Offloading mode |

---

## 23. Optimization/Debug Options

| Argument | Type | Default | Description |
|---|---|---|---|
| `--disable-radix-cache` | bool | `False` | Disable RadixAttention prefix caching |
| `--cuda-graph-max-bs` | int | None | Extend CUDA graph max batch size |
| `--cuda-graph-bs` | List[int] | None | Custom list of CUDA graph batch sizes |
| `--disable-cuda-graph` | bool | `False` | Disable CUDA graph |
| `--disable-cuda-graph-padding` | bool | `False` | Disable CUDA graph when padding needed |
| `--enable-profile-cuda-graph` | bool | `False` | Profile CUDA graph capture |
| `--enable-cudagraph-gc` | bool | `False` | Enable GC during CUDA graph capture |
| `--enable-layerwise-nvtx-marker` | bool | `False` | NVTX markers per layer (Nsight) |
| `--enable-nccl-nvls` | bool | `False` | Enable NCCL NVLS for prefill |
| `--enable-symm-mem` | bool | `False` | Enable NCCL symmetric memory |
| `--disable-flashinfer-cutlass-moe-fp4-allgather` | bool | `False` | Disable quantize before all-gather |
| `--enable-tokenizer-batch-encode` | bool | `False` | Batch tokenization |
| `--disable-tokenizer-batch-decode` | bool | `False` | Disable batch decoding |
| `--disable-outlines-disk-cache` | bool | `False` | Disable outlines disk cache |
| `--disable-custom-all-reduce` | bool | `False` | Fall back to NCCL |
| `--enable-mscclpp` | bool | `False` | Use mscclpp for small messages |
| `--enable-torch-symm-mem` | bool | `False` | Use torch symm mem for all-reduce |
| `--disable-overlap-schedule` | bool | `False` | Disable overlap scheduler |
| `--enable-mixed-chunk` | bool | `False` | Mix prefill and decode in chunked prefill |
| `--enable-dp-attention` | bool | `False` | Data parallel attention + TP for FFN |
| `--enable-dp-lm-head` | bool | `False` | Vocab parallel across attention TP group |
| `--enable-two-batch-overlap` | bool | `False` | Overlap two micro batches |
| `--enable-single-batch-overlap` | bool | `False` | Overlap compute/comm within one batch |
| `--tbo-token-distribution-threshold` | float | `0.48` | Two-batch overlap threshold |
| `--enable-torch-compile` | bool | `False` | Optimize with torch.compile |
| `--enable-torch-compile-debug-mode` | bool | `False` | Debug mode for torch compile |
| `--disable-piecewise-cuda-graph` | bool | `False` | Disable piecewise CUDA graph |
| `--enforce-piecewise-cuda-graph` | bool | `False` | Force piecewise CUDA graph |
| `--piecewise-cuda-graph-tokens` | JSON list | None | Token list for piecewise CUDA graph |
| `--piecewise-cuda-graph-compiler` | str | `eager` | `eager` or `inductor` |
| `--torch-compile-max-bs` | int | `32` | Max batch for torch compile |
| `--piecewise-cuda-graph-max-tokens` | int | `4096` | Max tokens for piecewise CUDA graph |
| `--enable-nan-detection` | bool | `False` | NaN detection for debugging |
| `--enable-p2p-check` | bool | `False` | Enable P2P GPU access check |
| `--triton-attention-reduce-in-fp32` | bool | `False` | FP32 intermediate attention (Triton) |
| `--triton-attention-num-kv-splits` | int | `8` | KV splits in flash decoding Triton |
| `--triton-attention-split-tile-size` | int | None | Split KV tile size for deterministic inference |
| `--num-continuous-decode-steps` | int | `1` | Multiple decode steps per schedule |
| `--delete-ckpt-after-loading` | bool | `False` | Delete checkpoint after loading |
| `--enable-memory-saver` | bool | `False` | Allow save/release memory occupation |
| `--enable-weights-cpu-backup` | bool | `False` | Save model weights to CPU during release |
| `--enable-draft-weights-cpu-backup` | bool | `False` | Save draft model weights to CPU |
| `--allow-auto-truncate` | bool | `False` | Auto-truncate overlength requests |
| `--enable-custom-logit-processor` | bool | `False` | Allow custom logit processors |
| `--flashinfer-mla-disable-ragged` | bool | `False` | Disable ragged prefill for flashinfer MLA |
| `--disable-shared-experts-fusion` | bool | `False` | Disable shared experts fusion (DeepSeek) |
| `--disable-chunked-prefix-cache` | bool | `False` | Disable chunked prefix cache (DeepSeek) |
| `--disable-fast-image-processor` | bool | `False` | Use base image processor |
| `--keep-mm-feature-on-device` | bool | `False` | Keep multimodal features on device |
| `--enable-return-hidden-states` | bool | `False` | Return hidden states |
| `--enable-return-routed-experts` | bool | `False` | Return routed experts (MoE) |
| `--scheduler-recv-interval` | int | `1` | Poll interval for scheduler |
| `--numa-node` | List[int] | None | NUMA node per subprocess |
| `--enable-deterministic-inference` | bool | `False` | Deterministic + batch invariant ops |
| `--rl-on-policy-target` | str | None | `fsdp` — training system matching |
| `--enable-attn-tp-input-scattered` | bool | `False` | Scattered attention input for TP |
| `--enable-nsa-prefill-context-parallel` | bool | `False` | Context parallelism for DeepSeek V3.2 |
| `--nsa-prefill-cp-mode` | str | `in-seq-split` | `in-seq-split` or `round-robin-split` |
| `--enable-fused-qk-norm-rope` | bool | `False` | Fused QK normalization + RoPE |
| `--enable-precise-embedding-interpolation` | bool | `False` | Corner alignment for embedding resize |
| `--enable-msprobe-dump-config` | str | None | msProbe dump config path |

---

## 24. Dynamic Batch Tokenizer

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-dynamic-batch-tokenizer` | bool | `False` | Async dynamic batch tokenizer |
| `--dynamic-batch-tokenizer-batch-size` | int | `32` | Max batch size |
| `--dynamic-batch-tokenizer-batch-timeout` | float | `0.002` | Batching timeout (seconds) |

---

## 25. Debug Tensor Dumps

| Argument | Type | Default | Description |
|---|---|---|---|
| `--debug-tensor-dump-output-folder` | str | None | Output folder for tensor dumps |
| `--debug-tensor-dump-layers` | JSON list | None | Layer IDs to dump |
| `--debug-tensor-dump-input-file` | str | None | Input filename |
| `--debug-tensor-dump-inject` | str | `False` | Inject outputs from JAX |

---

## 26. PD Disaggregation

| Argument | Type | Default | Description |
|---|---|---|---|
| `--disaggregation-mode` | str | `null` | `null`, `prefill`, `decode` |
| `--disaggregation-transfer-backend` | str | `mooncake` | `mooncake`, `nixl`, `ascend`, `fake` |
| `--disaggregation-bootstrap-port` | int | `8998` | Bootstrap server port on prefill server |
| `--disaggregation-ib-device` | str | None | InfiniBand devices (comma-separated) |
| `--disaggregation-decode-enable-offload-kvcache` | bool | `False` | Async KV cache offloading on decode server |
| `--num-reserved-decode-tokens` | int | `512` | Reserved decode tokens per new request |
| `--disaggregation-decode-polling-interval` | int | `1` | Polling interval for decode server |

---

## 27. Encode Prefill Disaggregation

| Argument | Type | Default | Description |
|---|---|---|---|
| `--encoder-only` | bool | `False` | Launch encoder-only server (MLLM) |
| `--language-only` | bool | `False` | Load language model weights only (VLM) |
| `--encoder-transfer-backend` | str | `zmq_to_scheduler` | `zmq_to_scheduler`, `zmq_to_tokenizer`, `mooncake` |
| `--encoder-urls` | JSON list | `[]` | List of encoder server URLs |

---

## 28. Custom Weight Loader

| Argument | Type | Default | Description |
|---|---|---|---|
| `--custom-weight-loader` | List[str] | None | Custom dataloader import path |
| `--weight-loader-disable-mmap` | bool | `False` | Disable mmap for safetensors |
| `--weight-loader-prefetch-checkpoints` | bool | `False` | Prefetch into OS page cache |
| `--weight-loader-prefetch-num-threads` | int | `4` | Threads per rank for prefetch |
| `--remote-instance-weight-loader-seed-instance-ip` | str | None | Seed instance IP |
| `--remote-instance-weight-loader-seed-instance-service-port` | int | None | Seed instance port |
| `--remote-instance-weight-loader-send-weights-group-ports` | JSON list | None | Communication ports |
| `--remote-instance-weight-loader-backend` | str | `nccl` | `transfer_engine` or `nccl` |
| `--remote-instance-weight-loader-start-seed-via-transfer-engine` | bool | `False` | Start seed via transfer engine |

---

## 29. PD-Multiplexing

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-pdmux` | bool | `False` | Enable PD-Multiplexing on greenctx stream |
| `--pdmux-config-path` | str | None | Config file path |
| `--sm-group-num` | int | `8` | SM partition groups |

---

## 30. Configuration File Support

| Argument | Type | Default | Description |
|---|---|---|---|
| `--config` | str | None | YAML config file path |

---

## 31. Multi-Modal

| Argument | Type | Default | Description |
|---|---|---|---|
| `--mm-max-concurrent-calls` | int | `32` | Max concurrent async MM data processing |
| `--mm-per-request-timeout` | int | `10.0` | Per-request MM timeout (seconds) |
| `--enable-broadcast-mm-inputs-process` | bool | `False` | Broadcast MM inputs in scheduler |
| `--mm-process-config` | JSON | `{}` | MM preprocessing config (`image`, `video`, `audio`) |
| `--mm-enable-dp-encoder` | bool | `False` | DP for MM encoder (auto tp size) |
| `--limit-mm-data-per-request` | JSON | None | Limit MM inputs per request (e.g., `{"image": 1, "video": 1}`) |
| `--enable-mm-global-cache` | bool | `False` | Mooncake-backed global MM embedding cache |

---

## 32. Checkpoint Decryption

| Argument | Type | Default | Description |
|---|---|---|---|
| `--decrypted-config-file` | str | None | Decrypted config file path |
| `--decrypted-draft-config-file` | str | None | Decrypted draft config file path |
| `--enable-prefix-mm-cache` | bool | `False` | Prefix multimodal cache |

---

## 33. Forward Hooks

| Argument | Type | Default | Description |
|---|---|---|---|
| `--forward-hooks` | JSON list | None | Hook specs with `target_modules`, `hook_factory`, optional `name`, `config` |

---

## 34. Deprecated Arguments

| Argument | Note |
|---|---|
| `--enable-ep-moe` | Use `--ep-size` = `--tp-size` |
| `--enable-deepep-moe` | Use `--moe-a2a-backend deepep` |
| `--prefill-round-robin-balance` | Deprecated |
| `--enable-flashinfer-cutlass-moe` | Use `--moe-runner-backend flashinfer_cutlass` |
| `--enable-flashinfer-cutedsl-moe` | Use `--moe-runner-backend flashinfer_cutedsl` |
| `--enable-flashinfer-trtllm-moe` | Use `--moe-runner-backend flashinfer_trtllm` |
| `--enable-triton-kernel-moe` | Use `--moe-runner-backend triton_kernel` |
| `--enable-flashinfer-mxfp4-moe` | Use `--moe-runner-backend flashinfer_mxfp4` |
| `--crash-on-nan` | Use watchdog instead |
| `--hybrid-kvcache-ratio` | Removed |
| `--load-watch-interval` | Removed |
| `--nsa-prefill` / `--nsa-decode` | Use `--nsa-prefill-backend` / `--nsa-decode-backend` |

---

## 35. Sampling Parameters (Per-Request)

These are passed in request bodies, not server flags.

### `/generate` Endpoint Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `text` | str/List[str] | None | Input prompt(s) |
| `input_ids` | List[int]/List[List[int]] | None | Token IDs |
| `input_embeds` | List[float]... | None | Input embeddings |
| `image_data` | Various | None | Image: file path, URL, base64, processor output, precomputed embedding |
| `audio_data` | Various | None | Audio: file, URL, base64 |
| `sampling_params` | Dict/List[Dict] | None | Sampling config (see below) |
| `rid` | str/List[str] | None | Request ID |
| `return_logprob` | bool/List[bool] | None | Return log probabilities |
| `logprob_start_len` | int/List[int] | None | Start position for logprobs (-1 = output only) |
| `top_logprobs_num` | int/List[int] | None | Top logprobs per position |
| `token_ids_logprob` | List[int] | None | Token IDs for logprob |
| `return_text_in_logprobs` | bool | `False` | Detokenize tokens in logprobs |
| `stream` | bool | `False` | Stream output |
| `lora_path` | str/List[str] | None | LoRA adapter path |
| `custom_logit_processor` | str | None | Serialized CustomLogitProcessor |
| `return_hidden_states` | bool | `False` | Return hidden states |
| `return_routed_experts` | bool | `False` | Return MoE expert routing |

### Sampling Parameters Object

| Parameter | Type | Default | Description |
|---|---|---|---|
| `max_new_tokens` | int | `128` | Max output tokens |
| `stop` | str/List[str] | None | Stop words |
| `stop_token_ids` | List[int] | None | Stop token IDs |
| `stop_regex` | str/List[str] | None | Regex stop patterns |
| `temperature` | float | model default (1.0) | Sampling temperature (0 = greedy) |
| `top_p` | float | model default (1.0) | Top-p (nucleus) sampling |
| `top_k` | int | model default (-1) | Top-k sampling |
| `min_p` | float | model default (0.0) | Min-p sampling |
| `frequency_penalty` | float | `0.0` | Frequency penalty [-2, 2] |
| `presence_penalty` | float | `0.0` | Presence penalty [-2, 2] |
| `repetition_penalty` | float | `1.0` | Repetition penalty [0, 2] |
| `min_new_tokens` | int | `0` | Force minimum output tokens |
| `json_schema` | str | None | JSON schema for structured output |
| `regex` | str | None | Regex for structured output |
| `ebnf` | str | None | EBNF for structured output |
| `structural_tag` | str | None | Structural tag for structured output |
| `n` | int | `1` | Number of completions per request |
| `ignore_eos` | bool | `False` | Don't stop on EOS |
| `skip_special_tokens` | bool | `True` | Remove special tokens |
| `spaces_between_special_tokens` | bool | `True` | Add spaces between special tokens |
| `no_stop_trim` | bool | `False` | Don't trim stop words/EOS |
| `custom_params` | List[Dict] | None | Custom params for CustomLogitProcessor |

### OpenAI-Compatible Parameters (Chat/Completions)

Full OpenAI API compatibility:
- `model`, `messages`, `prompt`
- `temperature`, `top_p`, `n`, `stream`
- `stop`, `max_tokens` (maps to `max_new_tokens`)
- `presence_penalty`, `frequency_penalty`
- `logit_bias` (token_id → bias value, -100 to 100)
- `seed`, `response_format`
- `logprobs`, `top_logprobs`
- `extra_body` for SGLang extensions:
  - `chat_template_kwargs` — Template arguments (e.g., `enable_thinking`, `thinking`)
  - `separate_reasoning` — Separate reasoning content
  - `custom_logit_processor`
  - `custom_params`
  - `ebnf`, `regex`
  - `lora_path`
  - `return_routed_experts`

---

## 36. API Endpoints

### OpenAI-Compatible Endpoints
- `POST /v1/chat/completions` — Chat completions
- `POST /v1/completions` — Text completions
- `POST /v1/embeddings` — Embeddings (requires `--is-embedding`)
- `GET /v1/models` — List models
- `POST /v1/rerank` — Cross-encoder reranking (requires `--is-embedding`)
- `POST /v1/score` — Decoder-only scoring

### Native SGLang Endpoints
- `POST /generate` — Text generation (native)
- `GET /get_model_info` — Model info
- `GET /server_info` — Server info (CLI args, token limits, memory pool)
- `GET /health` — Health check
- `GET /health_generate` — Health check with token generation
- `POST /flush_cache` — Flush radix cache (query param: `timeout`)
- `POST /update_weights_from_disk` — Hot-swap weights
- `POST /encode` — Embeddings (native, requires `--is-embedding`)
- `POST /classify` — Reward model classification
- `POST /tokenize` — Tokenize text
- `POST /detokenize` — Detokenize IDs
- `POST /start_expert_distribution_record` — Start MoE expert recording
- `POST /stop_expert_distribution_record` — Stop recording
- `POST /dump_expert_distribution_record` — Dump expert data
- `POST /load_lora_adapter` — Dynamic LoRA loading
- `POST /unload_lora_adapter` — Dynamic LoRA unloading

### Ollama-Compatible
- `POST /api/chat` — Ollama chat
- `POST /api/generate` — Ollama generate

---

## 37. Structured Outputs

### Grammar Backends (`--grammar-backend`)
| Backend | JSON Schema | Regex | EBNF | Notes |
|---|---|---|---|---|
| `xgrammar` (default) | Yes | Yes | Yes | GGML BNF format |
| `outlines` | Yes | Yes | No | |
| `llguidance` | Yes | Yes | Yes | |

### Constrained Decoding Options
- `response_format` (OpenAI API): `{"type": "json_schema", "json_schema": {...}}`
- `response_format` (structural tag): `{"type": "structural_tag", "structures": [...], "triggers": [...]}`
- `extra_body.regex` — Regex constraint
- `extra_body.ebnf` — EBNF grammar
- Server flags:
  - `--constrained-json-whitespace-pattern` — Regex for whitespace in JSON
  - `--constrained-json-disable-any-whitespace` — Compact JSON

### Reasoning Parser (`--reasoning-parser`)
| Parser | Models |
|---|---|
| `deepseek-r1` | DeepSeek-R1, R1-0528, R1-Distill |
| `deepseek-v3` | DeepSeek-V3.1 |
| `qwen3` | Qwen3 (hybrid thinking) |
| `qwen3-thinking` | Qwen3-Thinking (always thinks) |
| `kimi` | Kimi thinking models |
| `gpt-oss` | Gpt-Oss thinking models |
| `glm45` | GLM-4.5 |
| `step3` | Step3 models |

---

## 38. Environment Variables

SGLang uses `SGL_` and `SGLANG_` prefixes.

### General Configuration
| Variable | Default | Description |
|---|---|---|
| `SGLANG_USE_MODELSCOPE` | `false` | Use ModelScope models |
| `SGLANG_HOST_IP` | `0.0.0.0` | Server host IP |
| `SGLANG_PORT` | auto | Server port |
| `SGLANG_LOGGING_CONFIG_PATH` | - | Custom logging config |
| `SGLANG_DISABLE_REQUEST_LOGGING` | `false` | Disable request logging |
| `SGLANG_LOG_REQUEST_HEADERS` | - | Additional HTTP headers to log |
| `SGLANG_HEALTH_CHECK_TIMEOUT` | `20` | Health check timeout (s) |
| `SGLANG_FORWARD_UNKNOWN_TOOLS` | `false` | Forward unknown tool calls |
| `SGLANG_REQ_WAITING_TIMEOUT` | `-1` | Queue wait timeout (s) |
| `SGLANG_REQ_RUNNING_TIMEOUT` | `-1` | Running request timeout (s) |
| `SGLANG_CACHE_DIR` | `~/.cache/sglang` | Cache directory |
| `SGLANG_PREFETCH_BLOCK_SIZE_MB` | `16` | Prefetch block size |

### Performance Tuning
| Variable | Default | Description |
|---|---|---|
| `SGLANG_ENABLE_TORCH_INFERENCE_MODE` | `false` | Use torch.inference_mode |
| `SGLANG_ENABLE_TORCH_COMPILE` | `false` | Enable torch.compile |
| `SGLANG_SET_CPU_AFFINITY` | `false` | Set CPU affinity |
| `SGLANG_ALLOW_OVERWRITE_LONGER_CONTEXT_LEN` | `false` | Allow overwriting context length |
| `SGLANG_IS_FLASHINFER_AVAILABLE` | `true` | FlashInfer availability |
| `SGLANG_SKIP_P2P_CHECK` | `false` | Skip P2P check |
| `SGLANG_CHUNKED_PREFIX_CACHE_THRESHOLD` | `8192` | Chunked prefix cache threshold |
| `SGLANG_FUSED_MLA_ENABLE_ROPE_FUSION` | `1` | RoPE fusion in fused MLA |
| `SGLANG_DISABLE_CONSECUTIVE_PREFILL_OVERLAP` | `false` | Disable prefill overlap |
| `SGLANG_SCHEDULER_MAX_RECV_PER_POLL` | `-1` | Max requests per poll |
| `SGLANG_DISABLE_FA4_WARMUP` | `false` | Disable FA4 warmup |
| `SGLANG_DATA_PARALLEL_BUDGET_INTERVAL` | `1` | DPBudget update interval |
| `SGLANG_MM_BUFFER_SIZE_MB` | `0` | GPU buffer for MM feature hashing |
| `SGLANG_MM_PRECOMPUTE_HASH` | `false` | Precompute MM data hashes |
| `SGLANG_USE_SGL_FA3_KERNEL` | `true` | Use sgl-kernel for FA3 |

### DeepGEMM Configuration
| Variable | Default | Description |
|---|---|---|
| `SGLANG_ENABLE_JIT_DEEPGEMM` | `true` | Enable JIT DeepGEMM |
| `SGLANG_JIT_DEEPGEMM_PRECOMPILE` | `true` | Precompile DeepGEMM kernels |
| `SGLANG_JIT_DEEPGEMM_COMPILE_WORKERS` | `4` | Parallel compilation workers |
| `SGLANG_DG_CACHE_DIR` | `~/.cache/deep_gemm` | DeepGEMM cache directory |
| `SGLANG_DG_USE_NVRTC` | `false` | Use NVRTC for JIT |
| `SGLANG_USE_DEEPGEMM_BMM` | `false` | DeepGEMM for batched matmul |
| `SGLANG_JIT_DEEPGEMM_FAST_WARMUP` | `false` | Fast warmup (reduced kernels) |

### DeepEP Configuration
| Variable | Default | Description |
|---|---|---|
| `SGLANG_DEEPEP_BF16_DISPATCH` | `false` | BF16 for dispatch |
| `SGLANG_DEEPEP_NUM_MAX_DISPATCH_TOKENS_PER_RANK` | `128` | Max dispatched tokens per rank |
| `SGLANG_DEEPEP_LL_COMBINE_SEND_NUM_SMS` | `32` | SMs for DeepEP combine |

### MORI Configuration
| Variable | Default | Description |
|---|---|---|
| `SGLANG_MORI_DISPATCH_DTYPE` | `auto` | Dispatch quantization: `auto`, `bf16`, `fp8`, `fp4` |
| `SGLANG_MORI_FP8_COMB` | `false` | FP8 for combine |
| `SGLANG_MORI_NUM_MAX_DISPATCH_TOKENS_PER_RANK` | `4096` | Max dispatch tokens per rank |
| `SGLANG_MORI_QP_PER_TRANSFER` | `1` | RDMA queue pairs per transfer |
| `SGLANG_MORI_NUM_WORKERS` | `1` | RDMA worker threads |

### NSA Backend (DeepSeek V3.2)
| Variable | Default | Description |
|---|---|---|
| `SGLANG_NSA_FUSE_TOPK` | `true` | Fuse topk logits+indices |
| `SGLANG_NSA_ENABLE_MTP_PRECOMPUTE_METADATA` | `true` | Precompute MTP metadata |
| `SGLANG_USE_FUSED_METADATA_COPY` | `true` | Fused metadata copy kernel |

### Memory Management
| Variable | Default | Description |
|---|---|---|
| `SGLANG_DEBUG_MEMORY_POOL` | `false` | Memory pool debugging |
| `SGLANG_CLIP_MAX_NEW_TOKENS_ESTIMATION` | `4096` | Clip token estimation |
| `SGLANG_ENABLE_TP_MEMORY_INBALANCE_CHECK` | `true` | TP memory imbalance check |
| `SGLANG_MOONCAKE_CUSTOM_MEM_POOL` | None | Mooncake memory pool: `NVLINK`, `BAREX`, `INTRA_NODE_NVLINK` |

### Quantization
| Variable | Default | Description |
|---|---|---|
| `SGLANG_INT4_WEIGHT` | `false` | Enable INT4 weight quantization |
| `SGLANG_FORCE_FP8_MARLIN` | `false` | Force FP8 MARLIN kernels |
| `SGLANG_NVFP4_CKPT_FP8_GEMM_IN_ATTN` | `false` | FP8 for attention on NVFP4 checkpoint |
| `SGLANG_MOE_NVFP4_DISPATCH` | `false` | NVFP4 for MoE dispatch |
| `SGLANG_QUANT_ALLOW_DOWNCASTING` | `false` | Allow weight dtype downcasting |
| `SGLANG_FP8_IGNORED_LAYERS` | `""` | Comma-separated layers to skip in FP8 |

### Distributed Computing
| Variable | Default | Description |
|---|---|---|
| `SGLANG_BLOCK_NONZERO_RANK_CHILDREN` | `1` | Block non-zero rank children |
| `SGLANG_IS_FIRST_RANK_ON_NODE` | `true` | First rank on node indicator |
| `SGLANG_PP_LAYER_PARTITION` | - | Pipeline parallel layer partition |
| `SGLANG_ONE_VISIBLE_DEVICE_PER_PROCESS` | `false` | One device per process |

### PD Disaggregation
| Variable | Default | Description |
|---|---|---|
| `SGLANG_DISAGG_STAGING_BUFFER` | `false` | GPU staging buffer for heterogeneous TP |
| `SGLANG_DISAGG_STAGING_BUFFER_SIZE_MB` | `64` | Prefill staging buffer size |
| `SGLANG_DISAGG_STAGING_POOL_SIZE_MB` | `4096` | Decode ring buffer size |
| `SGLANG_STAGING_USE_TORCH` | `false` | Use PyTorch fallback for staging |

### Function Calling / Tool Use
| Variable | Default | Description |
|---|---|---|
| `SGLANG_TOOL_STRICT_LEVEL` | `0` | 0=off, 1=function strict, 2=parameter strict |

### Profiling & Benchmarking
| Variable | Default | Description |
|---|---|---|
| `SGLANG_TORCH_PROFILER_DIR` | `/tmp` | PyTorch profiler output dir |
| `SGLANG_PROFILE_WITH_STACK` | `true` | Capture stack traces |
| `SGLANG_PROFILE_RECORD_SHAPES` | `true` | Record tensor shapes |

### Storage & Caching
| Variable | Default | Description |
|---|---|---|
| `SGLANG_WAIT_WEIGHTS_READY_TIMEOUT` | `120` | Weights wait timeout |
| `SGLANG_DISABLE_OUTLINES_DISK_CACHE` | `false` | Disable outlines disk cache |
| `SGLANG_USE_CUSTOM_TRITON_KERNEL_CACHE` | `false` | Custom Triton kernel cache |
| `SGLANG_HICACHE_DECODE_OFFLOAD_STRIDE` | - | Decode KV offload stride |

---

*Document generated from SGLang official documentation at https://docs.sglang.io (researched 2026-05-01)*
*For the most up-to-date information, consult `python3 -m sglang.launch_server --help` and https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/server_args.py*
