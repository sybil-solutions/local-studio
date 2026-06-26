#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="${LOCAL_STUDIO_PID_FILE:-$ROOT/data/controller.pid}"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped controller (pid: $PID)"
else
  echo "Controller not running (stale pid: $PID)"
fi

rm -f "$PID_FILE"
