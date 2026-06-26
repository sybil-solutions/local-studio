#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="${LOCAL_STUDIO_PID_FILE:-$ROOT/data/controller.pid}"

if [ ! -f "$PID_FILE" ]; then
  echo "Controller not running."
  exit 1
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  echo "Controller running (pid: $PID)"
  exit 0
fi

echo "Controller not running (stale pid: $PID)"
exit 1
