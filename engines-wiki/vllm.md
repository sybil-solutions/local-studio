# vLLM

vLLM is a high-throughput, memory-efficient inference and serving engine for large language models (LLMs). It powers production deployments with features like PagedAttention for efficient KV cache management, continuous batching, speculative decoding, tensor/pipeline/data/expert parallelism, structured output, multimodal support, and an OpenAI-compatible API server. The latest version (v0.20.x+) introduces Decode Context Parallel (DCP), Prefill Context Parallel (PCP), Dual Batch Overlap, elastic expert parallelism, FP8/FP4 quantization, and a unified V1 architecture.

## Quick Start

Launch the OpenAI-compatible server with a single command:

```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct --tensor-parallel-size 2 --gpu-memory-utilization 0.90
```

Then query it with curl:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.1-8B-Instruct",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 128
  }'
```

Or use a YAML config file:

```yaml
# config.yaml
model: meta-llama/Llama-3.1-8B-Instruct
host: "127.0.0.1"
port: 8000
tensor-parallel-size: 4
gpu-memory-utilization: 0.90
max-model-len: 8192
dtype: auto
```

```bash
vllm serve --config config.yaml
```

Priority: `command line > config file > defaults`.

---

## Engine Arguments

These arguments control the vLLM engine for both offline inference (`LLM` class) and online serving (`vllm serve`).

### General

| Argument | Type | Default | Description |
|---|---|---|---|
| `--model` | str | `Qwen/Qwen3-0.6B` | Name or path of the Hugging Face model to use. |
| `--runner` | str | `auto` | Model runner type: `auto`, `draft`, `generate`, `pooling`. |
| `--convert` | str | `auto` | Convert model using adapters: `auto`, `classify`, `embed`, `none`. |
| `--tokenizer` | str | None | Name or path of the Hugging Face tokenizer. If unspecified, model path is used. |
| `--tokenizer-mode` | str | `auto` | Tokenizer mode: `auto`, `deepseek_v32`, `deepseek_v4`, `hf`, `mistral`, `slow`. |
| `--trust-remote-code` | bool | `False` | Trust remote code from HuggingFace when downloading model/tokenizer. |
| `--dtype` | str | `auto` | Data type for model weights/activations: `auto`, `bfloat16`, `float`, `float16`, `float32`, `half`. |
| `--seed` | int | `0` | Random seed for reproducibility. |
| `--max-model-len` | int/str | auto | Model context length (prompt + output). Supports `k/m/g/K/M/G` format. `-1` or `auto` = auto-detect. |
| `--quantization` / `-q` | str | None | Quantization method. Auto-detected from model config if not specified. |
| `--allow-deprecated-quantization` | bool | `False` | Allow deprecated quantization methods. |
| `--enforce-eager` | bool | `False` | Always use eager-mode PyTorch (disables CUDA graphs). |
| `--max-logprobs` | int | `20` | Maximum number of log probabilities to return. `-1` = no cap. |
| `--logprobs-mode` | str | `raw_logprobs` | Logprobs content mode: `raw_logprobs`, `processed_logprobs`, `raw_logits`, `processed_logits`. |
| `--disable-sliding-window` | bool | `False` | Disable sliding window attention. |
| `--disable-cascade-attn` | bool | `True` | Disable cascade attention for V1. Set `False` to opt in. |
| `--skip-tokenizer-init` | bool | `False` | Skip tokenizer init; expects `prompt_token_ids` input. |
| `--enable-prompt-embeds` | bool | `False` | Enable passing text embeddings as inputs via `prompt_embeds`. |
| `--served-model-name` | str/list | None | Model name(s) used in the API. If multiple, server responds to any. |
| `--config-format` | str | `auto` | Model config format: `auto`, `hf`, `mistral`. |
| `--hf-token` | str/bool | None | HuggingFace token for remote files. `True` uses cached token. |
| `--hf-overrides` | dict | `{}` | Arguments to forward to HuggingFace config. |
| `--revision` | str | None | Specific model revision (branch/tag/commit). |
| `--code-revision` | str | None | Specific revision for model code on HF Hub. |
| `--tokenizer-revision` | str | None | Specific revision for tokenizer on HF Hub. |
| `--hf-config-path` | str | None | Name or path of the HuggingFace config. |
| `--allowed-local-media-path` | str | `""` | Allow API requests to read local media from specified directories. |
| `--allowed-media-domains` | list | None | Only allow media URLs from these domains. |
| `--pooler-config` | JSON | — | Pooler config for pooling models. |
| `--generation-config` | str | `auto` | Generation config path. `auto`=from model, `vllm`=no config, or a folder path. |
| `--override-generation-config` | JSON | `{}` | Override generation config, e.g. `{"temperature": 0.5}`. |
| `--enable-sleep-mode` | bool | `False` | Enable sleep mode for the engine (CUDA/HIP only). |
| `--model-impl` | str | `auto` | Model implementation: `auto`, `terratorch`, `transformers`, `vllm`. |
| `--override-attention-dtype` | str | None | Override dtype for attention. |
| `--logits-processors` | list | None | Fully-qualified class names or class definitions for logits processors. |
| `--io-processor-plugin` | str | None | IOProcessor plugin name to load at model startup. |
| `--renderer-num-workers` | int | `1` | Number of worker threads for async tokenization, chat template rendering, multimodal preprocessing. |
| `--enable-return-routed-experts` | bool | `False` | Whether to return routed experts. |
| `--disable-log-stats` | bool | `False` | Disable logging statistics. |
| `--aggregate-engine-logging` | bool | `False` | Log aggregate rather than per-engine statistics with data parallelism. |
| `--fail-on-environ-validation` | bool | `False` | Raise error if environment validation fails. |
| `--shutdown-timeout` | int | `0` | Shutdown timeout in seconds. 0 = abort. |
| `--gdn-prefill-backend` | str | — | GDN prefill backend: `flashinfer`, `triton`. |
| `--optimization-level` | int | `2` | Optimization level (-O0 to -O3). Higher = better perf, slower startup. |
| `--performance-mode` | str | `balanced` | `balanced`, `interactivity` (low latency), or `throughput`. |

### Load Config (Model Weight Loading)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--load-format` | str | `auto` | Weight format: `auto`, `pt`, `safetensors`, `instanttensor`, `npcache`, `dummy`, `tensorizer`, `runai_streamer`, `runai_streamer_sharded`, `bitsandbytes`, `sharded_state`, `gguf`, `mistral`. |
| `--download-dir` | str | None | Directory to download/load weights. Defaults to HF cache. |
| `--safetensors-load-strategy` | str | None | Loading strategy for safetensors: None (lazy+mmap), `lazy`, `eager`, `prefetch`, `torchao`. |
| `--model-loader-extra-config` | JSON | `{}` | Extra config for model loader. |
| `--ignore-patterns` | list | `['original/**/*']` | Patterns to ignore when loading model. |
| `--use-tqdm-on-load` | bool | `True` | Show progress bar when loading model weights. |
| `--pt-load-map-location` | str/dict | `cpu` | Map location for loading PyTorch checkpoints. |

