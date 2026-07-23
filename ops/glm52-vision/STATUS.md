# GLM-5.2 Hybrid Vision Status

Status: live on the original GLM-5.2 v3 runtime with the Vision adapter and corrected sparse-attention propagation

Cutover: `2026-07-23T15:19:22Z`

Live service: `glm52-vision-v3`

Served model: `GLM-5.2-Vision`

Live image: `local/glm52-nf3-vision:v3-attn`

Base image: `madeby561/vllm-glm52-nvfp4-nf3-hybrid:v3`

Live checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision`

Vision source: `baseten/GLM-5.2-Vision-NVFP4@f6eab6117386a0c69152fdf272dc65bfd0254f9f`

Runtime recipe: FP8 KV cache, `B12X_MLA_SPARSE`, TP 4, DCP 4 with `ag_rs`, async scheduling, chunked prefill, prefix caching, B12X MoE, and CUDA graphs.

Sparse-attention configuration: `use_index_cache=true` with `FFFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSSFSSS`.

Attention fix: the Vision wrapper now copies the outer recipe overrides into the nested `text_config` used to instantiate both the decoder and speculative draft. Before this fix the live decoder saw neither field, despite the launch command containing them.

Configured context length: `250000`

GPU KV capacity: `509467` tokens

Maximum 250000-token concurrency: `2.04x`

Model memory: `84.93 GiB` per GPU

CUDA graphs: PIECEWISE and FULL capture passed; graph capture used `0.54 GiB` per GPU.

MTP: disabled. The Vision-wrapped MTP5 path had a `0.0%` draft acceptance rate and caused non-greedy text decoding to collapse into repeated punctuation. Removing MTP restored coherent sampling while retaining the original decoder, attention, MoE, DCP, and graph paths.

Live validation:

- Direct `/health` returned `200`, and `/v1/models` reported `GLM-5.2-Vision` with `max_model_len=250000`.
- A non-greedy three-sentence science request completed coherently with the correct explanation.
- A two-turn arithmetic request returned the correct `27 cents` result.
- A real 4,175-token screenshot request identified the repeated SQLite disk-full failure and completed without repetition or OOM.
- A 28,587-token retrieval request recovered `CEDAR-17`, `ORBIT-42`, and `HARBOR-93` exactly and in order.
- The tailnet controller health endpoint at `http://100.90.62.80:8080/health` returned `200`.

Known limitation: the screenshot description captured the correct SQLite disk-full meaning but did not reproduce the visible punctuation exactly, so this is a semantic vision pass rather than an exact OCR pass.

Runtime error scan: no engine OOM or request error after the final no-MTP launch. One non-fatal vLLM usage-telemetry thread raised a CPU-info JSON decode error during startup; serving continued normally.

Retired runtime: `glm52-vision-fp8` using `local/glm52-nf3-vision:v5-nvfp4` is stopped. It used different vLLM, B12X, FlashInfer, and DeepGEMM commits and failed coherence validation.

Recoverable text rollback: `glm52-v3`, stopped.

Historical NVFP4-KV result: the native NVFP4-KV candidate passed short transport checks but did not fix the 8K/16K quality failure. The production Vision service therefore uses FP8 KV.

MMMU-Pro: paused at user request with 102 durable records. Those partial records remain provisional and are not published as a benchmark score.
