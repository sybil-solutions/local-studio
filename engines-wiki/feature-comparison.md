# Feature comparison

## Server configuration comparison

| Feature | SGLang | vLLM | llama.cpp |
|---------|--------|------|-----------|
| **Host** | `--host` (default: `127.0.0.1`) | `--host` (default: `localhost`) | `--host` (default: `127.0.0.1`) |
| **Port** | `--port` (default: `30000`) | `--port` (default: `8000`) | `--port` (default: `8080`) |
| **API key** | `--api-key` | `--api-key` | `--api-key` |
| **SSL/TLS** | No built-in; use reverse proxy | No built-in; use reverse proxy | `--ssl-cert-file`, `--ssl-key-file` |
| **CORS** | `--enable-cors`, `--cors-origins` | `--allow-origin` | No built-in CORS support |
| **Chat templates** | Auto-detect from tokenizer; `--chat-template` override | Auto-detect from tokenizer; `--chat-template` override | Auto-detect from GGUF metadata; `--chat-template` override |
| **Streaming** | SSE streaming (default) | SSE streaming via `stream: true` | SSE streaming via `stream: true` |
| **Metrics** | Prometheus at `/metrics` (optional `--enable-metrics`) | Prometheus at `/metrics` (default) | Prometheus at `/metrics` (optional `--metrics`) |
| **Logging** | `--log-level` (DEBUG/INFO/WARNING/ERROR) | `--log-level` | `--log-format`, verbosity flags |
| **Concurrency** | `--max-running-requests` | `--max-num-seqs` | `--parallel`, `-np` (slots) |
| **Context length** | `--context-length` | `--max-model-len` | `-c`, `--ctx-size` |
| **GPU memory** | `--mem-fraction-static` (default 0.88) | `--gpu-memory-utilization` (default 0.9) | `-ngl`, `--n-gpu-layers` |
| **Model loading** | `--model-path` (HF repo or local) | `--model` (HF repo or local) | `-m`, `--model` (GGUF file) |
| **Tokenizer** | Auto from model | `--tokenizer` / `--skip-tokenizer-init` | Auto from GGUF |
| **Trust remote code** | `--trust-remote-code` | `--trust-remote-code` | N/A (GGUF is self-contained) |
| **Served model name** | `--served-model-name` | `--served-model-name` | `--alias` |
| **Timeout** | `--schedule-consistency-level`, request timeout config | `--disable-log-requests`, timeouts via engine config | `--timeout-keep-alive`, `--timeout-read` |
| **Root path** | N/A | `--root-path` (reverse proxy) | N/A |
| **Data parallel** | `--dp-size` | `--data-parallel-size` | N/A |

## Quantization comparison

