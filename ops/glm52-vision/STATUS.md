# GLM-5.2 Hybrid and Vision Status

Status: NVFP4-KV hybrid test live; FP8 hybrid and vision candidate stopped

NVFP4-KV test started: `2026-07-23T09:16:12Z`

Live service: `glm52-nvfp4-hybrid`

Served model: `GLM-5.2`

Live image: `local/glm52-nf3-vision:v5-nvfp4`

Live checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid`

Hybrid recipe: `nvfp4_ds_mla` KV cache, `B12X_MLA_SPARSE`, DCP 4, MTP 3, async scheduling, and the 78-layer index-cache pattern.

Configured context length: `196608`

GPU KV capacity: `320000` tokens

Maximum 196608-token concurrency: `1.63x`

Cold-prefix single-request measurements with thinking disabled: 1,066 input tokens at 984.0 tok/s and 28.2 decode tok/s returned `OK`; 4,140 at 1,054.5 tok/s and 30.8 decode tok/s returned `OK`; 8,232 at 1,118.5 tok/s and 54.8 decode tok/s echoed the filler; 16,427 generated 32 tokens with no visible response.

Coherence gate: 1k and 4k control prompts returned `OK`; failure begins by 8k and is worse at 16k. NVFP4 KV does not resolve the long-context inference-quality concern.

FP8 hybrid service: `glm52-v3` is stopped and recoverable. Vision service: `glm52-vision-candidate` is stopped and recoverable.

Previous vision cutover: `2026-07-23T01:21:10+02:00`

Base checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid`

Vision candidate checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision`

Vision source: `baseten/GLM-5.2-Vision-NVFP4@f6eab6117386a0c69152fdf272dc65bfd0254f9f`

Checkpoint logical size: `366955275044` bytes

Added vision payload: `932887040` bytes

Context length: `400000`

Weight formats: `NVFP4`, `NF3`, and `MXFP8`

KV cache format: packed MLA `NVFP4`

NVFP4 KV cache: `nvfp4_ds_mla` from the SM120 packed-MLA runtime

Model memory: `85.93 GiB` per GPU

Available KV memory: `4.56 GiB`

GPU KV capacity: `444529` tokens

Maximum 400000-token concurrency: `1.11x`; normal prompt scheduling permits four concurrent sequences

CUDA graphs: PIECEWISE, FULL, prefill, and decode capture passed

MTP: not enabled for the NVFP4-KV candidate

Text validation: passed with `TEXT_OK`

Image transport validation: passed with the attached Local Studio screenshot and a normal EOS stop.

Image quality validation: failed for high-reasoning screenshot analysis on 2026-07-23. The model received the 4,235-token image input but produced a long fabricated description after initially recognizing a software interface. Do not treat this hybrid as quality-validated vision serving.

Vision reasoning: enabled in the installed Local Studio runtime with `high` and `max` thinking levels. Pi Bash and filesystem tools are restored; extensions, skills, and injected project context remain isolated from vision sessions.

MMMU-Pro: paused at user request on 2026-07-23 after 102 durable records from four concurrent workers. There are 101 responses, one recorded HTTP 400 for `test_Math_11` because its 4,235 image embeddings exceed the configured 4,225 encoder cache, and 93 parseable answers with 25 correct. Failed and unparseable records are excluded from the provisional score.

Post-start error scan: clean

Controller health: `http://100.90.62.80:8080/health` returned `200`

Rollback service: `glm52-v3`, stopped and recoverable

Rollback command: `cd /home/ser/glm52-vision-prep && MODEL_DIR=/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision ./rollback.sh`
