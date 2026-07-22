# Model Onboarding Index

Curated model list for Local Studio, organized by hardware tier. Each model links to its Hugging Face repos in four serving formats: **BF16** (full precision), **FP8**, **NVFP4** (NVIDIA Blackwell), and **Q4 GGUF** (llama.cpp; Unsloth preferred).

All links verified live on **2026-07-21**. Community quants (not from the model creator or NVIDIA/RedHatAI/Unsloth) are marked ⚠️. Missing variants are marked —.

**Format cheat-sheet:**

| Format | Backend | When to use |
|---|---|---|
| BF16 | vLLM / SGLang | Reference quality, max VRAM |
| FP8 | vLLM / SGLang | Hopper/Ada/Blackwell, ~half VRAM of BF16, near-lossless |
| NVFP4 | vLLM (Blackwell) | B200/B300/RTX 50-series; ~quarter VRAM, needs recent vLLM |
| Q4 GGUF | llama.cpp / MLX | CPU/Metal/unified memory, single-file convenience |

---

## Nano — single consumer GPU / laptop

| Model | BF16 | FP8 | NVFP4 | Q4 GGUF |
|---|---|---|---|---|
| **Qwen3.5-9B** *(listed as "qwen3.6-9b" — no 3.6 9B exists; 9B dense is Qwen3.5)* | [Qwen/Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) | [RedHatAI/Qwen3.5-9B-FP8-dynamic](https://huggingface.co/RedHatAI/Qwen3.5-9B-FP8-dynamic) | [kaitchup/Qwen3.5-9B-autoround-NVFP4](https://huggingface.co/kaitchup/Qwen3.5-9B-autoround-NVFP4) ⚠️ community | [unsloth/Qwen3.5-9B-GGUF](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF) (`Qwen3.5-9B-Q4_K_M.gguf`) |
| **Gemma 4 E2B** | [google/gemma-4-E2B-it](https://huggingface.co/google/gemma-4-E2B-it) | [leon-se/gemma-4-E2B-it-FP8-Dynamic](https://huggingface.co/leon-se/gemma-4-E2B-it-FP8-Dynamic) ⚠️ community | [unsloth/gemma-4-E2B-it-NVFP4](https://huggingface.co/unsloth/gemma-4-E2B-it-NVFP4) | [unsloth/gemma-4-E2B-it-GGUF](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF) (`gemma-4-E2B-it-Q4_K_M.gguf`) |

**Notes**
- **Qwen3.5-9B** — 9B dense + vision encoder, hybrid Gated DeltaNet/attention, 262K context, thinks by default (`--reasoning-parser qwen3`). Needs bleeding-edge runtimes (vLLM nightly). Text-only serving: `--language-model-only` frees vision memory. GGUF needs `mmproj-*.gguf` for vision.
- **Gemma 4 E2B** — 2.3B effective params (5.1B total w/ Per-Layer Embeddings), text+image+audio in, 128K context, Apache 2.0. NVFP4 needs vLLM ≥ 0.25 + flashinfer, let vLLM auto-select the kernel (not Marlin). Google also ships official QAT 4-bit GGUFs (`google/gemma-4-E2B-it-qat-q4_0-gguf`) as a creator-official alternative.

## Mini — single 24–48 GB GPU

| Model | BF16 | FP8 | NVFP4 | Q4 GGUF |
|---|---|---|---|---|
| **Gemma 4 26B A4B** *(fast — MoE, 3.8B active)* | [google/gemma-4-26B-A4B-it](https://huggingface.co/google/gemma-4-26B-A4B-it) | [RedHatAI/gemma-4-26B-A4B-it-FP8-Dynamic](https://huggingface.co/RedHatAI/gemma-4-26B-A4B-it-FP8-Dynamic) | [nvidia/Gemma-4-26B-A4B-NVFP4](https://huggingface.co/nvidia/Gemma-4-26B-A4B-NVFP4) | [unsloth/gemma-4-26B-A4B-it-GGUF](https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF) (`UD-Q4_K_M`) |
| **Gemma 4 31B** *(smart — dense)* | [google/gemma-4-31B-it](https://huggingface.co/google/gemma-4-31B-it) | [RedHatAI/gemma-4-31B-it-FP8-block](https://huggingface.co/RedHatAI/gemma-4-31B-it-FP8-block) | [nvidia/Gemma-4-31B-IT-NVFP4](https://huggingface.co/nvidia/Gemma-4-31B-IT-NVFP4) | [unsloth/gemma-4-31B-it-GGUF](https://huggingface.co/unsloth/gemma-4-31B-it-GGUF) (`gemma-4-31B-it-Q4_K_M.gguf`) |
| **Qwen3.6-35B-A3B** *(fast — MoE, 3B active)* | [Qwen/Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) | [Qwen/Qwen3.6-35B-A3B-FP8](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) ✅ official | [unsloth/Qwen3.6-35B-A3B-NVFP4](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-NVFP4) | [unsloth/Qwen3.6-35B-A3B-GGUF](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF) (`UD-Q4_K_M`) |
| **Qwen3.6-27B** *(smart — dense)* | [Qwen/Qwen3.6-27B](https://huggingface.co/Qwen/Qwen3.6-27B) | [Qwen/Qwen3.6-27B-FP8](https://huggingface.co/Qwen/Qwen3.6-27B-FP8) ✅ official | [nvidia/Qwen3.6-27B-NVFP4](https://huggingface.co/nvidia/Qwen3.6-27B-NVFP4) | [unsloth/Qwen3.6-27B-GGUF](https://huggingface.co/unsloth/Qwen3.6-27B-GGUF) (`Qwen3.6-27B-Q4_K_M.gguf`) |

**Notes**
- The "fast" picks are MoE (only ~3–4B active params/token → 3–5× faster decode than the dense "smart" picks) but **all weights must still fit in memory** — MoE ≠ small download.
- **Gemma 4 26B A4B**: 25.2B total / 3.8B active, 256K context, multimodal. BF16 ≈ 52 GB. Do NOT use vLLM `--quantization fp8` on-the-fly with the BF16 repo (broken output — use the RedHatAI checkpoint). NVFP4 on non-Blackwell falls back to Marlin and is *slower than FP8*. GGUF has a known ROCm infinite-loop bug; bartowski publishes alternative imatrix GGUFs.
- **Gemma 4 31B**: dense, ~62 GB at BF16, 262K context. FP8-block (W8A8, better accuracy) or FP8-dynamic, both need sm_89+. NVFP4 is Blackwell-only. Unsloth repo includes MTP draft GGUFs for speculative decoding.
- **Qwen3.6-35B-A3B**: 256 experts, 262K context, MTP built in (usable as speculative decoding). Needs vLLM ≥ 0.19 / SGLang ≥ 0.5.10; GGUF arch `qwen35moe` — older llama.cpp won't load it. Q4_K_M ≈ 20 GB.
- **Qwen3.6-27B**: dense, hybrid arch, 262K context, ~17 GB at Q4_K_M (24 GB GPU floor). Thinking is on by default; disable via `chat_template_kwargs: {enable_thinking: false}` (the `/think` soft-switch does not work on 3.6). Avoid CUDA 13.2 (gibberish reports); use 13.1/12.x.

## Medium — large unified memory / multi-GPU (⚠️ these are 200–300B MoEs)

| Model | BF16 | FP8 | NVFP4 | Q4 GGUF |
|---|---|---|---|---|
| **Step 3.7 Flash** | [stepfun-ai/Step-3.7-Flash](https://huggingface.co/stepfun-ai/Step-3.7-Flash) | [stepfun-ai/Step-3.7-Flash-FP8](https://huggingface.co/stepfun-ai/Step-3.7-Flash-FP8) ✅ official | [stepfun-ai/Step-3.7-Flash-NVFP4](https://huggingface.co/stepfun-ai/Step-3.7-Flash-NVFP4) ✅ official | [unsloth/Step-3.7-Flash-GGUF](https://huggingface.co/unsloth/Step-3.7-Flash-GGUF) (`UD-Q4_K_XL`; official alt: [stepfun-ai GGUF](https://huggingface.co/stepfun-ai/Step-3.7-Flash-GGUF) Q4_K_S) |
| **DeepSeek V4 Flash** | — *(never published; official release is natively FP4-experts + FP8 mixed, ~160 GB: [deepseek-ai/DeepSeek-V4-Flash](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash))* | [sgl-project/DeepSeek-V4-Flash-FP8](https://huggingface.co/sgl-project/DeepSeek-V4-Flash-FP8) (SGLang team repack) | [nvidia/DeepSeek-V4-Flash-NVFP4](https://huggingface.co/nvidia/DeepSeek-V4-Flash-NVFP4) | [unsloth/DeepSeek-V4-Flash-GGUF](https://huggingface.co/unsloth/DeepSeek-V4-Flash-GGUF) (`UD-Q4_K_XL`, 5 shards, ~155 GB) |
| **Hy3** *(Tencent Hunyuan 3)* | [tencent/Hy3](https://huggingface.co/tencent/Hy3) | [tencent/Hy3-FP8](https://huggingface.co/tencent/Hy3-FP8) ✅ official | — *(no official; community: [LibertAIDAI/Hy3-NVFP4](https://huggingface.co/LibertAIDAI/Hy3-NVFP4) ⚠️)* | — *(no unsloth; Tencent's own [AngelSlim/Hy3-GGUF](https://huggingface.co/AngelSlim/Hy3-GGUF) `Hy3-Q4_K_M.gguf`, or [bartowski/Hy3-GGUF](https://huggingface.co/bartowski/Hy3-GGUF))* |

**Notes**
- **Step 3.7 Flash** — 198B MoE / 11B active, 256K context, Apache 2.0. Even Q4 needs ≥120 GB unified memory (Mac Studio 128 GB, DGX Spark). llama.cpp requires StepFun's fork (branch `step3.7`); vLLM needs the dedicated `vllm/vllm-openai:stepfun37` image + `--trust-remote-code --disable-cascade-attn --reasoning-parser step3p5`. Rare: StepFun ships its own NVFP4.
- **DeepSeek V4 Flash** — 284B MoE / 13B active, 1M context, MIT. No BF16 exists by design. FP8 (sgl-project) is the only Hopper path; NVFP4 is true-NVFP4 for Blackwell. GGUF needs latest llama.cpp + Unsloth's corrected chat template (official repo ships none). MLX support still experimental.
- **Hy3** — 295B MoE / 21B active + MTP layer, 256K context, Apache 2.0 (full release 2026-07-06). BF16 ≈ 598 GB, FP8 ≈ 300 GB — Tencent's recipe targets 8× H20 TP=8. Custom arch `hy_v3` needs source-built vLLM; TP must divide 8 KV heads. Reasoning effort switchable (`reasoning_effort: no_think/low/high`).

## Large — datacenter-class only

| Model | BF16 | FP8 | NVFP4 | Q4 GGUF |
|---|---|---|---|---|
| **MiniMax M3** | [MiniMaxAI/MiniMax-M3](https://huggingface.co/MiniMaxAI/MiniMax-M3) | [MiniMaxAI/MiniMax-M3-MXFP8](https://huggingface.co/MiniMaxAI/MiniMax-M3-MXFP8) ✅ official *(MXFP8, not W8A8)* | [nvidia/MiniMax-M3-NVFP4](https://huggingface.co/nvidia/MiniMax-M3-NVFP4) | [unsloth/MiniMax-M3-GGUF](https://huggingface.co/unsloth/MiniMax-M3-GGUF) (`UD-Q4_K_M`, 7 shards, ~240 GB) |
| **GLM 5.2** | [zai-org/GLM-5.2](https://huggingface.co/zai-org/GLM-5.2) | [zai-org/GLM-5.2-FP8](https://huggingface.co/zai-org/GLM-5.2-FP8) ✅ official | [nvidia/GLM-5.2-NVFP4](https://huggingface.co/nvidia/GLM-5.2-NVFP4) | [unsloth/GLM-5.2-GGUF](https://huggingface.co/unsloth/GLM-5.2-GGUF) (`UD-Q4_K_M`) |

**Notes**
- **MiniMax M3** — ~428B / 23B active MoE, 1M context, custom MiniMax license. Only official FP8 is MXFP8 microscaling (needs framework support). vLLM serving needs the `vllm/vllm-openai:minimax-m3` image, `--trust-remote-code`, `minimax_m3` parsers; NVFP4 requires `--block-size 128`.
- **GLM 5.2** — 753B / ~40B active MoE, 1M context, MIT. BF16 ≈ 1.5 TB. NVIDIA's evals show NVFP4 ≈ FP8 parity (GPQA 89.39 vs 89.52). NVFP4 needs vLLM ≥ 0.23 / `--quantization modelopt_fp4`, `--trust-remote-code`, transformers ≥ 5.3. Base repo *is* the chat model (no `-Instruct` suffix).

---

## Known gaps (as of 2026-07-21)

- **DeepSeek V4 Flash**: no BF16 checkpoint exists (natively FP4+FP8 by design).
- **Hy3**: no official NVFP4 and no Unsloth GGUF — community/Tencent-toolkit alternatives linked above.
- **Qwen3.5-9B**: no official FP8 or NVFP4 — RedHatAI (FP8) and community (NVFP4) only.
- **Gemma 4 E2B**: no official FP8 — community FP8-dynamic only; official 4-bit path is Google's own QAT GGUFs.
