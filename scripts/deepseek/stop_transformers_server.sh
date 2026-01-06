#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/deepseek_w3a16_transformers_server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No pid file at $PID_FILE; attempting to stop uvicorn by process match."
  pkill -f "uvicorn scripts\\.deepseek\\.transformers_server:app" || true
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [[ -z "${PID}" ]]; then
  echo "Empty pid in $PID_FILE"
  exit 1
fi

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Process $PID is not running"
  exit 0
fi

kill "$PID"
echo "Sent SIGTERM to $PID"