### Model Configuration

| Config | Key Options |
|---|---|
| **Model selection** | `--model`, `--runner`, `--convert`, `--model-impl`, `--served-model-name` |
| **Tokenizer** | `--tokenizer`, `--tokenizer-mode`, `--tokenizer-revision` |
| **Data type** | `--dtype` (auto, float16, bfloat16, float32) |
| **Context** | `--max-model-len` (supports k/m/g format) |
| **Quantization** | `--quantization`, `--allow-deprecated-quantization` |
| **Revision** | `--revision`, `--code-revision`, `--hf-config-path` |
| **Remote code** | `--trust-remote-code` |
| **Generation** | `--generation-config`, `--override-generation-config` |
| **Config format** | `--config-format` (auto, hf, mistral) |
| **HF auth** | `--hf-token`, `--hf-overrides` |
| **Weight loading** | `--load-format`, `--download-dir`, `--safetensors-load-strategy` |

### KV Cache & Memory

#### CacheConfig

| Argument | Type | Default | Description |
|---|---|---|---|
| `--block-size` | int | auto | Size of a contiguous cache block in tokens. |
| `--gpu-memory-utilization` | float | `0.92` | Fraction of GPU memory for model executor (0–1). |
| `--kv-cache-memory-bytes` | int/str | None | KV cache size per GPU in bytes. Overrides `gpu-memory-utilization`. Supports k/m/g. |
| `--kv-cache-dtype` | str | `auto` | KV cache data type: `auto`, `bfloat16`, `float16`, `fp8`, `fp8_ds_mla`, `fp8_e4m3`, `fp8_e5m2`, `fp8_inc`, `fp8_per_token_head`, `int8_per_token_head`, `nvfp4`, `turboquant_*`. |
| `--num-gpu-blocks-override` | int | None | Override number of GPU blocks (for testing). |
| `--enable-prefix-caching` | bool | auto | Enable automatic prefix caching (APC). |
| `--prefix-caching-hash-algo` | str | `sha256` | Hash algorithm: `sha256`, `sha256_cbor`, `xxhash`, `xxhash_cbor`. |
| `--kv-cache-dtype-skip-layers` | list | `[]` | Layer patterns to skip KV cache quantization. |
| `--kv-sharing-fast-prefill` | bool | `False` | Enable fast prefill for KV sharing setups (WIP). |
| `--kv-offloading-size` | int | None | KV cache offloading buffer size in GiB. |
| `--kv-offloading-backend` | str | `native` | KV offloading backend: `native`, `lmcache`. |
| `--swap-space` | int | `4` | CPU swap space size in GiB. |
| `--calculate-kv-scales` | bool | `False` | **Deprecated.** Dynamic KV scale calculation for fp8. |

#### Mamba Cache

| Argument | Type | Default | Description |
|---|---|---|---|
| `--mamba-cache-dtype` | str | `auto` | Mamba cache data type: `auto`, `float16`, `float32`. |
| `--mamba-ssm-cache-dtype` | str | `auto` | Mamba SSM state data type: `auto`, `float16`, `float32`. |
| `--mamba-block-size` | int | auto | Mamba cache block size (must be multiple of 8). |
| `--mamba-cache-mode` | str | `none` | Cache strategy: `none`, `all`, `align`. |

### Parallelism (TP, PP, DP, EP, DCP, PCP)

#### Tensor Parallel (TP)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--tensor-parallel-size` / `-tp` | int | `1` | Number of tensor parallel groups. |

#### Pipeline Parallel (PP)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--pipeline-parallel-size` / `-pp` | int | `1` | Number of pipeline parallel groups. |

#### Data Parallel (DP)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--data-parallel-size` / `-dp` | int | `1` | Number of data parallel groups. MoE layers sharded by TP×DP. |
| `--data-parallel-rank` / `-dpn` | int | None | Data parallel rank (enables external LB mode). |
| `--data-parallel-start-rank` / `-dpr` | int | None | Starting DP rank for secondary nodes. |
| `--data-parallel-size-local` / `-dpl` | int | None | Number of DP replicas on this node. |
| `--data-parallel-address` / `-dpa` | str | — | Address of DP cluster head-node. |
| `--data-parallel-rpc-port` / `-dpp` | str | — | Port for DP RPC communication. |
| `--data-parallel-backend` / `-dpb` | str | `mp` | DP backend: `mp` or `ray`. |
| `--data-parallel-hybrid-lb` / `-dph` | bool | `False` | Hybrid DP load balancer mode. |
| `--data-parallel-external-lb` / `-dpe` | bool | `False` | External DP load balancer mode (K8s one-pod-per-rank). |
| `--disable-nccl-for-dp-synchronization` | bool | auto | Use Gloo instead of NCCL for DP sync. |