| Quantization method | SGLang | vLLM | llama.cpp |
|---------------------|--------|------|-----------|
| **FP16 / BF16** | ✅ Default | ✅ Default | ✅ Default |
| **FP8 (E4M3)** | ✅ `--quantization fp8` | ✅ `--quantization fp8` | ❌ |
| **FP8 (E5M2)** | ✅ `--quantization fp8_e5m2` | ✅ `--quantization fp8_e5m2` | ❌ |
| **INT8 (W8A8)** | ✅ `--quantization int8` | ✅ `--quantization int8` | ❌ |
| **AWQ (4-bit)** | ✅ `--quantization awq` | ✅ `--quantization awq` | ❌ |
| **GPTQ (4-bit)** | ✅ `--quantization gptq` | ✅ `--quantization gptq` | ❌ |
| **Marlin (AWQ/GPTQ optimized)** | ❌ | ✅ `--quantization marlin` | ❌ |
| **bitsandbytes (NF4/INT4)** | ✅ `--quantization bitsandbytes` | ✅ `--quantization bitsandbytes` | ❌ |
| **compressed-tensors** | ❌ | ✅ `--quantization compressed-tensors` | ❌ |
| **EXL2** | ❌ | ✅ `--quantization exl2` | ❌ |
| **GGUF (Q2_K)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q3_K_S/Q3_K_M/Q3_K_L)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q4_0/Q4_1)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q4_K_S/Q4_K_M)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q5_0/Q5_1)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q5_K_S/Q5_K_M)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q6_K)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (Q8_0)** | ❌ | ✅ (experimental) | ✅ |
| **GGUF (IQ2_XS/IQ2_S/IQ2_M)** | ❌ | ❌ | ✅ |
| **GGUF (IQ3_XS/IQ3_S)** | ❌ | ❌ | ✅ |
| **GGUF (IQ4_XS/IQ4_NL)** | ❌ | ❌ | ✅ |
| **GGUF (F32)** | ❌ | ❌ | ✅ |
| **GGUF (BF16)** | ❌ | ❌ | ✅ |
| **KV cache FP8** | ✅ `--kv-cache-dtype fp8_e5m2` | ✅ `--kv-cache-dtype fp8_e5m2` | ❌ |
| **KV cache INT8** | ❌ | ❌ | ✅ `--cache-type q8_0` |
| **KV cache Q4_0** | ❌ | ❌ | ✅ `--cache-type q4_0` |
| **AQLM** | ❌ | ✅ `--quantization aqlm` | ❌ |
| **FBGEMM FP8** | ❌ | ✅ `--quantization fbgemm_fp8` | ❌ |
| **Model opt (qqq)** | ❌ | ✅ `--quantization qqq` | ❌ |
| **Moe expert quantization** | ❌ | ✅ via `--quantization` with MoE models | ❌ |

## Sampling parameters comparison

| Parameter | SGLang | vLLM | llama.cpp |
|-----------|--------|------|-----------|
| **temperature** | ✅ `temperature` | ✅ `temperature` | ✅ `temperature` |
| **top_p** | ✅ `top_p` | ✅ `top_p` | ✅ `top_p` |
| **top_k** | ✅ `top_k` | ✅ `top_k` | ✅ `top_k` |
| **min_p** | ✅ `min_p` | ✅ `min_p` | ✅ `min_p` |
| **frequency_penalty** | ✅ `frequency_penalty` | ✅ `frequency_penalty` | ✅ `frequency_penalty` |
| **presence_penalty** | ✅ `presence_penalty` | ✅ `presence_penalty` | ✅ `presence_penalty` |
| **repetition_penalty** | ✅ `repetition_penalty` | ✅ `repetition_penalty` | ✅ `repeat_penalty` |
| **mirostat** | ❌ | ❌ | ✅ `mirostat`, `mirostat_eta`, `mirostat_tau` |
| **typical_p** | ❌ | ❌ | ✅ `typical_p` |
| **min_keep** | ❌ | ❌ | ✅ `min_keep` |
| **beam search** | ❌ | ✅ `use_beam_search`, `best_of` | ❌ |
| **logit_bias** | ❌ | ✅ `logit_bias` | ✅ `logit_bias` |
| **seed** | ✅ `seed` | ✅ `seed` | ✅ `seed` |
| **stop sequences** | ✅ `stop` | ✅ `stop` | ✅ `stop` |
| **stop token IDs** | ✅ `stop_token_ids` | ✅ `stop_token_ids` | ✅ via grammar |
| **max_tokens** | ✅ `max_tokens` | ✅ `max_tokens` | ✅ `n_predict` |
| **ignore_eos** | ✅ `ignore_eos` | ✅ `ignore_eos` | ✅ `ignore_eos` |
| **skip_special_tokens** | ✅ `skip_special_tokens` | ✅ `skip_special_tokens` | ✅ `special` |
| **spaces_between_special** | ❌ | ✅ `include_stop_str_in_output` | ❌ |
| **logprobs** | ✅ `logprobs` | ✅ `logprobs` | ✅ `logprobs` |
| **top_logprobs** | ✅ `top_logprobs` | ✅ `top_logprobs` | ✅ `n_probs` |
| **n (num completions)** | ✅ `n` | ✅ `n` | ✅ `n_completions` (partial) |
| **stream** | ✅ `stream` | ✅ `stream` | ✅ `stream` |
| **echo** | ❌ | ✅ `echo` | ✅ `echo` |
| **suffix** | ❌ | ✅ `suffix` | ❌ |
| **response_format** | ✅ `response_format` (JSON schema) | ✅ `response_format` (JSON schema, grammar) | ✅ `response_format` (JSON schema) |
| **guided_json** | ✅ `response_format` | ✅ `guided_json` | ❌ (use grammar) |
| **guided_regex** | ✅ via grammar | ✅ `guided_regex` | ❌ (use grammar) |
| **guided_grammar** | ✅ via EBNF | ✅ `guided_grammar` (LARK) | ✅ `grammar` (GBNF) |
| **guided_choice** | ❌ | ✅ `guided_choice` | ❌ |
| **guided_decoding_backend** | ❌ (auto-selected) | ✅ `guided_decoding_backend` (outlines/xgrammar/lm-format-enforcer) | N/A (built-in) |
| **custom_token_bias** | ❌ | ❌ | ✅ `custom_token_bias` |
| **penalty_prompt** | ❌ | ❌ | ✅ `penalty_prompt` |
| **dynatemp_range** | ❌ | ❌ | ✅ `dynatemp_range` |
| **dynatemp_exponent** | ❌ | ❌ | ✅ `dynatemp_exponent` |
| **samplers_sequence** | ❌ | ❌ | ✅ `samplers` (custom sampler chain) |
| **xtc_probability** | ❌ | ❌ | ✅ `xtc_probability` |
| **xtc_threshold** | ❌ | ❌ | ✅ `xtc_threshold` |
| **dry_multiplier** | ❌ | ❌ | ✅ `dry_multiplier` |
| **dry_base** | ❌ | ❌ | ✅ `dry_base` |
| **dry_allowed_length** | ❌ | ❌ | ✅ `dry_allowed_length` |
| **dry_penalty_last_n** | ❌ | ❌ | ✅ `dry_penalty_last_n` |
| **top_n_sigma** | ✅ | ❌ | ❌ |
| **no_repeat_ngram_size** | ❌ | ❌ | ✅ `n_probs` workaround |
| **json_schema** | ✅ via response_format | ✅ `guided_json` | ✅ via grammar |

