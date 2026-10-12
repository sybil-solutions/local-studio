#!/usr/bin/env bash
# Keeps `npm run dev` alive — repairs corrupted .next and restarts after crashes,
# including Turbopack cache rot that leaves Next running but serving 500s.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${LOCAL_STUDIO_DEV_PORT:-3000}"
LOG="${ROOT}/.local-studio-dev.log"
RUN_LOG="${ROOT}/.local-studio-dev.run.log"
PIDFILE="${ROOT}/.local-studio-dev.pid"
DEV_PID=""
READY=0
BAD=0

stop_port() {
  local pids
  pids="$(lsof -ti:"$PORT" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "[dev-watch] stopping process(es) on :$PORT: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_dev() {
  if [ -n "${DEV_PID}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    local pgid
    pgid="$(ps -o pgid= -p "$DEV_PID" 2>/dev/null | tr -d ' ' || true)"
    kill "$DEV_PID" 2>/dev/null || true
    if [ -n "$pgid" ] && [ "$pgid" != "1" ]; then
      kill -- "-$pgid" 2>/dev/null || true
    fi
    sleep 1
    kill -9 "$DEV_PID" 2>/dev/null || true
    if [ -n "$pgid" ] && [ "$pgid" != "1" ]; then
      kill -9 -- "-$pgid" 2>/dev/null || true
    fi
    wait "$DEV_PID" 2>/dev/null || true
  fi
  DEV_PID=""
  stop_port
}

repair_cache() {
  echo "[dev-watch] clearing frontend/.next (Turbopack cache repair)"
  rm -rf "$ROOT/frontend/.next"
}

log_is_corrupt() {
  [ -f "$RUN_LOG" ] || return 1
  tail -n 240 "$RUN_LOG" 2>/dev/null | grep -E -q \
    'TurbopackInternalError|Failed to restore task data|ENOENT:.*app-paths-manifest|ENOENT:.*routes-manifest|ENOENT:.*\[turbopack\]_runtime|Cannot find module .*\[turbopack\]'
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${PORT}/" 2>/dev/null || echo 000
}

http_is_down() {
  local code
  code="$(http_code)"
  case "$code" in
    200|204|301|302|303|307|308)
      READY=1
      BAD=0
      return 1
      ;;
    500|502)
      if [ "$READY" -eq 1 ]; then
        BAD=$((BAD + 1))
      fi
      ;;
    *)
      BAD=0
      ;;
  esac
  [ "$READY" -eq 1 ] && [ "$BAD" -ge 3 ]
}

if [ "${1:-}" = "stop" ]; then
  if [ -f "$PIDFILE" ]; then
    watcher_pid="$(cat "$PIDFILE")"
    if kill -0 "$watcher_pid" 2>/dev/null; then
      echo "[dev-watch] stopping watcher (pid $watcher_pid)"
      kill "$watcher_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$watcher_pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
  stop_port
  echo "[dev-watch] stopped"
  exit 0
fi

if [ -f "$PIDFILE" ]; then
  old_pid="$(cat "$PIDFILE")"
  if kill -0 "$old_pid" 2>/dev/null; then
    echo "[dev-watch] already running (pid $old_pid). Use: npm run dev:stop"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

trap '' HUP
echo "[dev-watch] log → $LOG"
echo $$ >"$PIDFILE"
trap 'stop_dev; rm -f "$PIDFILE"' EXIT INT TERM

stop_port
cd "$ROOT"

while true; do
  echo "[dev-watch] starting dev @ $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
  READY=0
  BAD=0
  : >"$RUN_LOG"
  set +e
  npm run dev > >(tee -a "$LOG" "$RUN_LOG") 2>&1 &
  DEV_PID=$!
  live_repair=0
  while kill -0 "$DEV_PID" 2>/dev/null; do
    sleep 4
    if log_is_corrupt || http_is_down; then
      echo "[dev-watch] Next is unhealthy on :$PORT — repairing cache and restarting" | tee -a "$LOG"
      live_repair=1
      stop_dev
      break
    fi
  done
  if [ "$live_repair" -eq 0 ]; then
    wait "$DEV_PID"
    code="$?"
  else
    code=75
  fi
  DEV_PID=""
  set -e

  echo "[dev-watch] dev exited ($code) — repairing cache, restarting in 3s…" | tee -a "$LOG"
  stop_port
  repair_cache
  sleep 3
done