#### Expert Parallel (EP)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-expert-parallel` / `-ep` | bool | `False` | Use expert parallelism for MoE layers. |
| `--enable-ep-weight-filter` | bool | `False` | Skip non-local expert weights during loading. |
| `--enable-elastic-ep` | bool | `False` | Elastic EP with stateless NCCL groups. |
| `--enable-eplb` | bool | `False` | Expert parallelism load balancing. |
| `--eplb-config` | JSON | — | EPLB configuration (window_size, step_interval, etc.). |
| `--expert-placement-strategy` | str | `linear` | Expert placement: `linear` or `round_robin`. |
| `--all2all-backend` | str | `allgather_reducescatter` | All2All backend: `allgather_reducescatter`, `deepep_high_throughput`, `deepep_low_latency`, `flashinfer_all2allv`, `flashinfer_nvlink_one_sided`, `flashinfer_nvlink_two_sided`, `mori`, `naive`, `nixl_ep`, `pplx`. |

#### Decode Context Parallel (DCP)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--decode-context-parallel-size` / `-dcp` | int | `1` | Number of DCP groups. Reuses TP GPUs; tp_size must be divisible by dcp_size. |
| `--dcp-comm-backend` | str | `ag_rs` | DCP communication backend: `ag_rs` (AllGather+ReduceScatter) or `a2a` (All-to-All). |
| `--dcp-kv-cache-interleave-size` | int | `1` | KV cache interleave size for DCP (**deprecated**, use `cp-kv-cache-interleave-size`). |
| `--cp-kv-cache-interleave-size` | int | `1` | KV cache interleave size for DCP/PCP. |

#### Prefill Context Parallel (PCP)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--prefill-context-parallel-size` / `-pcp` | int | `1` | Number of prefill context parallel groups. |

### Scheduling & Execution

| Argument | Type | Default | Description |
|---|---|---|---|
| `--max-num-batched-tokens` | int | auto | Max tokens processed in a single iteration. |
| `--max-num-seqs` | int | auto | Max sequences in a single iteration. |
| `--max-num-partial-prefills` | int | `1` | Max partially-prefilled sequences (chunked prefill). |
| `--max-long-partial-prefills` | int | `1` | Max concurrent long prefill sequences. |
| `--long-prefill-token-threshold` | int | `0` | Token threshold for "long" prefill. |
| `--scheduling-policy` | str | `fcfs` | Scheduling policy: `fcfs` or `priority`. |
| `--enable-chunked-prefill` | bool | auto | Enable chunked prefill requests. |
| `--disable-chunked-mm-input` | bool | `False` | Don't partially schedule multimodal items. |
| `--scheduler-cls` | str | default | Scheduler class. |
| `--scheduler-reserve-full-isl` | bool | `True` | Reserve full input sequence length in KV cache. |
| `--disable-hybrid-kv-cache-manager` | bool | None | Same-size KV cache for all attention layers. |
| `--async-scheduling` | bool | auto | Enable async scheduling to avoid GPU gaps. |
| `--stream-interval` | int | `1` | Token interval for streaming. Smaller = smoother. |

### Speculative Decoding

Speculative decoding uses a smaller draft model to predict tokens, verified by the target model.

#### SpeculativeConfig (via `--speculative-config` / `-sc`)

| Key | Type | Default | Description |
|---|---|---|---|
| `model` | str | required | Draft model name or path. |
| `method` | str | — | Speculative method: `ngram`, `eagle`, `eagle3`, `medusa`, `mlp_speculator`. |
| `num_speculative_tokens` | int | — | Number of speculative tokens to propose. |
| `draft_tensor_parallel_size` | int | — | TP size for draft model. |
| `max_model_len` | int | — | Max model length for draft model. |

#### Supported Methods

| Method | Description |
|---|---|
| **EAGLE** | Extrapolation Algorithm for Greater Language-model Efficiency. Uses feature-based drafting. |
| **EAGLE3** | Improved EAGLE with better acceptance rates. |
| **Medusa** | Multi-head speculative decoding. |
| **MLP Speculator** | Lightweight MLP-based speculative model. |
| **N-gram** | N-gram based speculation (no draft model needed). |