## API endpoint comparison

| Endpoint | SGLang | vLLM | llama.cpp |
|----------|--------|------|-----------|
| **`POST /v1/completions`** | ✅ | ✅ | ✅ |
| **`POST /v1/chat/completions`** | ✅ | ✅ | ✅ |
| **`POST /v1/embeddings`** | ✅ | ✅ | ✅ |
| **`POST /v1/rerank`** | ❌ | ✅ (via `--enable-reward-bench` or rerank models) | ❌ |
| **`POST /v1/score`** | ❌ | ✅ (via reward models) | ❌ |
| **`POST /tokenize`** | ✅ | ✅ | ✅ |
| **`POST /detokenize`** | ✅ | ✅ | ✅ |
| **`GET /health`** | ✅ | ✅ | ✅ |
| **`GET /health_generate`** | ❌ | ✅ | ❌ |
| **`GET /v1/models`** | ✅ | ✅ | ✅ |
| **`GET /metrics`** | ✅ (optional) | ✅ (default) | ✅ (optional) |
| **`POST /v1/images/generations`** | ❌ | ✅ (multimodal models) | ❌ |
| **`POST /v1/audio/transcriptions`** | ✅ | ✅ | ❌ |
| **`POST /v1/audio/translations`** | ❌ | ✅ | ❌ |
| **`POST /v1/chat/completions` (Anthropic compat)** | ❌ | ✅ (Anthropic messages translator) | ❌ |
| **`GET /get_slots`** | ❌ | ❌ | ✅ |
| **`POST /apply-template`** | ❌ | ❌ | ✅ |
| **`GET /props`** | ❌ | ❌ | ✅ (model properties) |
| **`POST /v1/delete`** | ✅ (LoRA adapter mgmt) | ❌ | ❌ |
| **`GET /v1/load`** | ❌ | ✅ (lifecycle) | ❌ |
| **`POST /generate` (native)** | ✅ (SGLang native API) | ✅ (vLLM internal) | ✅ (`/completion`) |
| **`POST /v1/chat/completions` (tools/function calling)** | ✅ | ✅ | ✅ |
| **`POST /v1/files`** | ❌ | ✅ (file API for uploads) | ❌ |
| **`POST /v1/batch`** | ❌ | ✅ (batch API) | ❌ |
| **OpenAI-compatible images input** | ✅ (vision models) | ✅ (vision models) | ✅ (vision models) |

