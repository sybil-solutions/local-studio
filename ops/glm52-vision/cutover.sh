#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_CUTOVER:-}" != "glm52-vision" ]]; then
  echo "Set CONFIRM_CUTOVER=glm52-vision"
  exit 2
fi

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL_DIR="${MODEL_DIR:-/mnt/llm_models/GLM-5.2-MXFP8-NVFP4-NF3-Hybrid-Vision}"
export MODEL_DIR

test -f "$MODEL_DIR/VISION_PROVENANCE.json"
docker image inspect local/glm52-nf3-vision:v3 >/dev/null
docker stop glm52-v3
if ! docker compose -f "$BUNDLE_DIR/compose.yaml" up -d; then
  docker start glm52-v3
  exit 1
fi
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8000/v1/models >/dev/null; then
    echo "GLM-5.2-Vision is online"
    exit 0
  fi
  if ! docker inspect -f '{{.State.Running}}' glm52-vision-candidate 2>/dev/null | grep -qx true; then
    break
  fi
  sleep 5
done
docker inspect glm52-vision-candidate >"$BUNDLE_DIR/cutover-failure-inspect.json" 2>&1 || true
docker logs glm52-vision-candidate >"$BUNDLE_DIR/cutover-failure.log" 2>&1 || true
docker compose -f "$BUNDLE_DIR/compose.yaml" down
docker start glm52-v3
exit 1
