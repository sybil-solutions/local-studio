#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="${LOCAL_STUDIO_PID_FILE:-$ROOT/data/controller.pid}"
LOG_FILE="${LOCAL_STUDIO_LOG_FILE:-$ROOT/data/controller.log}"
BUN_BIN="${LOCAL_STUDIO_BUN_BIN:-$HOME/.bun/bin/bun}"

if [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="bun"
fi

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Controller already running (pid: $EXISTING_PID)"
    exit 0
  fi
fi

mkdir -p "$(dirname "$PID_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

nohup "$BUN_BIN" "$ROOT/controller/src/main.ts" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "Controller started (pid: $(cat "$PID_FILE"))"