### LoRA / Adapter Support

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-lora` | bool | `False` | Enable LoRA adapter handling. |
| `--max-loras` | int | `1` | Max LoRAs in a single batch. |
| `--max-lora-rank` | int | `16` | Max LoRA rank: `1`, `8`, `16`, `32`, `64`, `128`, `256`, `320`, `512`. |
| `--lora-dtype` | str | `auto` | Data type for LoRA. `auto` = base model dtype. |
| `--enable-tower-connector-lora` | bool | `False` | Enable LoRA for vision encoder + connector (experimental). |
| `--max-cpu-loras` | int | None | Max LoRAs in CPU memory. Must be ≥ `max_loras`. |
| `--fully-sharded-loras` | bool | `False` | Fully shard LoRA computation with TP. |
| `--lora-target-modules` | list | None | Restrict LoRA to specific module suffixes. |
| `--default-mm-loras` | JSON | — | Map modalities to LoRA paths for multimodal models. |
| `--specialize-active-lora` | bool | `False` | Construct LoRA kernel grid by number of active adapters. |

### Structured Output / Guided Decoding

#### StructuredOutputsConfig (via `--structured-outputs-config`)

| Key | Type | Default | Description |
|---|---|---|---|
| `backend` | str | `auto` | Backend: `auto`, `xgrammar`, `guidance`, `outlines`, `lm-format-enforcer`. |
| `disable_any_whitespace` | bool | `False` | Disable any whitespace in structured output. |
| `disable_additional_properties` | bool | `False` | Disable additional properties. |
| `reasoning_parser` | str | `""` | Reasoning parser: `deepseek_r1`, `deepseek_r3`, etc. |
| `reasoning_parser_plugin` | str | `""` | Path to custom reasoning parser plugin. |
| `enable_in_reasoning` | bool | `False` | Enable structured outputs during reasoning mode. |

#### Request-Level Structured Output Parameters

Pass via `extra_body` or `StructuredOutputsParams`:

| Parameter | Type | Description |
|---|---|---|
| `structured_outputs.json` | JSON Schema | Output follows JSON schema. |
| `structured_outputs.regex` | str | Output follows regex pattern. |
| `structured_outputs.choice` | list | Output is exactly one of the choices. |
| `structured_outputs.grammar` | str | Output follows context-free grammar (EBNF). |
| `structured_outputs.structural_tag` | str | Follow JSON schema within specified tags. |
| `structured_outputs.whitespace_pattern` | str | Whitespace pattern for guided generation. |

#### Response Format (via `response_format`)

| Type | Description |
|---|---|
| `{"type": "text"}` | Plain text output. |
| `{"type": "json_object"}` | Valid JSON output. |
| `{"type": "json_schema", "json_schema": {...}}` | JSON with specific schema. |
| `{"type": "structural_tag", ...}` | Structured tags within text. |

### Multimodal Configuration

| Argument | Type | Default | Description |
|---|---|---|---|
| `--language-model-only` | bool | `False` | Disable all multimodal inputs (sets limits to 0). |
| `--limit-mm-per-prompt` | JSON | `{}` | Max input items per modality. e.g. `{"image": 5, "video": {"count": 1, "num_frames": 32}}`. Default: 999 each. |
| `--enable-mm-embeds` | bool | `False` | Enable multimodal embedding inputs. |
| `--media-io-kwargs` | JSON | `{}` | Additional kwargs for media IO, keyed by modality. e.g. `{"video": {"num_frames": 40}}`. |
| `--mm-processor-kwargs` | JSON | — | Args forwarded to HF multimodal processor. |
| `--mm-processor-cache-gb` | float | `4` | Size (GiB) of multimodal processor cache. |
| `--mm-processor-cache-type` | str | `lru` | Cache type: `lru` or `shm` (shared memory). |
| `--mm-shm-cache-max-object-size-mb` | int | `128` | Max object size for SHM cache. |
| `--mm-encoder-only` | bool | `False` | Skip language component (disaggregated encoder). |
| `--mm-encoder-tp-mode` | str | `weights` | Encoder TP mode: `weights` or `data`. |
| `--mm-encoder-attn-backend` | str | None | Override ViT encoder attention backend. |
| `--mm-encoder-attn-dtype` | str | None | ViT attention dtype override. `fp8` for FP8 quantization. |
| `--mm-encoder-fp8-scale-path` | str | None | Path to per-layer FP8 scales for ViT attention. |
| `--mm-encoder-fp8-scale-save-path` | str | None | Save calibrated FP8 scales to file. |
| `--mm-encoder-fp8-scale-save-margin` | float | `1.5` | Safety margin for auto-saved scales. |
| `--interleave-mm-strings` | bool | `False` | Enable interleaved multimodal prompts with string format. |
| `--skip-mm-profiling` | bool | `False` | Skip multimodal memory profiling. |
| `--video-pruning-rate` | float | None | Pruning rate [0,1) for video token pruning. |
| `--mm-tensor-ipc` | str | `direct_rpc` | IPC method for multimodal tensors: `direct_rpc` or `torch_shm`. |

### Mamba / SSM Configuration

| Argument | Type | Default | Description |
|---|---|---|---|
| `--mamba-backend` | str | `TRITON` | Mamba SSM backend. |
| `--enable-mamba-cache-stochastic-rounding` | bool | `False` | Enable stochastic rounding for SSM state. |
| `--mamba-cache-philox-rounds` | int | `0` | Philox PRNG rounds for stochastic rounding. |

### Compilation & CUDA Graphs

#### CompilationConfig (via `--compilation-config` / `-cc`)

| Key | Type | Default | Description |
|---|---|---|---|
| `mode` | int | None | Compilation mode (0–3). |
| `debug_dump_path` | str | None | Path to dump debug info. |
| `cache_dir` | str | `""` | Compilation cache directory. |
| `compile_cache_save_format` | str | `binary` | Cache save format. |
| `backend` | str | `inductor` | Compilation backend. |
| `custom_ops` | list | `[]` | Custom operations. |
| `splitting_ops` | list | None | Splitting operations. |
| `compile_mm_encoder` | bool | `False` | Compile multimodal encoder. |
| `cudagraph_mm_encoder` | bool | `False` | CUDA graph for MM encoder. |
| `encoder_cudagraph_token_budgets` | list | `[]` | Token budgets for encoder CUDA graphs. |
| `compile_sizes` | list | None | Sizes to compile for inductor. |
| `compile_ranges_endpoints` | list | None | Compile ranges endpoints. |
| `inductor_compile_config` | dict | `{...}` | Inductor compilation config. |
| `inductor_passes` | dict | `{}` | Custom inductor passes. |
| `cudagraph_mode` | str | None | CUDA graph mode. |
| `cudagraph_num_of_warmups` | int | `0` | Number of CUDA graph warmup runs. |
| `cudagraph_capture_sizes` | list | None | Sizes to capture CUDA graphs. |
| `cudagraph_copy_inputs` | bool | `False` | Copy inputs for CUDA graphs. |
| `cudagraph_specialize_lora` | bool | `True` | Specialize CUDA graphs for LoRA. |
| `max_cudagraph_capture_size` | int | auto | Max CUDA graph capture size. Default: min(max_num_seqs×2, 512). |
| `fast_moe_cold_start` | bool | None | Fast MoE cold start. |
| `static_all_moe_layers` | list | `[]` | Static MoE layers. |

### Offloading

| Argument | Type | Default | Description |
|---|---|---|---|
| `--offload-backend` | str | `auto` | Offload backend: `auto`, `prefetch`, `uva`. |
| `--cpu-offload-gb` | float | `0` | Space (GiB) to offload to CPU per GPU. Uses UVA zero-copy. |
| `--cpu-offload-params` | set | `set()` | Parameter name segments to target for CPU offloading. |
| `--offload-group-size` | int | `0` | Group N layers; offload last N layers of each group. |
| `--offload-num-in-group` | int | `1` | Layers to offload per group. |
| `--offload-prefetch-step` | int | `1` | Layers to prefetch ahead. |
| `--offload-params` | set | `set()` | Parameter name segments for prefetch offloading. |

### Attention Configuration

#### AttentionConfig (via `--attention-config` / `-ac`)

| Key | Type | Default | Description |
|---|---|---|---|
| `backend` | str | None | Attention backend. `auto` or None for automatic selection. |
| `flash_attn_version` | str | None | FlashAttention version. |
| `use_prefill_decode_attention` | bool | `False` | Use separate prefill/decode attention. |
| `flash_attn_max_num_splits_for_cuda_graph` | int | `32` | Max splits for FlashAttention CUDA graphs. |
| `tq_max_kv_splits_for_cuda_graph` | int | `32` | Max KV splits for TQ CUDA graphs. |
| `use_cudnn_prefill` | bool | `False` | Use cuDNN for prefill attention. |
| `use_trtllm_ragged_deepseek_prefill` | bool | `False` | Use TRT-LLM ragged DeepSeek prefill. |
| `use_trtllm_attention` | bool | None | Use TRT-LLM attention. |
| `disable_flashinfer_prefill` | bool | None | Disable FlashInfer for prefill. |
| `disable_flashinfer_q_quantization` | bool | `False` | Disable FlashInfer Q quantization. |
| `mla_prefill_backend` | str | None | MLA prefill backend. |
| `use_prefill_query_quantization` | bool | `False` | Enable query quantization in prefill. |
| `use_fp4_indexer_cache` | bool | `False` | Use FP4 indexer cache. |
| `use_non_causal` | bool | `False` | Use non-causal attention. |

#### Standalone Attention Args

| Argument | Type | Default | Description |
|---|---|---|---|
| `--attention-backend` | str | None | Attention backend to use. `auto` or None = automatic. |

### Kernel Configuration

#### KernelConfig (via `--kernel-config`)

| Key | Type | Default | Description |
|---|---|---|---|
| `ir_op_priority` | object | `IrOpPriorityConfig(rms_norm=[])` | IR op priority config. |
| `enable_flashinfer_autotune` | bool | None | Run FlashInfer autotuning during warmup. |
| `moe_backend` | str | `auto` | MoE kernel backend: `auto`, `triton`, `deep_gemm`, `deep_gemm_mega_moe`, `cutlass`, `flashinfer_trtllm`, `flashinfer_cutlass`, `flashinfer_cutedsl`, `marlin`, `aiter`, `emulation`. |

### Distributed Execution

| Argument | Type | Default | Description |
|---|---|---|---|
| `--distributed-executor-backend` | str | auto | Backend: `external_launcher`, `mp`, `ray`, `uni`. |
| `--master-addr` | str | `127.0.0.1` | Master address for multi-node MP. |
| `--master-port` | int | `29501` | Master port for multi-node MP. |
| `--nnodes` / `-n` | int | `1` | Number of nodes. |
| `--node-rank` / `-r` | int | `0` | Node rank. |
| `--distributed-timeout-seconds` | int | None | Timeout for distributed ops (default 600s for NCCL). |
| `--numa-bind` | bool | `False` | Enable NUMA binding for GPU workers. |
| `--numa-bind-nodes` | list | None | NUMA node per visible GPU. |
| `--numa-bind-cpus` | list | None | CPU lists per GPU worker. |
| `--max-parallel-loading-workers` | int | None | Max parallel loading workers to avoid RAM OOM. |
| `--ray-workers-use-nsight` | bool | `False` | Profile Ray workers with nsight. |
| `--disable-custom-all-reduce` | bool | `False` | Fall back to NCCL from custom all-reduce. |
| `--worker-cls` | str | `auto` | Worker class. |
| `--worker-extension-cls` | str | `""` | Worker extension class. |

### Dual Batch Overlap (DBO)

| Argument | Type | Default | Description |
|---|---|---|---|
| `--enable-dbo` | bool | `False` | Enable dual batch overlap. |
| `--ubatch-size` | int | `0` | Number of micro-batch size. |
| `--dbo-decode-token-threshold` | int | `32` | Token threshold for DBO decode batching. |
| `--dbo-prefill-token-threshold` | int | `512` | Token threshold for DBO prefill batching. |

---

## Server / Frontend Arguments

Additional arguments for `vllm serve` (AsyncEngineArgs + Frontend).

### HTTP Server

| Argument | Type | Default | Description |
|---|---|---|---|
| `--host` | str | — | Host name to bind the server. |
| `--port` | int | `8000` | Port number. |
| `--uds` | str | None | Unix domain socket path. If set, host/port are ignored. |
| `--uvicorn-log-level` | str | `info` | Log level for uvicorn: `critical`, `debug`, `error`, `info`, `trace`, `warning`. |
| `--disable-uvicorn-access-log` | bool | `False` | Disable uvicorn access log. |
| `--disable-access-log-for-endpoints` | str | None | Comma-separated endpoint paths to exclude from access logs. |
| `--api-key` | str/list | None | API key(s) required in request header. |
| `--root-path` | str | None | FastAPI root_path when behind a path-based routing proxy. |
| `--middleware` | list | `[]` | Additional ASGI middleware (import paths). |
| `--enable-request-id-headers` | bool | `False` | Add X-Request-Id header to responses. |
| `--disable-fastapi-docs` | bool | `False` | Disable FastAPI OpenAPI schema, Swagger UI, ReDoc. |
| `--enable-offline-docs` | bool | `False` | Enable offline FastAPI documentation for air-gapped environments. |
| `--h11-max-incomplete-event-size` | int | `4194304` | Max size (bytes) of incomplete HTTP event for h11 parser. |
| `--h11-max-header-count` | int | `256` | Max HTTP headers per request for h11 parser. |
| `--enable-flash-late-interaction` | bool | `True` | Run pooling score MaxSim on GPU in the API server. |
| `--headless` | bool | `False` | Run in headless mode (for multi-node DP). |
| `--api-server-count` / `-asc` | int | DP size | Number of API server processes. |
| `--config` | str | None | YAML config file path. |
| `--grpc` | bool | `False` | Launch gRPC server instead of HTTP. |

### CORS

| Argument | Type | Default | Description |
|---|---|---|---|
| `--allow-credentials` | bool | `False` | Allow credentials. |
| `--allowed-origins` | list | `['*']` | Allowed CORS origins. |
| `--allowed-methods` | list | `['*']` | Allowed CORS methods. |
| `--allowed-headers` | list | `['*']` | Allowed CORS headers. |

### SSL / TLS

| Argument | Type | Default | Description |
|---|---|---|---|
| `--ssl-keyfile` | str | None | Path to SSL key file. |
| `--ssl-certfile` | str | None | Path to SSL cert file. |
| `--ssl-ca-certs` | str | None | CA certificates file. |
| `--enable-ssl-refresh` | bool | `False` | Refresh SSL context when certificate files change. |
| `--ssl-cert-reqs` | int | `0` | Whether client certificate is required. |
| `--ssl-ciphers` | str | None | SSL cipher suites for HTTPS. |

### Chat Templates & Tool Parsing

| Argument | Type | Default | Description |
|---|---|---|---|
| `--chat-template` | str | None | Path to Jinja2 chat template. |
| `--chat-template-content-format` | str | `auto` | Content format: `auto`, `openai`, `string`. |
| `--trust-request-chat-template` | bool | `False` | Trust chat templates from requests. |
| `--default-chat-template-kwargs` | JSON | — | Default kwargs for chat template. |
| `--response-role` | str | `assistant` | Role string for assistant responses. |
| `--return-tokens-as-token-ids` | bool | `False` | Represent tokens as `token_id:{id}` strings. |
| `--enable-auto-tool-choice` | bool | `False` | Enable automatic tool choice. |
| `--exclude-tools-when-tool-choice-none` | bool | `False` | Exclude tools when tool_choice is none. |
| `--tool-call-parser` | str | None | Tool call parser. |
| `--tool-parser-plugin` | str | `""` | Path to tool parser plugin. |
| `--tool-server` | str | None | Tool server URL. |
| `--enable-prompt-tokens-details` | bool | `False` | Enable prompt tokens details in response. |
| `--enable-server-load-tracking` | bool | `False` | Enable server load tracking. |
| `--enable-force-include-usage` | bool | `False` | Force include usage in responses. |
| `--enable-tokenizer-info-endpoint` | bool | `False` | Enable tokenizer info endpoint. |
| `--enable-log-outputs` | bool | `False` | Log outputs. |
| `--enable-log-deltas` | bool | `True` | Log streaming deltas. |
| `--log-error-stack` | bool | `False` | Log error stacks. |
| `--tokens-only` | bool | `False` | Return only tokens. |
| `--fingerprint-mode` | str | `full` | Fingerprint mode: `custom`, `full`, `hash`, `none`. |
| `--fingerprint-value` | str | None | Custom fingerprint value. |
| `--lora-modules` | list | None | LoRA module configurations. |
| `--enable-log-requests` | bool | `False` | Enable request-level logging. |
| `--log-config-file` | str | None | Log configuration file. |
| `--max-log-len` | int | None | Maximum log length. |

---

## Sampling Parameters (Per-Request)

These parameters control text generation and can be passed per-request via `SamplingParams` (offline) or as API parameters (online).

### Core Sampling

| Parameter | Type | Default | Description |
|---|---|---|---|
| `n` | int | `1` | Number of output sequences to generate. |
| `best_of` | int | None | Number of sequences for best-of selection. |
| `temperature` | float | `1.0` | Sampling temperature. 0 = greedy. |
| `top_p` | float | `1.0` | Top-p (nucleus) sampling threshold. |
| `top_k` | int | None | Top-k sampling. Filter to top-k tokens. *(vLLM extra)* |
| `min_p` | float | None | Minimum probability threshold relative to top token. *(vLLM extra)* |
| `seed` | int | None | Random seed for this request. |
| `max_tokens` | int | `16` | Maximum number of tokens to generate. (OpenAI: `max_completion_tokens`) |
| `min_tokens` | int | `0` | Minimum number of tokens to generate. *(vLLM extra)* |
| `stop` | str/list | None | Stop sequences. |
| `stop_token_ids` | list | `[]` | Stop token IDs. *(vLLM extra)* |
| `include_stop_str_in_output` | bool | `False` | Include stop string in output. *(vLLM extra)* |

### Penalties

| Parameter | Type | Default | Description |
|---|---|---|---|
| `presence_penalty` | float | `0.0` | Presence penalty (−2.0 to 2.0). |
| `frequency_penalty` | float | `0.0` | Frequency penalty (−2.0 to 2.0). |
| `repetition_penalty` | float | `1.0` | Repetition penalty (>1.0 penalizes repetition). *(vLLM extra)* |
| `length_penalty` | float | `1.0` | Length penalty for beam search. *(vLLM extra)* |

### Logprobs & Output

| Parameter | Type | Default | Description |
|---|---|---|---|
| `logprobs` | int | None | Number of log probabilities to return per token. |
| `top_logprobs` | int | None | Alias for `logprobs` in Chat API. |
| `prompt_logprobs` | int | None | Number of log probabilities for prompt tokens. *(vLLM extra)* |
| `ignore_eos` | bool | `False` | Ignore EOS token. *(vLLM extra)* |
| `skip_special_tokens` | bool | `True` | Skip special tokens in output. *(vLLM extra)* |
| `spaces_between_special_tokens` | bool | `True` | Add spaces between special tokens. *(vLLM extra)* |
| `truncate_prompt_tokens` | int | None | Truncate prompt to this many tokens. −1 = max_model_len. *(vLLM extra)* |
| `allowed_token_ids` | list | None | Restrict sampling to these token IDs. *(vLLM extra)* |
| `bad_words` | list | `[]` | List of strings that should not be generated. *(vLLM extra, Chat only)* |

### Beam Search

| Parameter | Type | Default | Description |
|---|---|---|---|
| `use_beam_search` | bool | `False` | Use beam search instead of sampling. *(vLLM extra)* |

### Advanced (vLLM Extras)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `return_tokens_as_token_ids` | bool | None | Represent tokens as `token_id:{id}`. |
| `return_token_ids` | bool | None | Include token IDs alongside generated text. |
| `cache_salt` | str | None | Salt prefix cache to prevent prompt guessing in multi-user envs. |
| `kv_transfer_params` | dict | None | KVTransfer parameters for disaggregated serving. |
| `vllm_xargs` | dict | None | Additional request parameters for custom extensions. |
| `priority` | int | `0` | Request priority (lower = earlier). Requires priority scheduling. |
| `request_id` | str | random UUID | Request ID. |
| `repetition_detection` | object | None | Params for detecting repetitive N-gram patterns. |

---

## API Endpoints

### OpenAI-Compatible Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/completions` | POST | Text completions (generate models only). |
| `/v1/chat/completions` | POST | Chat completions (generate + chat template). |
| `/v1/responses` | POST | OpenAI Responses API (generate models). |
| `/v1/embeddings` | POST | Embeddings (embedding models). |
| `/v1/audio/transcriptions` | POST | Speech-to-text (ASR models). |
| `/v1/audio/translations` | POST | Audio translation (ASR models). |
| `/v1/realtime` | WebSocket | Realtime API (ASR models). |

