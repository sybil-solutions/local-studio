#!/usr/bin/env bash
# Local controller daemon helper: ./scripts/daemon.sh {start|stop|status}
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="${LOCAL_STUDIO_PID_FILE:-$ROOT/data/controller.pid}"
LOG_FILE="${LOCAL_STUDIO_LOG_FILE:-$ROOT/data/controller.log}"
BUN_BIN="${LOCAL_STUDIO_BUN_BIN:-$HOME/.bun/bin/bun}"

if [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="bun"
fi

running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

case "${1:-}" in
  start)
    if pid="$(running_pid)"; then
      echo "Controller already running (pid: $pid)"
      exit 0
    fi
    mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
    nohup "$BUN_BIN" "$ROOT/controller/src/main.ts" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Controller started (pid: $(cat "$PID_FILE"))"
    ;;
  stop)
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
    ;;
  status)
    if pid="$(running_pid)"; then
      echo "Controller running (pid: $pid)"
      exit 0
    fi
    if [ -f "$PID_FILE" ]; then
      echo "Controller not running (stale pid: $(cat "$PID_FILE"))"
    else
      echo "Controller not running."
    fi
    exit 1
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
