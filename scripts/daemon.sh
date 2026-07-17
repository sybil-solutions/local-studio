#!/usr/bin/env bash
# Local controller daemon helper: ./scripts/daemon.sh {start|stop|status}
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PID_FILE="${LOCAL_STUDIO_PID_FILE:-$ROOT/data/controller.pid}"
LOG_FILE="${LOCAL_STUDIO_LOG_FILE:-$ROOT/data/controller.log}"
BUN_BIN="${LOCAL_STUDIO_BUN_BIN:-$HOME/.bun/bin/bun}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
PROCESS_OWNERSHIP_HELPER="$ROOT/scripts/controller-process-ownership.sh"

case "$PID_FILE" in
  /*) ;;
  *) PID_FILE="$PWD/$PID_FILE" ;;
esac

case "$LOG_FILE" in
  /*) ;;
  *) LOG_FILE="$PWD/$LOG_FILE" ;;
esac

case "/$PID_FILE/$LOG_FILE/" in
  */../*|*/./*) echo "Unsafe controller path" >&2; exit 1 ;;
esac

path_has_mode() {
  [ -n "$(find "$1" -prune -perm "$2" -print 2>/dev/null)" ]
}

path_uid() {
  stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1"
}

path_identity() {
  stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1"
}

trusted_owner() {
  local uid
  uid="$(path_uid "$1")"
  [ "$uid" = "0" ] || [ "$uid" = "$(id -u)" ]
}

path_is_writable() {
  path_has_mode "$1" -002 || path_has_mode "$1" -020
}

validate_runtime_file() {
  local path="$1"
  if [ -L "$path" ] || [ ! -f "$path" ] || [ ! -O "$path" ] || path_is_writable "$path"; then
    echo "Unsafe writable controller source: $path" >&2
    exit 1
  fi
}

validate_runtime_tree() {
  local root="$1"
  local path
  secure_ancestors "$root"
  while IFS= read -r -d '' path; do
    if [ -d "$path" ] && [ ! -L "$path" ]; then
      if [ ! -O "$path" ] || path_is_writable "$path"; then
        echo "Unsafe writable controller source: $path" >&2
        exit 1
      fi
    elif [ -f "$path" ] && [ ! -L "$path" ]; then
      validate_runtime_file "$path"
    else
      echo "Unsafe controller source: $path" >&2
      exit 1
    fi
  done < <(find "$root" -mindepth 0 -print0)
}

runtime_manifest() {
  {
    printf '%s\n' "$ROOT" "$ROOT/controller" "$ROOT/controller/package.json" "$PROCESS_OWNERSHIP_HELPER"
    [ ! -e "$ROOT/controller/tsconfig.json" ] || printf '%s\n' "$ROOT/controller/tsconfig.json"
    [ ! -e "$ROOT/controller/bun.lock" ] || printf '%s\n' "$ROOT/controller/bun.lock"
    [ ! -e "$ROOT/controller/bun.lockb" ] || printf '%s\n' "$ROOT/controller/bun.lockb"
    find "$ROOT/controller/src" -mindepth 0 -print
    [ ! -d "$ROOT/controller/contracts" ] || find "$ROOT/controller/contracts" -mindepth 0 -print
  } | LC_ALL=C sort | while IFS= read -r path; do
    printf '%s|%s\n' "$path" "$(path_identity "$path")"
  done
}

secure_ancestors() {
  local path="$1"
  local target="$1"
  while [ "$path" != "/" ]; do
    if [ -L "$path" ] || { [ -e "$path" ] && [ ! -d "$path" ]; }; then
      echo "Unsafe controller path: $path" >&2
      exit 1
    fi
    if [ -e "$path" ]; then
      if ! trusted_owner "$path"; then
        echo "Unsafe controller path owner: $path" >&2
        exit 1
      fi
      if [ "$path" != "$target" ] && { path_has_mode "$path" -002 || path_has_mode "$path" -020; }; then
        if [ "$(path_uid "$path")" != "0" ] || ! path_has_mode "$path" -1000; then
          echo "Unsafe writable controller ancestor: $path" >&2
          exit 1
        fi
      fi
    fi
    path="$(dirname "$path")"
  done
}

validate_runtime_paths() {
  local source_directory
  secure_ancestors "$ROOT"
  if [ -L "$ROOT" ] || [ ! -d "$ROOT" ] || [ ! -O "$ROOT" ]; then
    echo "Unsafe controller root: $ROOT" >&2
    exit 1
  fi
  if path_is_writable "$ROOT"; then
    echo "Unsafe writable controller root: $ROOT" >&2
    exit 1
  fi
  secure_ancestors "$ROOT/controller/src"
  for source_directory in "$ROOT/controller" "$ROOT/scripts"; do
    if [ -L "$source_directory" ] || [ ! -d "$source_directory" ] || [ ! -O "$source_directory" ]; then
      echo "Unsafe controller source: $source_directory" >&2
      exit 1
    fi
    if path_is_writable "$source_directory"; then
      echo "Unsafe writable controller source: $source_directory" >&2
      exit 1
    fi
  done
  validate_runtime_tree "$ROOT/controller/src"
  if [ -d "$ROOT/controller/contracts" ] || [ -L "$ROOT/controller/contracts" ]; then
    validate_runtime_tree "$ROOT/controller/contracts"
  fi
  validate_runtime_file "$ROOT/controller/package.json"
  validate_runtime_file "$PROCESS_OWNERSHIP_HELPER"
  [ ! -e "$ROOT/controller/tsconfig.json" ] || validate_runtime_file "$ROOT/controller/tsconfig.json"
  [ ! -e "$ROOT/controller/bun.lock" ] || validate_runtime_file "$ROOT/controller/bun.lock"
  [ ! -e "$ROOT/controller/bun.lockb" ] || validate_runtime_file "$ROOT/controller/bun.lockb"
  if [ ! -x "$BUN_BIN" ]; then
    BUN_BIN="$(command -v bun 2>/dev/null || true)"
  fi
  if [ -z "$BUN_BIN" ]; then
    echo "Unsafe bun executable" >&2
    exit 1
  fi
  local bun_directory
  bun_directory="$(dirname "$BUN_BIN")"
  secure_ancestors "$bun_directory"
  if [ -L "$bun_directory" ] || [ ! -d "$bun_directory" ] || ! trusted_owner "$bun_directory" || path_is_writable "$bun_directory" || [ -L "$BUN_BIN" ] || [ ! -f "$BUN_BIN" ] || [ ! -x "$BUN_BIN" ] || ! trusted_owner "$BUN_BIN" || path_is_writable "$BUN_BIN"; then
    echo "Unsafe bun executable" >&2
    exit 1
  fi
}

validate_runtime() {
  validate_runtime_paths
  local bootstrap="$ROOT/controller/src/bootstrap.ts"
  ROOT_IDENTITY="$(path_identity "$ROOT")"
  CONTROLLER_IDENTITY="$(path_identity "$ROOT/controller")"
  BOOTSTRAP_IDENTITY="$(path_identity "$bootstrap")"
  BUN_IDENTITY="$(path_identity "$BUN_BIN")"
  RUNTIME_MANIFEST="$(runtime_manifest)"
}

require_runtime_identity() {
  validate_runtime_paths
  [ "$(path_identity "$ROOT")" = "$ROOT_IDENTITY" ] &&
    [ "$(path_identity "$ROOT/controller")" = "$CONTROLLER_IDENTITY" ] &&
    [ "$(path_identity "$ROOT/controller/src/bootstrap.ts")" = "$BOOTSTRAP_IDENTITY" ] &&
    [ "$(path_identity "$BUN_BIN")" = "$BUN_IDENTITY" ] &&
    [ "$(runtime_manifest)" = "$RUNTIME_MANIFEST" ] || {
      echo "Controller runtime changed during validation" >&2
      exit 1
    }
}

secure_directory() {
  local path="$1"
  secure_ancestors "$path"
  if [ "$path" = "/" ] || [ -L "$path" ] || { [ -e "$path" ] && { [ ! -d "$path" ] || [ ! -O "$path" ]; }; }; then
    echo "Unsafe controller directory: $path" >&2
    exit 1
  fi
  mkdir -p -m 700 "$path"
  chmod 700 "$path"
  if [ -L "$path" ] || [ ! -d "$path" ] || [ ! -O "$path" ]; then
    echo "Unsafe controller directory: $path" >&2
    exit 1
  fi
}

validate_private_directory() {
  local path="$1"
  secure_ancestors "$path"
  if [ -e "$path" ] && { [ -L "$path" ] || [ ! -d "$path" ] || [ ! -O "$path" ] || path_has_mode "$path" -002 || path_has_mode "$path" -020; }; then
    echo "Unsafe controller directory: $path" >&2
    exit 1
  fi
}

secure_file() {
  local path="$1"
  if [ -L "$path" ] || { [ -e "$path" ] && { [ ! -f "$path" ] || [ ! -O "$path" ]; }; }; then
    echo "Unsafe controller file: $path" >&2
    exit 1
  fi
  if [ ! -e "$path" ]; then
    set -C
    if ! : > "$path"; then
      set +C
      echo "Unsafe controller file: $path" >&2
      exit 1
    fi
    set +C
  fi
  chmod 600 "$path"
}

safe_pid_file() {
  [ ! -L "$PID_FILE" ] && [ -f "$PID_FILE" ] && [ -O "$PID_FILE" ] && ! path_is_writable "$PID_FILE"
}

validate_runtime
. "$PROCESS_OWNERSHIP_HELPER"

pid_file_value() {
  safe_pid_file || return 1
  local value
  value="$(cat "$PID_FILE" 2>/dev/null)" || return 1
  case "$value" in
    ''|*$'\n'*) return 1 ;;
  esac
  printf '%s\n' "$value"
}

pid_file_pid() {
  local value pid
  value="$(pid_file_value)" || return 1
  pid="${value%%|*}"
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$pid"
}

pid_file_record() {
  local record pid start_identity
  record="$(pid_file_value)" || return 1
  pid="${record%%|*}"
  start_identity="${record#*|}"
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$record" != "$pid" ] && [ -n "$start_identity" ] && [ "${start_identity#*|}" = "$start_identity" ] || return 1
  controller_process_record_is_current "$record" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts" || return 1
  printf '%s\n' "$record"
}

require_pid_listener_ownership() {
  local record="$1"
  controller_require_exact_listener_record "$PORT" "$record" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts"
}

stop_started_process() {
  local record="$1"
  [ -n "$record" ] || return 0
  controller_process_record_is_current "$record" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts" || return 0
  controller_stop_owned_processes "$record" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts" || true
}

case "${1:-}" in
  start)
    secure_directory "$(dirname "$PID_FILE")"
    secure_directory "$(dirname "$LOG_FILE")"
    if record="$(pid_file_record)"; then
      require_pid_listener_ownership "$record" || {
        echo "Refusing controller PID without exact listener ownership" >&2
        exit 1
      }
      pid="${record%%|*}"
      echo "Controller already running (pid: $pid)"
      exit 0
    fi
    if [ -e "$PID_FILE" ] || [ -L "$PID_FILE" ]; then
      if pid="$(pid_file_pid)" && ! controller_process_alive "$pid"; then
        rm -f "$PID_FILE"
      else
        echo "Refusing unverified controller PID file" >&2
        exit 1
      fi
    fi
    PROCESS_RECORDS="$(controller_owned_process_records "$PORT" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts")" || {
      echo "Cannot verify controller processes" >&2
      exit 1
    }
    controller_require_listener_ownership "$PORT" "$PROCESS_RECORDS" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts" || {
      echo "Refusing foreign controller listener" >&2
      exit 1
    }
    if [ -n "$PROCESS_RECORDS" ]; then
      echo "Refusing controller process without verified PID file" >&2
      exit 1
    fi
    controller_require_no_listener "$PORT" || {
      echo "Refusing occupied controller port" >&2
      exit 1
    }
    secure_file "$PID_FILE"
    secure_file "$LOG_FILE"
    require_runtime_identity
    cd "$ROOT/controller"
    nohup "$BUN_BIN" src/bootstrap.ts > /dev/null 2>&1 &
    STARTED_PID=$!
    STARTED_RECORD=""
    for attempt in $(seq 1 100); do
      CANDIDATE_RECORD="$(controller_process_record "$STARTED_PID" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts")" || true
      if [ -n "$CANDIDATE_RECORD" ] && require_pid_listener_ownership "$CANDIDATE_RECORD"; then
        STARTED_RECORD="$CANDIDATE_RECORD"
        break
      fi
      LISTENER_PIDS="$(controller_process_listener_pids "$PORT")" || break
      [ -z "$LISTENER_PIDS" ] || break
      if [ "$attempt" -gt 5 ]; then
        controller_process_alive "$STARTED_PID" || break
      fi
      sleep 0.1
    done
    if [ -z "$STARTED_RECORD" ]; then
      stop_started_process "$CANDIDATE_RECORD"
      rm -f "$PID_FILE"
      echo "Cannot verify started controller process and exact listener" >&2
      exit 1
    fi
    require_pid_listener_ownership "$STARTED_RECORD" || {
      stop_started_process "$STARTED_RECORD"
      rm -f "$PID_FILE"
      echo "Controller listener ownership changed before PID persistence" >&2
      exit 1
    }
    printf '%s\n' "$STARTED_RECORD" > "$PID_FILE"
    chmod 600 "$PID_FILE" "$LOG_FILE"
    echo "Controller started (pid: $STARTED_PID)"
    ;;
  stop)
    validate_private_directory "$(dirname "$PID_FILE")"
    if [ -L "$PID_FILE" ] || { [ -e "$PID_FILE" ] && { [ ! -f "$PID_FILE" ] || [ ! -O "$PID_FILE" ]; }; }; then
      echo "Unsafe controller PID file: $PID_FILE" >&2
      exit 1
    fi
    if ! safe_pid_file; then
      echo "No PID file found."
      exit 0
    fi
    RECORD="$(pid_file_record)" || {
      echo "Refusing unverified controller PID file" >&2
      exit 1
    }
    require_pid_listener_ownership "$RECORD" || {
      echo "Refusing foreign controller listener" >&2
      exit 1
    }
    require_runtime_identity
    controller_stop_owned_processes "$RECORD" "$BUN_BIN" "$ROOT" "$ROOT/controller" "$ROOT/controller/src/bootstrap.ts" "$ROOT/controller/src/main.ts" || {
      echo "Refusing changed controller process" >&2
      exit 1
    }
    PID="${RECORD%%|*}"
    echo "Stopped controller (pid: $PID)"
    rm -f "$PID_FILE"
    ;;
  status)
    validate_private_directory "$(dirname "$PID_FILE")"
    if record="$(pid_file_record)" && require_pid_listener_ownership "$record"; then
      pid="${record%%|*}"
      echo "Controller running (pid: $pid)"
      exit 0
    fi
    if safe_pid_file; then
      pid="$(pid_file_pid 2>/dev/null || true)"
      echo "Controller not running (stale pid: ${pid:-unknown})"
    elif [ -e "$PID_FILE" ] || [ -L "$PID_FILE" ]; then
      echo "Unsafe controller PID file: $PID_FILE" >&2
      exit 1
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
