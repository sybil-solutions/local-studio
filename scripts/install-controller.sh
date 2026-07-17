#!/usr/bin/env bash
# Local Studio controller installer — idempotent, single machine.
#
#   curl -fsSL https://raw.githubusercontent.com/sybil-solutions/local-studio/main/scripts/install-controller.sh | bash
#   # or piped over ssh by the desktop app's "Deploy controller" flow.
#
# Env overrides:
#   LOCAL_STUDIO_DIR   install dir            (default: $HOME/local-studio)
#   LOCAL_STUDIO_PORT  controller port        (default: 8080)
#   LOCAL_STUDIO_REPO  git repo to clone      (default: official repo)
#
# Prints a final machine-readable line on success:
#   LOCAL_STUDIO_CONTROLLER {"url":"http://<host>:<port>","api_key":"<key>"}
set -euo pipefail
umask 077

DIR="${LOCAL_STUDIO_DIR:-$HOME/local-studio}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
REPO="${LOCAL_STUDIO_REPO:-https://github.com/sybil-solutions/local-studio.git}"
BUN="$HOME/.bun/bin/bun"

log() { printf '[local-studio] %s\n' "$*"; }

case "$DIR" in
  /*) ;;
  *) DIR="$PWD/$DIR" ;;
esac

case "/$DIR/" in
  */../*|*/./*) log "refusing non-canonical install path at $DIR"; exit 1 ;;
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

require_identity() {
  local path="$1"
  local identity="$2"
  if [ "$(path_identity "$path" 2>/dev/null || true)" != "$identity" ]; then
    log "refusing replaced path at $path"
    exit 1
  fi
}

require_safe_ancestors() {
  local target="$1"
  local path="$target"
  while [ "$path" != "/" ]; do
    if [ -L "$path" ]; then
      log "refusing symlinked path component at $path"
      exit 1
    fi
    if [ -e "$path" ]; then
      if [ ! -d "$path" ]; then
        log "refusing non-directory path component at $path"
        exit 1
      fi
      if ! trusted_owner "$path"; then
        log "refusing untrusted path owner at $path"
        exit 1
      fi
      if [ "$path" != "$target" ] && { path_has_mode "$path" -002 || path_has_mode "$path" -020; }; then
        if [ "$(path_uid "$path")" != "0" ] || ! path_has_mode "$path" -1000; then
          log "refusing writable path ancestor at $path"
          exit 1
        fi
      fi
    fi
    path="$(dirname "$path")"
  done
}

require_safe_file() {
  local path="$1"
  if [ -L "$path" ] || { [ -e "$path" ] && { [ ! -f "$path" ] || [ ! -O "$path" ]; }; }; then
    log "refusing unsafe file at $path"
    exit 1
  fi
  if [ -e "$path" ]; then
    local identity
    identity="$(path_identity "$path")"
    chmod 600 "$path"
    require_identity "$path" "$identity"
  fi
}

require_safe_directory() {
  local path="$1"
  if [ -L "$path" ] || { [ -e "$path" ] && { [ ! -d "$path" ] || [ ! -O "$path" ]; }; }; then
    log "refusing unsafe directory at $path"
    exit 1
  fi
}

require_trusted_directory() {
  local path="$1"
  require_safe_ancestors "$path"
  if [ -L "$path" ] || [ ! -d "$path" ] || ! trusted_owner "$path" || [ ! -O "$path" ] || path_is_writable "$path"; then
    log "refusing unsafe directory at $path"
    exit 1
  fi
}

require_trusted_file() {
  local path="$1"
  require_safe_ancestors "$(dirname "$path")"
  if [ -L "$path" ] || [ ! -f "$path" ] || ! trusted_owner "$path" || [ ! -O "$path" ] || path_is_writable "$path"; then
    log "refusing unsafe file at $path"
    exit 1
  fi
}

require_trusted_tree() {
  local root="$1"
  local path
  require_trusted_directory "$root"
  while IFS= read -r -d '' path; do
    if [ -d "$path" ] && [ ! -L "$path" ]; then
      require_trusted_directory "$path"
    elif [ -f "$path" ] && [ ! -L "$path" ]; then
      require_trusted_file "$path"
    else
      log "refusing unsafe runtime path at $path"
      exit 1
    fi
  done < <(find "$root" -mindepth 1 -print0)
}

PROCESS_OWNERSHIP_HELPER="$DIR/scripts/controller-process-ownership.sh"

runtime_manifest() {
  {
    printf '%s\n' "$DIR" "$DIR/controller" "$DIR/controller/package.json" "$PROCESS_OWNERSHIP_HELPER"
    [ ! -e "$DIR/controller/tsconfig.json" ] || printf '%s\n' "$DIR/controller/tsconfig.json"
    [ -z "$LOCK_PATH" ] || printf '%s\n' "$LOCK_PATH"
    find "$DIR/controller/src" -mindepth 0 -print
    [ ! -d "$DIR/controller/contracts" ] || find "$DIR/controller/contracts" -mindepth 0 -print
  } | LC_ALL=C sort | while IFS= read -r path; do
    printf '%s|%s\n' "$path" "$(path_identity "$path")"
  done
}

require_runtime_directory() {
  local path="$1"
  require_safe_ancestors "$path"
  if [ -L "$path" ] || [ ! -d "$path" ] || ! trusted_owner "$path" || path_is_writable "$path"; then
    log "refusing unsafe runtime directory at $path"
    exit 1
  fi
}

canonical_file() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1"
  else
    readlink -f "$1"
  fi
}

validate_bun() {
  local candidate="$1"
  local resolved
  require_runtime_directory "$(dirname "$candidate")"
  if [ -L "$candidate" ] && ! trusted_owner "$candidate"; then
    log "refusing unsafe bun executable at $candidate"
    exit 1
  fi
  resolved="$(canonical_file "$candidate" 2>/dev/null || true)"
  if [ -z "$resolved" ]; then
    log "refusing unresolved bun executable at $candidate"
    exit 1
  fi
  require_runtime_directory "$(dirname "$resolved")"
  if [ ! -f "$resolved" ] || [ ! -x "$resolved" ] || [ -L "$resolved" ] || ! trusted_owner "$resolved" || path_is_writable "$resolved"; then
    log "refusing unsafe bun executable at $resolved"
    exit 1
  fi
  BUN="$resolved"
  BUN_IDENTITY="$(path_identity "$BUN")"
}

validate_checkout_inputs() {
  require_trusted_directory "$DIR"
  require_trusted_directory "$DIR/controller"
  require_trusted_tree "$DIR/controller/src"
  if [ -d "$DIR/controller/contracts" ] || [ -L "$DIR/controller/contracts" ]; then
    require_trusted_tree "$DIR/controller/contracts"
  fi
  require_trusted_file "$DIR/controller/package.json"
  require_trusted_directory "$DIR/scripts"
  require_trusted_file "$PROCESS_OWNERSHIP_HELPER"
  if [ -e "$DIR/controller/tsconfig.json" ] || [ -L "$DIR/controller/tsconfig.json" ]; then
    require_trusted_file "$DIR/controller/tsconfig.json"
  fi
  if [ -e "$DIR/controller/bun.lock" ] || [ -L "$DIR/controller/bun.lock" ]; then
    require_trusted_file "$DIR/controller/bun.lock"
  fi
  if [ -e "$DIR/controller/bun.lockb" ] || [ -L "$DIR/controller/bun.lockb" ]; then
    require_trusted_file "$DIR/controller/bun.lockb"
  fi
}

prepare_private_directory() {
  local path="$1"
  require_safe_ancestors "$path"
  require_safe_directory "$path"
  mkdir -p -m 700 "$path"
  chmod 700 "$path"
  require_safe_directory "$path"
}

prepare_private_file() {
  local path="$1"
  require_safe_file "$path"
  if [ ! -e "$path" ]; then
    set -C
    if ! : > "$path"; then
      set +C
      log "refusing raced file at $path"
      exit 1
    fi
    set +C
  fi
  chmod 600 "$path"
  require_safe_file "$path"
}

# --- prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || { log "git is required — install it and rerun"; exit 1; }
command -v curl >/dev/null 2>&1 || { log "curl is required — install it and rerun"; exit 1; }

if [ ! -x "$BUN" ] && ! command -v bun >/dev/null 2>&1; then
  log "installing bun…"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
fi
[ -x "$BUN" ] || BUN="$(command -v bun)"
validate_bun "$BUN"
require_identity "$BUN" "$BUN_IDENTITY"
log "bun: $("$BUN" --version)"

require_safe_ancestors "$DIR"
if [ -e "$DIR" ] || [ -L "$DIR" ]; then
  require_safe_directory "$DIR"
  chmod 700 "$DIR"
  require_safe_directory "$DIR"
fi

# --- source ------------------------------------------------------------------
if [ -e "$DIR/.git" ] || [ -L "$DIR/.git" ]; then
  require_trusted_directory "$DIR/.git"
  GIT_IDENTITY="$(path_identity "$DIR/.git")"
  log "updating existing checkout at $DIR"
  require_identity "$DIR/.git" "$GIT_IDENTITY"
  git -C "$DIR" pull --ff-only || log "pull failed (local changes?) — keeping current checkout"
  require_identity "$DIR/.git" "$GIT_IDENTITY"
elif [ -e "$DIR/controller" ] || [ -L "$DIR/controller" ]; then
  require_trusted_directory "$DIR/controller"
  log "using existing non-git install at $DIR (left untouched)"
else
  log "cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

prepare_private_directory "$DIR"
validate_checkout_inputs
CONTROLLER_IDENTITY="$(path_identity "$DIR/controller")"
SOURCE_IDENTITY="$(path_identity "$DIR/controller/src")"
BOOTSTRAP_IDENTITY="$(path_identity "$DIR/controller/src/bootstrap.ts")"
PACKAGE_IDENTITY="$(path_identity "$DIR/controller/package.json")"
PROCESS_OWNERSHIP_IDENTITY="$(path_identity "$PROCESS_OWNERSHIP_HELPER")"
LOCK_PATH=""
LOCK_IDENTITY=""
if [ -f "$DIR/controller/bun.lock" ]; then
  LOCK_PATH="$DIR/controller/bun.lock"
  LOCK_IDENTITY="$(path_identity "$LOCK_PATH")"
elif [ -f "$DIR/controller/bun.lockb" ]; then
  LOCK_PATH="$DIR/controller/bun.lockb"
  LOCK_IDENTITY="$(path_identity "$LOCK_PATH")"
fi
RUNTIME_MANIFEST="$(runtime_manifest)"

require_checkout_identity() {
  require_runtime_directory "$(dirname "$BUN")"
  if [ ! -f "$BUN" ] || [ ! -x "$BUN" ] || [ -L "$BUN" ] || ! trusted_owner "$BUN" || path_is_writable "$BUN"; then
    log "refusing unsafe bun executable at $BUN"
    exit 1
  fi
  validate_checkout_inputs
  require_identity "$BUN" "$BUN_IDENTITY"
  require_identity "$DIR/controller" "$CONTROLLER_IDENTITY"
  require_identity "$DIR/controller/src" "$SOURCE_IDENTITY"
  require_identity "$DIR/controller/src/bootstrap.ts" "$BOOTSTRAP_IDENTITY"
  require_identity "$DIR/controller/package.json" "$PACKAGE_IDENTITY"
  require_identity "$PROCESS_OWNERSHIP_HELPER" "$PROCESS_OWNERSHIP_IDENTITY"
  [ -z "$LOCK_PATH" ] || require_identity "$LOCK_PATH" "$LOCK_IDENTITY"
  if [ "$(runtime_manifest)" != "$RUNTIME_MANIFEST" ]; then
    log "refusing changed controller runtime"
    exit 1
  fi
}

log "installing controller dependencies…"
require_checkout_identity
if ! (cd "$DIR/controller" && "$BUN" install >/dev/null 2>&1); then
  require_checkout_identity
  (cd "$DIR/controller" && "$BUN" install)
fi
require_checkout_identity

# --- config ------------------------------------------------------------------
ENV_FILE="$DIR/.env"
prepare_private_file "$ENV_FILE"
if [ -f "$ENV_FILE" ] && grep -q '^LOCAL_STUDIO_API_KEY=' "$ENV_FILE"; then
  API_KEY="$(grep '^LOCAL_STUDIO_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  log "reusing existing API key from .env"
else
  if command -v openssl >/dev/null 2>&1; then
    API_KEY="$(openssl rand -hex 32)"
  else
    API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  ENV_TEMP="$(mktemp "$DIR/.env.XXXXXX")"
  {
    cat "$ENV_FILE"
    echo "LOCAL_STUDIO_PORT=$PORT"
    # A deployed controller exists to be reached from other machines; the API
    # key is the access control.
    echo "LOCAL_STUDIO_HOST=0.0.0.0"
    echo "LOCAL_STUDIO_API_KEY=$API_KEY"
  } > "$ENV_TEMP"
  chmod 600 "$ENV_TEMP"
  mv -f "$ENV_TEMP" "$ENV_FILE"
  prepare_private_file "$ENV_FILE"
  log "wrote $ENV_FILE"
fi
prepare_private_file "$ENV_FILE"
prepare_private_directory "$DIR/data"
LOG_FILE="$DIR/data/controller.log"
prepare_private_file "$LOG_FILE"
prepare_private_directory "$DIR/data/logs"
APP_LOG_FILE="$DIR/data/logs/vllm_controller.log"
prepare_private_file "$APP_LOG_FILE"

# --- service -----------------------------------------------------------------
require_checkout_identity
. "$PROCESS_OWNERSHIP_HELPER"
started=""
CONTROLLER_DIR="$DIR/controller"
BOOTSTRAP="$CONTROLLER_DIR/src/bootstrap.ts"
LEGACY_ENTRYPOINT="$CONTROLLER_DIR/src/main.ts"

controller_record_for_pid() {
  controller_process_record "$1" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT"
}

controller_record_has_exact_listener() {
  controller_require_exact_listener_record "$PORT" "$1" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT"
}

startup_listener_matches_pid() {
  local listener_pids="$1"
  local pid="$2"
  [ -z "$listener_pids" ] || { [ -n "$pid" ] && [ "$listener_pids" = "$pid" ]; }
}

wait_for_controller_pid() {
  local pid="$1"
  local attempt record="" listener_pids
  for attempt in $(seq 1 100); do
    record="$(controller_record_for_pid "$pid")" || true
    if [ -n "$record" ] && controller_record_has_exact_listener "$record"; then
      printf '%s\n' "$record"
      return 0
    fi
    listener_pids="$(controller_process_listener_pids "$PORT")" || return $?
    startup_listener_matches_pid "$listener_pids" "$pid" || return 1
    if [ "$attempt" -gt 5 ]; then
      controller_process_alive "$pid" || return 1
    fi
    sleep 0.1
  done
  return 1
}

stop_started_record() {
  local record="$1"
  [ -n "$record" ] || return 0
  controller_process_record_is_current "$record" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT" || return 0
  controller_stop_owned_processes "$record" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT" || true
}

SYSTEMD_RUNTIME_DIRECTORY="${LOCAL_STUDIO_SYSTEMD_RUNTIME_DIR:-/run/systemd/system}"
if command -v systemctl >/dev/null 2>&1 && [ -d "$SYSTEMD_RUNTIME_DIRECTORY" ] && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  # Port-scoped unit name so multiple installs on one box never clobber each
  # other's service definition.
  UNIT_NAME="local-studio-controller-$PORT.service"
  UNIT_FILE="$UNIT_DIR/$UNIT_NAME"
  systemd_property_value() {
    local properties="$1"
    local key="$2"
    printf '%s\n' "$properties" | sed -n "s/^${key}=//p" | tail -1
  }
  environment_file_matches() {
    local value="$1"
    case "$value" in
      "$ENV_FILE"|"$ENV_FILE (ignore_errors=no)"|"$ENV_FILE (ignore_errors=yes)") return 0 ;;
      *) return 1 ;;
    esac
  }
  exec_start_matches() {
    local value="$1"
    local entrypoint="$2"
    local path argv
    if [ "$value" = "$BUN $entrypoint" ]; then
      return 0
    fi
    path="$(printf '%s\n' "$value" | sed -n 's/^{ path=\([^;]*\) ;.*$/\1/p' | sed 's/[[:space:]]*$//')"
    argv="$(printf '%s\n' "$value" | sed -n 's/^.* argv\[\]=\([^;]*\) ;.*$/\1/p' | sed 's/[[:space:]]*$//')"
    [ "$path" = "$BUN" ] && [ "$argv" = "$BUN $entrypoint" ]
  }
  service_properties_belong_to_install() {
    local properties="$1"
    local load_state working_directory environment_files exec_start
    load_state="$(systemd_property_value "$properties" LoadState)"
    working_directory="$(systemd_property_value "$properties" WorkingDirectory)"
    environment_files="$(systemd_property_value "$properties" EnvironmentFiles)"
    exec_start="$(systemd_property_value "$properties" ExecStart)"
    [ "$load_state" = "loaded" ] || return 1
    environment_file_matches "$environment_files" || return 1
    if [ "$working_directory" = "$CONTROLLER_DIR" ]; then
      exec_start_matches "$exec_start" "$BOOTSTRAP"
      return
    fi
    if [ "$working_directory" = "$DIR" ]; then
      exec_start_matches "$exec_start" "$BOOTSTRAP" || exec_start_matches "$exec_start" "$LEGACY_ENTRYPOINT"
      return
    fi
    return 1
  }
  controller_service_state() {
    local service="$1"
    local properties
    if ! properties="$(systemctl --user show "$service" --property=LoadState --property=WorkingDirectory --property=EnvironmentFiles --property=ExecStart 2>/dev/null)"; then
      printf 'foreign\n'
    elif printf '%s\n' "$properties" | grep -Fqx 'LoadState=not-found'; then
      if systemctl --user cat "$service" >/dev/null 2>&1; then
        printf 'foreign\n'
      else
        printf 'absent\n'
      fi
    elif service_properties_belong_to_install "$properties"; then
      printf 'owned\n'
    else
      printf 'foreign\n'
    fi
  }
  systemd_main_pid() {
    local properties pid
    properties="$(systemctl --user show "$1" --property=MainPID 2>/dev/null)" || return 1
    pid="$(systemd_property_value "$properties" MainPID)"
    case "$pid" in
      ''|0|*[!0-9]*) return 1 ;;
    esac
    printf '%s\n' "$pid"
  }
  wait_for_systemd_controller() {
    local service="$1"
    local attempt pid record="" listener_pids
    for attempt in $(seq 1 100); do
      [ "$(controller_service_state "$service")" = "owned" ] || return 1
      pid=""
      pid="$(systemd_main_pid "$service")" || true
      if [ -n "$pid" ]; then
        record="$(controller_record_for_pid "$pid")" || true
        if [ -n "$record" ] && controller_record_has_exact_listener "$record"; then
          printf '%s\n' "$record"
          return 0
        fi
      fi
      listener_pids="$(controller_process_listener_pids "$PORT")" || return $?
      startup_listener_matches_pid "$listener_pids" "$pid" || return 1
      sleep 0.1
    done
    return 1
  }
  systemd_record_is_current() {
    local service="$1"
    local record="$2"
    local pid
    [ "$(controller_service_state "$service")" = "owned" ] || return 1
    pid="$(systemd_main_pid "$service")" || return 1
    [ "$pid" = "${record%%|*}" ] || return 1
    controller_record_has_exact_listener "$record"
  }
  TARGET_UNIT_STATE="$(controller_service_state "$UNIT_NAME")"
  if [ "$TARGET_UNIT_STATE" = "foreign" ] || { [ "$TARGET_UNIT_STATE" = "absent" ] && { [ -e "$UNIT_FILE" ] || [ -L "$UNIT_FILE" ]; }; }; then
    log "refusing foreign controller unit at $UNIT_NAME"
    exit 1
  fi
  owned_legacy_services=()
  for controller_service in vllm-studio-controller-b70.service vllm-studio-controller.service; do
    controller_service_state_value="$(controller_service_state "$controller_service")"
    if [ "$controller_service_state_value" = "owned" ]; then
      owned_legacy_services+=("$controller_service")
    elif [ "$controller_service_state_value" = "foreign" ] && systemctl --user is-active "$controller_service" >/dev/null 2>&1; then
      log "refusing foreign controller unit at $controller_service"
      exit 1
    fi
  done
  require_safe_controller_units() {
    local service state
    state="$(controller_service_state "$UNIT_NAME")"
    if [ "$state" = "foreign" ]; then
      log "refusing foreign controller unit at $UNIT_NAME"
      exit 1
    fi
    for service in vllm-studio-controller-b70.service vllm-studio-controller.service; do
      state="$(controller_service_state "$service")"
      if [ "$state" = "foreign" ] && systemctl --user is-active "$service" >/dev/null 2>&1; then
        log "refusing foreign controller unit at $service"
        exit 1
      fi
    done
  }
  require_safe_controller_units
  prepare_private_directory "$UNIT_DIR"
  require_safe_file "$UNIT_FILE"
  UNIT_TEMP="$(mktemp "$UNIT_DIR/.local-studio-controller.XXXXXX")"
  cat > "$UNIT_TEMP" <<UNIT
[Unit]
Description=Local Studio Controller
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$CONTROLLER_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BUN $BOOTSTRAP
Restart=on-failure
RestartSec=3
UMask=0077
StandardOutput=null
StandardError=null

[Install]
WantedBy=default.target
UNIT
  chmod 600 "$UNIT_TEMP"
  mv -f "$UNIT_TEMP" "$UNIT_FILE"
  prepare_private_file "$UNIT_FILE"

  write_controller_override() {
    local service="$1"
    local drop_in_directory="$UNIT_DIR/${service}.d"
    local override="$drop_in_directory/10-private-output.conf"
    local temporary_override
    [ "$service" != "$UNIT_NAME" ] || return 1
    [ "$(controller_service_state "$service")" = "owned" ] || return 1
    prepare_private_directory "$drop_in_directory"
    require_safe_file "$override"
    temporary_override="$(mktemp "$drop_in_directory/.local-studio-controller.XXXXXX")"
    printf '[Service]\nWorkingDirectory="%s/controller"\nExecStart=\nExecStart="%s" "%s/controller/src/bootstrap.ts"\nUMask=0077\nStandardOutput=null\nStandardError=null\n' "$DIR" "$BUN" "$DIR" > "$temporary_override"
    chmod 600 "$temporary_override"
    mv -f "$temporary_override" "$override"
    prepare_private_file "$override"
    return 0
  }

  migrated_services=()
  if [ "${#owned_legacy_services[@]}" -gt 0 ]; then
    for controller_service in "${owned_legacy_services[@]}"; do
      require_safe_controller_units
      if write_controller_override "$controller_service"; then
        migrated_services+=("$controller_service")
      fi
    done
  fi
  require_safe_controller_units
  systemctl --user daemon-reload
  if [ "${#migrated_services[@]}" -gt 0 ]; then
    require_safe_controller_units
    for controller_service in "${migrated_services[@]}"; do
      if [ "$(controller_service_state "$controller_service")" != "owned" ]; then
        log "refusing changed controller unit at $controller_service"
        exit 1
      fi
    done
    systemctl --user disable --now "${migrated_services[@]}" >/dev/null 2>&1 || true
  fi
  require_checkout_identity
  require_safe_controller_units
  if [ "$(controller_service_state "$UNIT_NAME")" != "owned" ]; then
    log "refusing changed controller unit at $UNIT_NAME"
    exit 1
  fi
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  # restart (not enable --now) so a rewritten unit definition always applies.
  require_checkout_identity
  require_safe_controller_units
  if [ "$(controller_service_state "$UNIT_NAME")" != "owned" ]; then
    log "refusing changed controller unit at $UNIT_NAME"
    exit 1
  fi
  systemctl --user restart "$UNIT_NAME"
  # Keep the service alive after logout where allowed (best effort).
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  VERIFIED_CONTROLLER_RECORD="$(wait_for_systemd_controller "$UNIT_NAME")" || {
    log "refusing unverified systemd controller process or listener"
    exit 1
  }
  started="systemd"
else
  log "no systemd — starting with nohup"
  PROCESS_RECORDS="$(controller_owned_process_records "$PORT" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT")" || {
    log "refusing unverifiable controller processes"
    exit 1
  }
  controller_require_listener_ownership "$PORT" "$PROCESS_RECORDS" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT" || {
    log "refusing foreign controller listener on port $PORT"
    exit 1
  }
  require_checkout_identity
  controller_stop_owned_processes "$PROCESS_RECORDS" "$BUN" "$DIR" "$CONTROLLER_DIR" "$BOOTSTRAP" "$LEGACY_ENTRYPOINT" || {
    log "refusing changed controller process"
    exit 1
  }
  controller_require_no_listener "$PORT" || {
    log "refusing occupied controller port $PORT"
    exit 1
  }
  require_checkout_identity
  (
    cd "$CONTROLLER_DIR"
    exec setsid nohup "$BUN" src/bootstrap.ts > /dev/null 2>&1 < /dev/null
  ) &
  STARTED_PID=$!
  VERIFIED_CONTROLLER_RECORD="$(wait_for_controller_pid "$STARTED_PID")" || {
    STARTED_RECORD="$(controller_record_for_pid "$STARTED_PID")" || true
    stop_started_record "$STARTED_RECORD"
    log "refusing unverified nohup controller process or listener"
    exit 1
  }
  started="nohup"
fi

# --- health ------------------------------------------------------------------
log "waiting for controller on :$PORT…"
for _ in $(seq 1 30); do
  if { [ "$started" = "systemd" ] && systemd_record_is_current "$UNIT_NAME" "$VERIFIED_CONTROLLER_RECORD"; } ||
    { [ "$started" = "nohup" ] && controller_record_has_exact_listener "$VERIFIED_CONTROLLER_RECORD"; }; then
    if ! curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
      sleep 2
      continue
    fi
    if { [ "$started" = "systemd" ] && ! systemd_record_is_current "$UNIT_NAME" "$VERIFIED_CONTROLLER_RECORD"; } ||
      { [ "$started" = "nohup" ] && ! controller_record_has_exact_listener "$VERIFIED_CONTROLLER_RECORD"; }; then
      log "controller ownership changed during health verification"
      exit 1
    fi
    HOST_ADDR=""
    if command -v tailscale >/dev/null 2>&1; then
      HOST_ADDR="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    fi
    if [ -z "$HOST_ADDR" ]; then
      HOST_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    fi
    [ -n "$HOST_ADDR" ] || HOST_ADDR="$(hostname)"
    log "controller healthy ($started)"
    printf 'LOCAL_STUDIO_CONTROLLER {"url":"http://%s:%s","api_key":"%s"}\n' "$HOST_ADDR" "$PORT" "$API_KEY"
    exit 0
  fi
  sleep 2
done

log "controller did not become healthy in 60s — check $APP_LOG_FILE"
exit 1