### vLLM Custom Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/tokenize` | POST | Tokenize text. |
| `/detokenize` | POST | Detokenize token IDs. |
| `/pooling` | POST | Pooling API (all pooling models). |
| `/classify` | POST | Classification (classification models). |
| `/v2/embed` | POST | Cohere-compatible embed API. |
| `/score` / `/v1/score` | POST | Score API (cross-encoder, bi-encoder, late-interaction). |
| `/rerank` / `/v1/rerank` / `/v2/rerank` | POST | Rerank API (Jina AI + Cohere compatible). |
| `/generative_scoring` | POST | Generative scoring with CausalLM models. |

### Completions API (`/v1/completions`) — Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | str | required | Model name. |
| `prompt` | str/list | required | Text prompt(s). |
| `max_tokens` | int | `16` | Max tokens to generate. |
| `temperature` | float | `1.0` | Sampling temperature. |
| `top_p` | float | `1.0` | Top-p sampling. |
| `n` | int | `1` | Number of completions. |
| `stream` | bool | `False` | Stream responses. |
| `logprobs` | int | None | Include log probabilities. |
| `echo` | bool | `False` | Echo prompt in response. |
| `stop` | str/list | None | Stop sequences. |
| `presence_penalty` | float | `0.0` | Presence penalty. |
| `frequency_penalty` | float | `0.0` | Frequency penalty. |
| `seed` | int | None | Random seed. |
| `suffix` | str | None | **Not supported by vLLM.** |
| `response_format` | object | None | Output format: `json_object`, `json_schema`, `structural_tag`, `text`. |
| `user` | str | None | User identifier (ignored by vLLM). |

