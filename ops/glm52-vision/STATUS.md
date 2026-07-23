# GLM-5.2 Hybrid and Vision Status

Status: GLM-5.2 Vision live with FP8 KV cache; text hybrid and NVFP4-KV vision candidate stopped

Vision FP8 launch: `2026-07-23T13:00:44Z`

Live service: `glm52-vision-fp8`

Served model: `GLM-5.2-Vision`

Live image: `local/glm52-nf3-vision:v5-nvfp4`

Live checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision`

Vision recipe: FP8 KV cache, `B12X_MLA_SPARSE`, DCP 4, async scheduling, and the 78-layer index-cache pattern.

Configured context length: `262144`

GPU KV capacity: `338176` tokens

Maximum 262144-token concurrency: `1.29x`

Post-launch validation: passed. `/health` and `/v1/models` report `GLM-5.2-Vision`; CUDA-graph capture completed normally; a multimodal request returned `IMAGE_OK`.

Live quality checks: a 1k text control returned its exact sentinel; an 8k control returned its sentinel before the bounded completion cut off a repeated continuation. A real screenshot request correctly identified the visible `SQLiteError: database or disk is full` controller-log error.

Conduit tailnet registration: passed through live backend discovery. The tailnet-backed service now reports `GLM-5.2-Vision` from its active OpenAI-compatible backend; no separate static model record is required.

NVFP4-KV test result: 1k and 4k control prompts returned `OK`; failure begins by 8k and is worse at 16k. The native NVFP4 KV cache did not resolve the long-context inference-quality concern.

Text hybrid: `glm52-v3` is stopped and recoverable. NVFP4-KV vision candidate: `glm52-vision-candidate` is stopped and recoverable.

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
