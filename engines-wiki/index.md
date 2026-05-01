# LLM Inference Engines Reference

A comprehensive, exhaustive reference for the three major open-source LLM inference engines: **SGLang**, **vLLM**, and **llama.cpp**. Every configuration option, API parameter, quantization method, and performance knob is documented here.

## Engines

| Engine | Language | Server Command | Default Port | Primary Use |
|--------|----------|---------------|-------------|-------------|
| SGLang | Python | `python -m sglang.launch_server` | 30000 | High-throughput GPU serving |
| vLLM | Python | `vllm serve` | 8000 | Production GPU serving |
| llama.cpp | C/C++ | `llama-server` | 8080 | Local/CPU/edge inference |

## Quick comparison

| Feature | SGLang | vLLM | llama.cpp |
|---------|--------|------|-----------|
| **Quantization** | AWQ, GPTQ, FP8, INT8, INT4 via bitsandbytes, GGUF (via llama-cpp backend) | AWQ, GPTQ, FP8 (E4M3, E5M2), INT8 (via compressed-tensors), GGUF (experimental), Marlin, bitsandbytes, EXL2 | GGUF (Q2_K through Q8_0, IQ quants, F16, BF16, Q4_K_M, Q5_K_M, Q6_K, etc.) |
| **API compatibility** | OpenAI-compatible (completions, chat, embeddings), Anthropic-compatible (messages) | OpenAI-compatible (completions, chat, embeddings, rerank), Anthropic-compatible (messages) | OpenAI-compatible (completions, chat, embeddings), partial |
| **Speculative decoding** | EAGLE, Medusa, draft-model (small-to-big), ngram | EAGLE, Medusa, draft-model (small-to-big), ngram, MLP speculators, Staged speculative decoding | Draft-model (small-to-big), ngram |
| **Multi-GPU** | Tensor parallel, data parallel (via MPS) | Tensor parallel, pipeline parallel, data parallel, expert parallel, context parallel | Tensor parallel (via ggml/CUDA), pipeline parallel (rows) |
| **Structured output** | JSON schema (outlines, xgrammar), regex, EBNF grammar, structural tags | JSON schema (outlines, xgrammar, lm-format-enforcer, guidance), regex, grammar, structured tags | JSON schema (llama.cpp grammar backend), regex, GBNF grammar |
| **LoRA** | Dynamic multi-LoRA serving, LoRA adapter loading | Dynamic multi-LoRA serving, LoRA adapter loading, prompt adapters | LoRA adapter loading via LoRA-scale parameter |
| **Multimodal** | Vision (LLaVA, Qwen-VL, Phi-3-Vision, etc.), audio (Whisper), video | Vision (LLaVA, Qwen-VL, Phi-3-Vision, Pixtral, etc.), audio (Whisper, Qwen-Audio), video, encoder-decoder | Vision (LLaVA, Qwen-VL, etc.), audio (Whisper), embeddings |
| **KV cache** | FP16, FP8 (E4M3/E5M2), automatic prefix caching (RadixAttention) | FP16, FP8 (E4M3/E5M2), automatic prefix caching (block manager), KV cache quantization | FP16, Q8_0, Q4_0 KV cache quantization, prompt caching |
| **Flash attention** | FlashInfer, FlashAttention 2/3 | FlashAttention 2/3, FlashInfer (optional), xFormers (legacy) | Flash attention (built-in), vendor-specific kernels |
| **Continuous batching** | Yes (native) | Yes (native, iteration-level) | Yes (native, continuous) |
| **Prefix caching** | RadixAttention (automatic tree-based prefix caching) | Automatic prefix caching (block-level), KV cache block reuse | Prompt caching (file-based), session slot reuse |
| **Hardware backends** | NVIDIA CUDA, AMD ROCm | NVIDIA CUDA, AMD ROCm, Intel Gaudi (Habana), XPU, CPU (experimental) | NVIDIA CUDA, AMD ROCm, Apple Metal, Intel SYCL, Vulkan, CPU, Kompute, CANN (Huawei) |

## Pages

- [SGLang](sglang.md) — Complete reference
- [vLLM](vllm.md) — Complete reference
- [llama.cpp](llama-cpp.md) — Complete reference
- [Feature comparison](feature-comparison.md) — Side-by-side feature matrix
