#!/usr/bin/env bash
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid}"
TARGET_DIR="${TARGET_DIR:-/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision}"
ASSET_DIR="${ASSET_DIR:-/mnt/llm_models/.glm52-vision-assets/f6eab6117386a0c69152fdf272dc65bfd0254f9f}"
REVISION="f6eab6117386a0c69152fdf272dc65bfd0254f9f"

mkdir -p "$ASSET_DIR"
hf download baseten/GLM-5.2-Vision-NVFP4 \
  --revision "$REVISION" \
  --include \
  config.json \
  chat_template.jinja \
  preprocessor_config.json \
  kimi_k25_processor.py \
  kimi_k25_vision_processing.py \
  media_utils.py \
  vision_tower.safetensors \
  mm_projector.safetensors \
  --local-dir "$ASSET_DIR"
python3 "$BUNDLE_DIR/prepare_checkpoint.py" \
  --source "$SOURCE_DIR" \
  --target "$TARGET_DIR" \
  --assets "$ASSET_DIR" \
  --bundle "$BUNDLE_DIR"