### Chat Completions API (`/v1/chat/completions`) — Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | str | required | Model name. |
| `messages` | list | required | Chat messages. |
| `max_tokens` / `max_completion_tokens` | int | `16` | Max tokens. |
| `temperature` | float | `1.0` | Sampling temperature. |
| `top_p` | float | `1.0` | Top-p sampling. |
| `n` | int | `1` | Number of completions. |
| `stream` | bool | `False` | Stream responses. |
| `logprobs` | bool | `False` | Include log probabilities. |
| `top_logprobs` | int | None | Number of top logprobs. |
| `stop` | str/list | None | Stop sequences. |
| `presence_penalty` | float | `0.0` | Presence penalty. |
| `frequency_penalty` | float | `0.0` | Frequency penalty. |
| `seed` | int | None | Random seed. |
| `tools` | list | None | Tool definitions for function calling. |
| `tool_choice` | str/object | `auto` | Tool choice strategy. |
| `parallel_tool_calls` | bool | `true` | Allow multiple tool calls per request. |
| `response_format` | object | None | Output format. |
| `stream_options` | object | None | Streaming options (e.g., `include_usage`). |

### Embeddings API (`/v1/embeddings`) — Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | str | required | Model name. |
| `input` | str/list | required | Text input(s). |
| `encoding_format` | str | `float` | Output format: `float`, `base64`. |
| `dimensions` | int | None | Output dimensions (Matryoshka). |

