#!/usr/bin/env bash
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL_DIR="${MODEL_DIR:-/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision}"
export MODEL_DIR
docker compose -f "$BUNDLE_DIR/compose.yaml" down
docker start glm52-v3