## Parallelism comparison

| Parallelism type | SGLang | vLLM | llama.cpp |
|-----------------|--------|------|-----------|
| **Tensor parallel** | ✅ `--tp` (splits layers across GPUs) | ✅ `--tensor-parallel-size` (splits layers across GPUs) | ✅ `-sm`, `--split-mode` (row/split) for CUDA |
| **Pipeline parallel** | ❌ | ✅ `--pipeline-parallel-size` | ✅ `-np` / `--parallel` (row-based pipeline) |
| **Data parallel** | ✅ `--dp-size` (replicate model across GPU groups) | ✅ `--data-parallel-size` (replicate model across GPU groups) | ❌ |
| **Expert parallel** | ❌ | ✅ `--num-lookahead-slots` for MoE; automatic expert parallel for Mixtral | ❌ |
| **Context parallel** | ❌ | ✅ `--kv-parallel` / `--context-parallel-size` | ❌ |
| **Chunked prefill** | ✅ `--chunked-prefill-size` | ✅ `--enable-chunked-prefill` | ❌ |
| **Multi-node** | ❌ | ✅ via Ray + `--distributed-executor-backend` | ❌ |
| **Expert parallelism (MoE)** | ✅ Automatic for supported MoE models | ✅ Automatic for supported MoE models | ❌ |
| **CUDA graphs** | ✅ Automatic | ✅ `--enforce-eager` to disable | ❌ |
| **Custom all-reduce** | ✅ `--disable-cuda-graph` | ✅ `--disable-custom-all-reduce` | ❌ |

## Speculative decoding comparison

| Method | SGLang | vLLM | llama.cpp |
|--------|--------|------|-----------|
| **Draft model (small-to-big)** | ✅ `--speculative-algorithm EAGLE`, `-- speculative-draft-model` | ✅ `--speculative-model` | ✅ `--draft` (draft model) |
| **EAGLE** | ✅ `--speculative-algorithm EAGLE` | ✅ `--speculative-model [eagle-model]` | ❌ |
| **EAGLE v2** | ✅ | ✅ | ❌ |
| **Medusa** | ✅ `--speculative-algorithm MEDUSA` | ✅ `--speculative-model [medusa-model]` | ❌ |
| **MLP speculator** | ❌ | ✅ `--speculative-model [mlp-speculator]` | ❌ |
| **Ngram speculation** | ✅ `--speculative-algorithm NEXTN` | ✅ `--speculative-model [ngram]` | ✅ `--draft-min`, `--draft-max`, `--draft-p-split` |
| **Staged speculative decoding** | ❌ | ✅ `--num-lookahead-slots` | ❌ |
| **Speculative decoding num tokens** | ✅ `--speculative-num-steps`, `--speculative-eagle-top-1` | ✅ `--num-speculative-tokens` | ✅ `--draft-max` |
| **Draft acceptance threshold** | ❌ | ✅ `--speculative-max-model-len` | ✅ `--draft-p-min` |
| **Speculative disable batch** | ❌ | ✅ `--speculative-disable-by-batch-size` | ❌ |
| **Rejection sampler** | ✅ Built-in | ✅ `--speculative-sampler` (rejection, typical, min-p) | ✅ Built-in |

## Structured output comparison

