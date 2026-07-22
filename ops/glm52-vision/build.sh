#!/usr/bin/env bash
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${IMAGE:-local/glm52-nf3-vision:v1}"
MODEL_DIR="${MODEL_DIR:-/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision}"

docker build -t "$IMAGE" "$BUNDLE_DIR"
docker run --rm \
  --entrypoint /opt/venv/bin/python \
  -v "$MODEL_DIR:/model:ro" \
  "$IMAGE" \
  -m glm52_vision.validation /model