### Generative Scoring API (`/generative_scoring`) — Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | str | required | Model name. |
| `query` | str | required | Query text. |
| `items` | list | required | Items to score. |
| `label_token_ids` | list | required | Token IDs for label tokens (≥1). |
| `item_first` | bool | `False` | Put item before query in prompt. |
| `apply_softmax` | bool | `True` | Apply softmax normalization. |

---

## Quantization Methods

vLLM supports the following quantization formats (set via `--quantization` or `-q`):

| Method | CLI Value | Precision | Description |
|---|---|---|---|
| **AutoAWQ** | `awq` | INT4 | Activation-aware weight quantization. Best perf for weight-only. |
| **GPTQModel** | `gptq` / `marlin` | INT4/INT8 | GPTQ weight quantization. Marlin is the optimized kernel. |
| **Marlin** | `marlin` | INT4/FP8/FP4 | Optimized GPTQ/AWQ/FP8/FP4 kernels for NVIDIA GPUs. |
| **GGUF** | `gguf` | Various | Supports all GGUF quantization types. |
| **BitsAndBytes** | `bitsandbytes` | INT4/INT8 | NF4/int4/int8 quantization. |
| **FP8 (W8A8)** | `fp8` | FP8 | 8-bit floating point (weights + activations). Ada/Hopper/AMD. |
| **INT8 (W8A8)** | `int8` | INT8 | 8-bit integer (weights + activations). |
| **INT4 W4A16** | `int4` | INT4 | 4-bit weight-only quantization. |
| **Intel Neural Compressor (INC)** | `inc` | Various | Intel GPU/CPU quantization. |
| **NVIDIA Model Optimizer** | `modelopt` | FP8 | NVIDIA's model optimization toolkit. |
| **Online Quantization** | — | — | Dynamic quantization at load time. |
| **AMD Quark** | `quark` | Various | AMD-specific quantization. |
| **TorchAO** | `torchao` | Various | PyTorch-native quantization. |
| **DeepSpeedFP** | — | FP | DeepSpeed floating-point quantization. |
| **FP8 ViT Encoder Attention** | — | FP8 | FP8 quantization for ViT encoder attention. |
| **Quantized KV Cache** | via `--kv-cache-dtype` | FP8/INT8 | KV cache compression. |