| Feature | SGLang | vLLM | llama.cpp |
|---------|--------|------|-----------|
| **JSON schema** | ✅ via `response_format: { type: "json_object", schema: ... }` | ✅ via `guided_json` or `response_format` | ✅ via `response_format` or grammar |
| **Regex** | ✅ via grammar backend | ✅ `guided_regex` | ✅ via grammar |
| **LARK grammar** | ❌ | ✅ `guided_grammar` (LARK syntax) | ❌ |
| **GBNF grammar** | ❌ | ❌ | ✅ `grammar` parameter |
| **EBNF grammar** | ✅ via xgrammar | ❌ | ❌ |
| **Structural tags** | ❌ | ❌ | ✅ Structured output via grammar |
| **Backend: outlines** | ✅ | ✅ `--guided-decoding-backend outlines` | ❌ |
| **Backend: xgrammar** | ✅ | ✅ `--guided-decoding-backend xgrammar` | ❌ |
| **Backend: lm-format-enforcer** | ❌ | ✅ `--guided-decoding-backend lm-format-enforcer` | ❌ |
| **Backend: guidance** | ❌ | ✅ `--guided-decoding-backend guidance` | ❌ |
| **Backend: built-in (llama.cpp)** | ❌ | ❌ | ✅ Native GBNF engine |
| **Whitelist choices** | ❌ | ✅ `guided_choice` | ❌ (use grammar) |
| **Grammar in chat completions** | ✅ | ✅ | ✅ |
| **Schema caching** | ✅ (auto-cached) | ✅ (auto-cached) | ❌ |
| **Tool/function calling structured output** | ✅ | ✅ | ✅ |
| **JSON schema `$ref` support** | ✅ | ✅ | Partial |
| **Nullable types** | ✅ | ✅ | Partial |

## KV cache comparison

| Feature | SGLang | vLLM | llama.cpp |
|---------|--------|------|-----------|
| **FP16 KV cache** | ✅ Default | ✅ Default | ✅ Default |
| **FP8 E4M3 KV cache** | ✅ `--kv-cache-dtype fp8_e4m3` | ✅ `--kv-cache-dtype fp8_e4m3` | ❌ |
| **FP8 E5M2 KV cache** | ✅ `--kv-cache-dtype fp8_e5m2` | ✅ `--kv-cache-dtype fp8_e5m2` | ❌ |
| **Q8_0 KV cache** | ❌ | ❌ | ✅ `--cache-type q8_0` |
| **Q4_0 KV cache** | ❌ | ❌ | ✅ `--cache-type q4_0` |
| **Prefix caching** | ✅ RadixAttention (tree-based, automatic) | ✅ `--enable-prefix-caching` (block-level) | ✅ Prompt caching (`--prompt-cache`) |
| **Cache block size** | Configurable (token-level via RadixAttention) | 16 tokens (default, configurable) | Configurable via `--cache-reuse` |
| **KV cache offloading to CPU** | ❌ | ❌ | ✅ `--mlock`, offloading layers |
| **KV cache offloading to disk** | ❌ | ❌ | ❌ |
| **Sliding window attention** | ✅ Auto-detect from model config | ✅ `--sliding-window` | ✅ `--swa` (auto-detect) |
| **KV cache quantization config** | `--kv-cache-dtype` | `--kv-cache-dtype` | `--cache-type` |
| **KV cache memory fraction** | `--mem-fraction-static` | `--gpu-memory-utilization` | `-ngl` (layer-based) |
| **KV cache swap** | ❌ | ✅ `--swap-space` (CPU swap) | ❌ |
| **Chunked prefill** | ✅ `--chunked-prefill-size` | ✅ `--enable-chunked-prefill` | ❌ |
| **KV cache compression** | ❌ | ❌ | ✅ `--cache-type q4_0` |

## Hardware backend comparison

