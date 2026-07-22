# GLM-5.2 NF3 Vision Preparation

Status: ready for controlled GPU cutover

Live service: `glm52-v3`

Live image: `madeby561/vllm-glm52-nvfp4-nf3-hybrid:v3`

Live image digest: `sha256:abc45785d6412ba2acf1edf59ccfa7d657ec60961c3d462f9af62a7158f38dea`

Base checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid`

Candidate checkpoint: `/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision`

Candidate image: `local/glm52-nf3-vision:v1@sha256:0af5f297813e8eafd5dee3a29c4377d09f52781fee321a45fe1e20c72c052f37`

Vision source: `baseten/GLM-5.2-Vision-NVFP4@f6eab6117386a0c69152fdf272dc65bfd0254f9f`

Candidate logical size: `366955274989` bytes

Added vision payload: `932887040` bytes

Static validation: passed

Validated architecture: `Glm5vForConditionalGeneration`

Validated MTP architecture: `DeepSeekMTPModel`

Validated image token: `154854`

Validated vision tensors: `329`

Validated projector tensors: `6`

Validated synthetic image patch grid: `[1, 2, 2]`

Cutover authorization: not granted

Cutover command: `cd /home/ser/glm52-vision-prep && CONFIRM_CUTOVER=glm52-vision MODEL_DIR=/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision ./cutover.sh`

Rollback command: `cd /home/ser/glm52-vision-prep && MODEL_DIR=/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision ./rollback.sh`

Next action: receive explicit cutover approval, start the candidate at 300000 context, then verify text, image, MTP, CUDA graphs, controller routing, and GPU headroom.