### Hardware Compatibility Matrix

| Method | Volta | Turing | Ampere | Ada | Hopper | AMD GPU | Intel GPU | x86 CPU |
|---|---|---|---|---|---|---|---|---|
| AWQ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| GPTQ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Marlin | ❌ | ✅* | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| INT8 W8A8 | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| FP8 W8A8 | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| bitsandbytes | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| DeepSpeedFP | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| GGUF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## Observability

### Metrics & Tracing

| Argument | Type | Default | Description |
|---|---|---|---|
| `--show-hidden-metrics-for-version` | str | None | Re-enable deprecated metrics hidden since this version. |
| `--otlp-traces-endpoint` | str | None | Target URL for OpenTelemetry traces. |
| `--collect-detailed-traces` | str | None | Collect detailed traces: `all`, `model`, `worker`, or combinations. |
| `--kv-cache-metrics` | bool | `False` | Enable KV cache residency metrics. Requires stats logging. |
| `--kv-cache-metrics-sample` | float | `0.01` | Sampling rate for KV cache metrics (0–1]. |
| `--cudagraph-metrics` | bool | `False` | Enable CUDA graph metrics. |
| `--enable-layerwise-nvtx-tracing` | bool | `False` | Enable layerwise NVTX tracing. Incompatible with CUDA graphs. |
| `--enable-mfu-metrics` | bool | `False` | Enable Model FLOPs Utilization metrics. |
| `--enable-logging-iteration-details` | bool | `False` | Log iteration details (context/gen requests, tokens, CPU time). |

### Profiler (via `--profiler-config`)

| Key | Type | Default | Description |
|---|---|---|---|
| `profiler` | str | None | Profiler type. |
| `torch_profiler_dir` | str | `""` | Output directory for torch profiler. |
| `torch_profiler_with_stack` | bool | `True` | Record stack info. |
| `torch_profiler_with_flops` | bool | `False` | Record FLOPs. |
| `torch_profiler_use_gzip` | bool | `True` | Gzip output. |
| `torch_profiler_dump_cuda_time_total` | bool | `True` | Dump CUDA time total. |
| `torch_profiler_record_shapes` | bool | `False` | Record tensor shapes. |
| `torch_profiler_with_memory` | bool | `False` | Record memory info. |
| `ignore_frontend` | bool | `False` | Ignore frontend in profiling. |
| `delay_iterations` | int | `0` | Iterations to delay before profiling. |
| `max_iterations` | int | `0` | Max profiling iterations. |
| `warmup_iterations` | int | `0` | Warmup iterations. |
| `active_iterations` | int | `5` | Active profiling iterations. |
| `wait_iterations` | int | `0` | Wait iterations. |

### Weight Transfer & KV Transfer (Disaggregated Serving)

| Config | Via Flag | Description |
|---|---|---|
| **WeightTransferConfig** | `--weight-transfer-config` | Configuration for weight transfer during RL training. |
| **KVTransferConfig** | `--kv-transfer-config` | Configuration for distributed KV cache transfer (disaggregated prefill/decode serving). |
| **KVEventsConfig** | `--kv-events-config` | Configuration for event publishing. |
| **ECTransferConfig** | `--ec-transfer-config` | Configuration for distributed EC cache transfer. |

---

## Environment Variables

| Variable | Description |
|---|---|
| `VLLM_LOGGING_LEVEL` | Set minimum log level (DEBUG, INFO, WARNING, ERROR). |
| `VLLM_USAGE_STATS_ENABLED` | Enable/disable usage stats collection. |
| `CUDA_VISIBLE_DEVICES` | Control which GPUs are visible to vLLM. |
| `VLLM_WORKER_MULTIPROC_METHOD` | Multiprocessing start method for workers. |
| `VLLM_HOST_IP` | Host IP for distributed inference. |
| `VLLM_RPC_BASE_PATH` | Base path for RPC communication. |
| `VLLM_ALLOW_RUNTIME_LORA_UPDATING` | Allow dynamic LoRA updates. |
| `VLLM_ALLOW_LENGTH_CAP_EQUAL_THAN_SEQLEN` | Allow length cap. |

---

*Reference compiled from the official vLLM documentation at https://docs.vllm.ai/en/latest/ on 2026-05-01, covering the latest developer preview (v0.20.x+).*