| Hardware | SGLang | vLLM | llama.cpp |
|----------|--------|------|-----------|
| **NVIDIA CUDA** | ✅ Primary (sm_80+) | ✅ Primary (sm_70+) | ✅ `--n-gpu-layers` / `-ngl` |
| **AMD ROCm** | ✅ via PyTorch ROCm | ✅ via PyTorch ROCm | ✅ `GGML_HIP_ROCWMMA=1` |
| **Apple Metal (MPS)** | ❌ | ❌ (experimental) | ✅ Default on macOS |
| **Intel SYCL / XPU** | ❌ | ✅ (experimental) | ✅ `GGML_SYCL=1` |
| **Vulkan** | ❌ | ❌ | ✅ `GGML_VULKAN=1` |
| **CPU** | ✅ (slow, PyTorch CPU) | ✅ (slow, PyTorch CPU) | ✅ Primary (optimized) |
| **Intel Gaudi (Habana)** | ❌ | ✅ via HPU backend | ❌ |
| **AWS Trainium / Inferentia** | ❌ | ✅ via NeuronX backend | ❌ |
| **Google TPU** | ❌ | ✅ via Ray + TPU backend | ❌ |
| **CANN (Huawei Ascend)** | ❌ | ❌ | ✅ `GGML_CANN=1` |
| **Kompute (Vulkan-based)** | ❌ | ❌ | ✅ `GGML_KOMPUTE=1` |
| **CPU SIMD: AVX2** | ✅ (via PyTorch) | ✅ (via PyTorch) | ✅ Auto-detect |
| **CPU SIMD: AVX-512** | ✅ (via PyTorch) | ✅ (via PyTorch) | ✅ Auto-detect |
| **CPU SIMD: ARM NEON** | ✅ (via PyTorch) | ✅ (via PyTorch) | ✅ Auto-detect |
| **WASM / Web** | ❌ | ❌ | ✅ (emscripten builds) |
| **BLAS backends** | ✅ (via PyTorch MKL/OpenBLAS) | ✅ (via PyTorch MKL/openBLAS) | ✅ OpenBLAS, Apple Accelerate, BLIS |

## LoRA comparison

| Feature | SGLang | vLLM | llama.cpp |
|---------|--------|------|-----------|
| **LoRA adapter loading** | ✅ `--lora-paths` at startup | ✅ `--enable-lora` + dynamic loading | ✅ `--lora` file path |
| **Dynamic LoRA loading** | ✅ Load/unload at runtime | ✅ Load/unload at runtime | ❌ (must restart) |
| **Multi-LoRA batching** | ✅ Serve multiple LoRAs in same batch | ✅ Serve multiple LoRAs in same batch | ❌ (single LoRA at a time) |
| **Max LoRA rank** | Configurable | ✅ `--max-lora-rank` | N/A (no explicit limit) |
| **LoRA target modules** | Auto-detect from adapter config | ✅ `--max-loras`, auto-detect modules | Auto-detect from adapter |
| **LoRA dtype** | Auto (FP16/BF16) | ✅ `--lora-dtype` | Auto |
| **LoRA scaling** | ✅ Auto (alpha/rank) | ✅ Auto (alpha/rank) | ✅ `--lora-scale` |
| **Prompt adapters** | ❌ | ✅ `--enable-prompt-adapter` | ❌ |
| **QLoRA support** | ✅ (via bitsandbytes) | ✅ (via bitsandbytes) | ✅ (quantized base + LoRA) |
| **LoRA fusion** | ❌ | ✅ (batched LoRA kernels) | ❌ |
| **LoRA in speculative decoding** | ❌ | ✅ | ❌ |
| **LoRA via API** | ✅ `lora_path` in request | ✅ `lora_name` in request | ❌ |
| **Max number of LoRAs** | `--max-loras-per-batch` | ✅ `--max-cpu-loras`, `--max-num-seqs` | 1 |
| **LoRA offloading to CPU** | ❌ | ✅ `--max-cpu-loras` | ❌ |
| **LoRA adapter management API** | ✅ Load/unload/list endpoints | ✅ Load/unload/list endpoints | ❌ |
