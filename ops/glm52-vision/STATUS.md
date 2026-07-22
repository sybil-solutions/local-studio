# GLM-5.2 NF3 Vision Cutover

Status: live and verified

Cutover completed: `2026-07-23T00:31:08+02:00`

Live service: `glm52-vision-candidate`

Served model: `GLM-5.2-Vision`

Live image: `local/glm52-nf3-vision:v3`

Live image digest: `sha256:be699e81f9b44e8cf293594ee5e1e92355d5f54ce0b408d5a29274b908df61d5`

Base checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid`

Live checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision`

Vision source: `baseten/GLM-5.2-Vision-NVFP4@f6eab6117386a0c69152fdf272dc65bfd0254f9f`

Checkpoint logical size: `366955275044` bytes

Added vision payload: `932887040` bytes

Context length: `200000`

Weight formats: `NVFP4`, `NF3`, and `MXFP8`

KV cache format: packed MLA `FP8`

NVFP4 KV cache: unsupported by the MLA backend and unavailable for SM120 in this runtime

Model memory: `87.61 GiB` per GPU

Available KV memory: `3.15 GiB`

GPU KV capacity: `216879` tokens

Maximum 200000-token concurrency: `1.08x`

CUDA graphs: PIECEWISE, FULL, prefill, and decode capture passed

MTP: five-token draft generation active; draft counters increase, accepted-token counter remains zero

Text validation: passed with `TEXT_OK`

Image validation: passed with `bus` for `https://ultralytics.com/images/bus.jpg`

Post-start error scan: clean

Controller health: `http://100.90.62.80:8080/health` returned `200`

Rollback service: `glm52-v3`, stopped and recoverable

Rollback command: `cd /home/ser/glm52-vision-prep && MODEL_DIR=/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision ./rollback.sh`
