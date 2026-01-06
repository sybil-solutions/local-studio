#!/usr/bin/env bash
set -euo pipefail

# OpenAI-compatible server for:
#   /home/ser/models/DeepSeek-V3.2-REAP-345B-W3A16
# using Transformers + AutoGPTQ/AutoRound sharded across 8x3090.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_PY="/opt/venvs/active/deepseek-w3a16/bin/python"
PID_FILE="/tmp/deepseek_w3a16_transformers_server.pid"
LOG_FILE="/tmp/deepseek_w3a16_transformers_server.log"

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1,2,3,4,5,6,7}"
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"

export DEEPSEEK_MODEL_PATH="${DEEPSEEK_MODEL_PATH:-/home/ser/models/DeepSeek-V3.2-REAP-345B-W3A16}"
export DEEPSEEK_SERVED_MODEL_NAME="${DEEPSEEK_SERVED_MODEL_NAME:-deepseek-v3.2-reap-w3a16}"
export DEEPSEEK_PORT="${DEEPSEEK_PORT:-8000}"
export DEEPSEEK_MAX_MEMORY_GIB="${DEEPSEEK_MAX_MEMORY_GIB:-22}"  # Use 22GB per GPU (leaves 2GB for KV cache)
export DEEPSEEK_OFFLOAD_DIR="${DEEPSEEK_OFFLOAD_DIR:-/tmp/deepseek_w3a16_offload}"
export DEEPSEEK_FOREGROUND="${DEEPSEEK_FOREGROUND:-0}"

mkdir -p "$DEEPSEEK_OFFLOAD_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" || true)"
  if [[ -n "${PID}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "DeepSeek server already running (pid $PID)."
    echo "Stop it with: scripts/deepseek/stop_transformers_server.sh"
    exit 0
  fi
fi

CMD=(env PYTHONPATH="$ROOT" "$VENV_PY" -m uvicorn scripts.deepseek.transformers_server:app --host 0.0.0.0 --port "$DEEPSEEK_PORT")

if [[ "$DEEPSEEK_FOREGROUND" == "1" ]]; then
  exec "${CMD[@]}"
fi

nohup "${CMD[@]}" >"$LOG_FILE" 2>&1 &
PID="$!"
echo "$PID" >"$PID_FILE"
echo "DeepSeek server started (pid $PID) on :$DEEPSEEK_PORT"
echo "Logs: $LOG_FILE"
