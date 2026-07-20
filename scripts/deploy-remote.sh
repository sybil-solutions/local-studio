#!/usr/bin/env bash
# Deploy Local Studio from this machine to the remote GPU server.
#
# ─── Connection ───────────────────────────────────────────────────────────
#
#   Remote connection values are intentionally loaded from .env.local.
#   Required: REMOTE_HOST, REMOTE_USER, REMOTE_PATH.
#   Optional: REMOTE_SSH_KEY (defaults to ~/.ssh/id_ed25519).
#
# ─── What runs where ─────────────────────────────────────────────────────
#
#   Docker (infra only, stays up across deploys):
#     postgres:16       :5432   optional database service
#
#   Native on host (needs nvidia-smi + host process visibility):
#     controller (bun)  :8080   Model lifecycle, GPU stats, chat, recipes
#     frontend (next)   :3000   Web UI
#     agent-runtime     :8081   Standalone pi agent runtime sidecar (node,
#                               user systemd unit local-studio-agent-runtime).
#                               The frontend proxies its runtime/browser routes
#                               here via LOCAL_STUDIO_AGENT_RUNTIME_URL=
#                               http://127.0.0.1:8081 (exported by
#                               restart_frontend below) — required so SSE
#                               flushes through Next's standalone server.
#
#   Managed separately:
#     vLLM / SGLang     :8000   Inference (launched via controller or manually)
#
# ─── How it works ─────────────────────────────────────────────────────────
#
#   1. rsync  — push controller/src, frontend/src, shared/ to remote
#   2. install — bun install (controller), npm install (frontend)
#   3. restart — kill old process, start new one via nohup, wait for port
#   4. verify  — hit health endpoints, print GPU and model status
#
# ─── Usage ────────────────────────────────────────────────────────────────
#
#   ./scripts/deploy-remote.sh              Deploy everything
#   ./scripts/deploy-remote.sh controller   Controller only
#   ./scripts/deploy-remote.sh frontend     Frontend only
#   ./scripts/deploy-remote.sh agent-runtime  Agent-runtime sidecar only
#   ./scripts/deploy-remote.sh infra        Restart Docker infra
#   ./scripts/deploy-remote.sh status       Check what's running (no changes)

set -euo pipefail
cd "$(dirname "$0")/.."

# ─── Config ───────────────────────────────────────────────────────────────

dotenv_value() {
  local value="${1%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
  fi
  printf '%s' "$value"
}

load_deploy_environment() {
  local line key value
  [[ -f .env.local && ! -L .env.local ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" && "$line" != \#* && "$line" == *=* ]] || continue
    [[ "$line" != export\ * ]] || line="${line#export }"
    key="${line%%=*}"
    value="$(dotenv_value "${line#*=}")"
    case "$key" in
      REMOTE_HOST) REMOTE_HOST="$value" ;;
      REMOTE_USER) REMOTE_USER="$value" ;;
      REMOTE_PATH) REMOTE_PATH="$value" ;;
      REMOTE_SSH_KEY) REMOTE_SSH_KEY="$value" ;;
    esac
  done < .env.local
}

load_deploy_environment

: "${REMOTE_HOST:?Set REMOTE_HOST in .env.local}"
: "${REMOTE_USER:?Set REMOTE_USER in .env.local}"
: "${REMOTE_PATH:?Set REMOTE_PATH in .env.local}"

SSH_KEY="${REMOTE_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="$REMOTE_PATH"
REMOTE_DIR_SHELL="$(printf '%q' "$REMOTE_DIR")"

SSH_OPTS="-T -i $SSH_KEY -o ConnectTimeout=5"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

# ─── Output ───────────────────────────────────────────────────────────────

_c() { printf '\033[%sm' "$1"; }
_r="$(_c 31)" _g="$(_c 32)" _y="$(_c 33)" _b="$(_c 36)" _d="$(_c 2)" _n="$(_c 0)"

step() { printf '%s==>%s %s\n' "$_b" "$_n" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "$_g" "$_n" "$*"; }
warn() { printf '%s  !%s %s\n' "$_y" "$_n" "$*"; }
fail() { printf '%s  ✗%s %s\n' "$_r" "$_n" "$*"; }
dim()  { printf '%s%s%s\n' "$_d" "$*" "$_n"; }

die() { fail "$@"; exit 1; }

# ─── Helpers ──────────────────────────────────────────────────────────────

remote() { ssh $SSH_OPTS "$REMOTE" "$@"; }

# rsync a local directory to remote, excluding node_modules and build artifacts
sync_dir() {
  local src="$1" dst="$2"
  rsync -az --delete \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'bun.lock' \
    --exclude '.turbo' \
    --exclude '*.test.ts' \
    --exclude 'test-output' \
    -e "ssh $SSH_OPTS" \
    "$src" "$REMOTE:$dst" 2>&1 | grep -v 'cannot delete non-empty directory' || true
}

# Wait for a port to be listening, or fail after N seconds
wait_port() {
  local port="$1" label="$2" max="${3:-10}"
  for i in $(seq 1 "$max"); do
    if remote "ss -tlnp | grep -q ':${port}\b'" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "$label not listening on :$port after ${max}s"
  if [[ "$label" == "controller" ]]; then
    remote "tail -20 $REMOTE_DIR_SHELL/data/logs/vllm_controller.log" 2>/dev/null || true
  fi
  return 1
}

# ─── Sync ─────────────────────────────────────────────────────────────────

sync_controller() {
  step "Syncing controller"
  sync_dir controller/src/      "$REMOTE_DIR/controller/src/"
  sync_dir controller/contracts/ "$REMOTE_DIR/controller/contracts/"
  sync_dir controller/scripts/  "$REMOTE_DIR/controller/scripts/" 2>/dev/null || true
  rsync -az -e "ssh $SSH_OPTS" \
    controller/package.json controller/bun.lock controller/tsconfig.json \
    "$REMOTE:$REMOTE_DIR/controller/" 2>/dev/null
  ok "controller/src → remote"
}

sync_frontend() {
  step "Syncing frontend"
  sync_dir frontend/src/ "$REMOTE_DIR/frontend/src/"
  sync_dir frontend/scripts/ "$REMOTE_DIR/frontend/scripts/" 2>/dev/null || true
  local frontend_files=(
    frontend/package.json
    frontend/package-lock.json
    frontend/tsconfig.json
    frontend/next.config.ts
    frontend/tailwind.config.ts
    frontend/postcss.config.mjs
  )
  local existing_frontend_files=()
  for file in "${frontend_files[@]}"; do
    [[ -e "$file" ]] && existing_frontend_files+=("$file")
  done
  rsync -az -e "ssh $SSH_OPTS" \
    "${existing_frontend_files[@]}" \
    "$REMOTE:$REMOTE_DIR/frontend/" 2>/dev/null
  ok "frontend/src → remote"
}

sync_shared() {
  step "Syncing shared types"
  sync_dir shared/ "$REMOTE_DIR/shared/"
  ok "shared/ → remote"
}

sync_services() {
  step "Syncing services (agent-runtime)"
  # services/node_modules is a symlink bridge to frontend/node_modules
  # (recreated by frontend postinstall); rsync must not follow or delete it.
  rsync -az --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '*.test.ts' \
    -e "ssh $SSH_OPTS" \
    services/agent-runtime/ "$REMOTE:$REMOTE_DIR/services/agent-runtime/" 2>&1 |
    grep -v 'cannot delete non-empty directory' || true
  remote "mkdir -p $REMOTE_DIR_SHELL/scripts/systemd"
  rsync -az -e "ssh $SSH_OPTS" \
    scripts/systemd/local-studio-agent-runtime.service \
    "$REMOTE:$REMOTE_DIR/scripts/systemd/"
  ok "services/agent-runtime → remote"
}

sync_config() {
  step "Syncing infra config"
  remote "rm -rf $REMOTE_DIR_SHELL/config"
  rsync -az -e "ssh $SSH_OPTS" \
    docker-compose.yml .env.example \
    "$REMOTE:$REMOTE_DIR/"
  ok "docker-compose.yml → remote, removed legacy config/"
}

sync_all() {
  sync_controller
  sync_frontend
  sync_shared
  sync_services
  sync_config
}

# ─── Install ──────────────────────────────────────────────────────────────

install_controller() {
  step "Installing controller deps"
  remote bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
remote_dir=$1
bun_bin="$HOME/.bun/bin/bun"

path_has_mode() {
  [[ -n "$(find "$1" -prune -perm "$2" -print 2>/dev/null)" ]]
}

path_uid() {
  stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1"
}

path_identity() {
  stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1"
}

trusted_owner() {
  local uid
  uid=$(path_uid "$1")
  [[ "$uid" == "0" || "$uid" == "$(id -u)" ]]
}

path_is_writable() {
  path_has_mode "$1" -002 || path_has_mode "$1" -020
}

require_runtime_tree() {
  local target=$1
  local label=$2
  local path=$target
  while [[ "$path" != "/" ]]; do
    if [[ -L "$path" || ! -d "$path" ]] || ! trusted_owner "$path"; then
      echo "Unsafe $label: $path" >&2
      exit 1
    fi
    if path_is_writable "$path"; then
      if [[ "$path" != "$target" && "$(path_uid "$path")" == "0" ]] && path_has_mode "$path" -1000; then
        path=$(dirname "$path")
        continue
      fi
      echo "Unsafe writable $label: $path" >&2
      exit 1
    fi
    path=$(dirname "$path")
  done
}

require_runtime_file() {
  local path=$1
  require_runtime_tree "$(dirname "$path")" "controller source"
  if [[ -L "$path" || ! -f "$path" ]] || ! trusted_owner "$path" || path_is_writable "$path"; then
    echo "Unsafe writable controller source: $path" >&2
    exit 1
  fi
}

require_source_tree() {
  local root=$1
  local path
  require_runtime_tree "$root" "controller source"
  while IFS= read -r -d '' path; do
    if [[ -d "$path" && ! -L "$path" ]]; then
      require_runtime_tree "$path" "controller source"
    elif [[ -f "$path" && ! -L "$path" ]]; then
      require_runtime_file "$path"
    else
      echo "Unsafe controller source: $path" >&2
      exit 1
    fi
  done < <(find "$root" -mindepth 1 -print0)
}

validate_runtime() {
  case "$remote_dir" in
    /*) ;;
    *) echo "Unsafe controller root: $remote_dir" >&2; exit 1 ;;
  esac
  case "/$remote_dir/" in
    */../*|*/./*) echo "Unsafe controller root: $remote_dir" >&2; exit 1 ;;
  esac
  require_source_tree "$remote_dir/controller/src"
  if [[ -d "$remote_dir/controller/contracts" || -L "$remote_dir/controller/contracts" ]]; then
    require_source_tree "$remote_dir/controller/contracts"
  fi
  require_runtime_file "$remote_dir/controller/package.json"
  [[ ! -e "$remote_dir/controller/tsconfig.json" ]] || require_runtime_file "$remote_dir/controller/tsconfig.json"
  [[ ! -e "$remote_dir/controller/bun.lock" ]] || require_runtime_file "$remote_dir/controller/bun.lock"
  [[ ! -e "$remote_dir/controller/bun.lockb" ]] || require_runtime_file "$remote_dir/controller/bun.lockb"
  require_runtime_tree "$(dirname "$bun_bin")" "bun executable"
  if [[ -L "$bun_bin" || ! -f "$bun_bin" || ! -x "$bun_bin" ]] || ! trusted_owner "$bun_bin" || path_is_writable "$bun_bin"; then
    echo "Unsafe Bun executable: $bun_bin" >&2
    exit 1
  fi
}

runtime_manifest() {
  {
    printf '%s\n' "$remote_dir" "$remote_dir/controller" "$remote_dir/controller/package.json" "$bun_bin"
    [[ ! -e "$remote_dir/controller/tsconfig.json" ]] || printf '%s\n' "$remote_dir/controller/tsconfig.json"
    [[ ! -e "$remote_dir/controller/bun.lock" ]] || printf '%s\n' "$remote_dir/controller/bun.lock"
    [[ ! -e "$remote_dir/controller/bun.lockb" ]] || printf '%s\n' "$remote_dir/controller/bun.lockb"
    find "$remote_dir/controller/src" -mindepth 0 -print
    [[ ! -d "$remote_dir/controller/contracts" ]] || find "$remote_dir/controller/contracts" -mindepth 0 -print
  } | LC_ALL=C sort | while IFS= read -r path; do
    printf '%s|%s\n' "$path" "$(path_identity "$path")"
  done
}

validate_runtime
validated_manifest=$(runtime_manifest)
require_runtime_identity() {
  validate_runtime
  if [[ "$(runtime_manifest)" != "$validated_manifest" ]]; then
    echo "Controller runtime changed during validation" >&2
    exit 1
  fi
}

require_runtime_identity
cd "$remote_dir/controller"
if ! "$bun_bin" install --frozen-lockfile >/dev/null 2>&1; then
  require_runtime_identity
  "$bun_bin" install >/dev/null 2>&1
fi
require_runtime_identity
REMOTE
  ok "bun install"
}

install_frontend() {
  step "Installing frontend deps"
  remote "cd $REMOTE_DIR_SHELL/frontend && npm install --silent 2>&1 | tail -3"
  remote "cd $REMOTE_DIR_SHELL/frontend && node scripts/patch-pi-ai-openai-text-boundaries.mjs"
  ok "npm install"
}

build_frontend_local() {
  step "Building frontend locally"
  (cd frontend && npm run build)
  ok "local next build"

  step "Syncing frontend build"
  remote "rm -rf $REMOTE_DIR_SHELL/frontend/.next/standalone/data"
  rsync -az --delete \
    --exclude 'cache' \
    --exclude 'standalone/data' \
    -e "ssh $SSH_OPTS" \
    frontend/.next/ "$REMOTE:$REMOTE_DIR/frontend/.next/" 2>/dev/null
  ok ".next/ → remote"
}

# Build the agent-runtime sidecar on the remote. tsc + node resolve through
# services/node_modules -> frontend/node_modules (created by the frontend
# postinstall), so install_frontend must have run at least once before this.
build_agent_runtime() {
  step "Building agent-runtime (tsc → dist/)"
  remote "cd $REMOTE_DIR_SHELL/services/agent-runtime && npm run build >/tmp/agent-runtime-build.log 2>&1" ||
    { remote "tail -20 /tmp/agent-runtime-build.log" || true; return 1; }
  ok "services/agent-runtime/dist"
}

# ─── Restart ──────────────────────────────────────────────────────────────

# Restart the agent-runtime sidecar via its user systemd unit. Installs/updates
# the unit from scripts/systemd/local-studio-agent-runtime.service, filling the
# @APP_DIR@ and @NODE@ placeholders with the remote project path and node
# binary. Health check: GET http://127.0.0.1:8081/health.
restart_agent_runtime() {
  step "Restarting agent-runtime on :8081 (systemd user unit)"
  remote bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
remote_dir=$1
node_bin=$(command -v node || true)
if [[ -z "$node_bin" ]]; then
  echo "node not found on remote PATH" >&2
  exit 1
fi
mkdir -p ~/.config/systemd/user
sed -e "s|@APP_DIR@|$remote_dir|g" -e "s|@NODE@|$node_bin|g" \
  "$remote_dir/scripts/systemd/local-studio-agent-runtime.service" \
  > ~/.config/systemd/user/local-studio-agent-runtime.service
systemctl --user daemon-reload
systemctl --user enable --now local-studio-agent-runtime.service >/dev/null 2>&1 || true
systemctl --user restart local-studio-agent-runtime.service
REMOTE
  wait_port 8081 agent-runtime 15 || return 1
  if remote "curl -sf -m 3 http://127.0.0.1:8081/health >/dev/null"; then
    ok "agent-runtime :8081 healthy"
  else
    fail "agent-runtime :8081 /health failed"
    remote "journalctl --user -u local-studio-agent-runtime -n 20 --no-pager" 2>/dev/null || true
    return 1
  fi
}

restart_controller() {
  step "Restarting controller on :8080"
  remote bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
remote_dir=$1

require_runtime_file() {
  local path=$1
  require_runtime_tree "$(dirname "$path")" "controller source"
  if [[ -L "$path" || ! -f "$path" ]] || ! trusted_owner "$path" || path_is_writable "$path"; then
    echo "Unsafe writable controller source: $path" >&2
    exit 1
  fi
}

require_source_tree() {
  local root=$1
  local path
  require_runtime_tree "$root" "controller source"
  while IFS= read -r -d '' path; do
    if [[ -d "$path" && ! -L "$path" ]]; then
      require_runtime_tree "$path" "controller source"
    elif [[ -f "$path" && ! -L "$path" ]]; then
      require_runtime_file "$path"
    else
      echo "Unsafe controller source: $path" >&2
      exit 1
    fi
  done < <(find "$root" -mindepth 1 -print0)
}

path_has_mode() {
  [[ -n "$(find "$1" -prune -perm "$2" -print 2>/dev/null)" ]]
}

path_uid() {
  stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1"
}

path_identity() {
  stat -f '%d:%i' "$1" 2>/dev/null || stat -c '%d:%i' "$1"
}

trusted_owner() {
  local uid
  uid=$(path_uid "$1")
  [[ "$uid" == "0" || "$uid" == "$(id -u)" ]]
}

path_is_writable() {
  path_has_mode "$1" -002 || path_has_mode "$1" -020
}

require_runtime_tree() {
  local target=$1
  local label=$2
  local path=$target
  while [[ "$path" != "/" ]]; do
    if [[ -L "$path" || ! -d "$path" ]] || ! trusted_owner "$path"; then
      echo "Unsafe $label: $path" >&2
      exit 1
    fi
    if path_is_writable "$path"; then
      if [[ "$path" != "$target" && "$(path_uid "$path")" == "0" ]] && path_has_mode "$path" -1000; then
        path=$(dirname "$path")
        continue
      fi
      echo "Unsafe writable $label: $path" >&2
      exit 1
    fi
    path=$(dirname "$path")
  done
}

case "$remote_dir" in
  /*) ;;
  *) echo "Unsafe controller root: $remote_dir" >&2; exit 1 ;;
esac
case "/$remote_dir/" in
  */../*|*/./*) echo "Unsafe controller root: $remote_dir" >&2; exit 1 ;;
esac

bootstrap="$remote_dir/controller/src/bootstrap.ts"
legacy_entrypoint="$remote_dir/controller/src/main.ts"
controller_dir=$(readlink -f "$remote_dir/controller")
bun_bin="$HOME/.bun/bin/bun"
proc_root=${LOCAL_STUDIO_PROCESS_PROC_ROOT:-/proc}

validate_controller_runtime() {
  require_source_tree "$remote_dir/controller/src"
  if [[ -d "$remote_dir/controller/contracts" || -L "$remote_dir/controller/contracts" ]]; then
    require_source_tree "$remote_dir/controller/contracts"
  fi
  require_runtime_file "$remote_dir/controller/package.json"
  [[ ! -e "$remote_dir/controller/tsconfig.json" ]] || require_runtime_file "$remote_dir/controller/tsconfig.json"
  [[ ! -e "$remote_dir/controller/bun.lock" ]] || require_runtime_file "$remote_dir/controller/bun.lock"
  [[ ! -e "$remote_dir/controller/bun.lockb" ]] || require_runtime_file "$remote_dir/controller/bun.lockb"
  require_runtime_tree "$(dirname "$bun_bin")" "bun executable"
  if [[ -L "$bun_bin" || ! -f "$bun_bin" || ! -x "$bun_bin" ]] || ! trusted_owner "$bun_bin" || path_is_writable "$bun_bin"; then
    echo "Unsafe Bun executable: $bun_bin" >&2
    exit 1
  fi
}

runtime_manifest() {
  {
    printf '%s\n' "$remote_dir" "$remote_dir/controller" "$remote_dir/controller/package.json" "$bun_bin"
    [[ ! -e "$remote_dir/controller/tsconfig.json" ]] || printf '%s\n' "$remote_dir/controller/tsconfig.json"
    [[ ! -e "$remote_dir/controller/bun.lock" ]] || printf '%s\n' "$remote_dir/controller/bun.lock"
    [[ ! -e "$remote_dir/controller/bun.lockb" ]] || printf '%s\n' "$remote_dir/controller/bun.lockb"
    find "$remote_dir/controller/src" -mindepth 0 -print
    [[ ! -d "$remote_dir/controller/contracts" ]] || find "$remote_dir/controller/contracts" -mindepth 0 -print
  } | LC_ALL=C sort | while IFS= read -r path; do
    printf '%s|%s\n' "$path" "$(path_identity "$path")"
  done
}

validate_controller_runtime
validated_manifest=$(runtime_manifest)

require_runtime_identity() {
  validate_controller_runtime
  if [[ "$(runtime_manifest)" != "$validated_manifest" ]]; then
    echo "Controller runtime changed during validation" >&2
    exit 1
  fi
}

property_value() {
  local properties=$1
  local key=$2
  printf '%s\n' "$properties" | sed -n "s/^${key}=//p" | tail -1
}

environment_file_matches() {
  local value=$1
  case "$value" in
    "$remote_dir/.env"|"$remote_dir/.env (ignore_errors=no)"|"$remote_dir/.env (ignore_errors=yes)") return 0 ;;
    *) return 1 ;;
  esac
}

exec_start_matches() {
  local value=$1
  local entrypoint=$2
  local path argv
  if [[ "$value" == "$bun_bin $entrypoint" ]]; then
    return 0
  fi
  path=$(printf '%s\n' "$value" | sed -n 's/^{ path=\([^;]*\) ;.*$/\1/p' | sed 's/[[:space:]]*$//')
  argv=$(printf '%s\n' "$value" | sed -n 's/^.* argv\[\]=\([^;]*\) ;.*$/\1/p' | sed 's/[[:space:]]*$//')
  [[ "$path" == "$bun_bin" && "$argv" == "$bun_bin $entrypoint" ]]
}

service_properties_belong_to_install() {
  local properties=$1
  local load_state working_directory environment_files exec_start
  load_state=$(property_value "$properties" LoadState)
  working_directory=$(property_value "$properties" WorkingDirectory)
  environment_files=$(property_value "$properties" EnvironmentFiles)
  exec_start=$(property_value "$properties" ExecStart)
  [[ "$load_state" == "loaded" ]] || return 1
  environment_file_matches "$environment_files" || return 1
  if [[ "$working_directory" == "$controller_dir" ]]; then
    exec_start_matches "$exec_start" "$bootstrap"
    return
  fi
  if [[ "$working_directory" == "$remote_dir" ]]; then
    exec_start_matches "$exec_start" "$bootstrap" || exec_start_matches "$exec_start" "$legacy_entrypoint"
    return
  fi
  return 1
}

controller_service_state() {
  local service=$1
  local properties
  if ! properties=$(systemctl --user show "$service" --property=LoadState --property=WorkingDirectory --property=EnvironmentFiles --property=ExecStart 2>/dev/null); then
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

process_start_identity() {
  local pid=$1
  cat "$proc_root/$pid/stat" 2>/dev/null | awk '{print $22}'
}

process_arguments() {
  local pid=$1
  cat "$proc_root/$pid/cmdline" 2>/dev/null | tr '\0' '\n'
}

process_alive() {
  local pid=$1
  if [[ "$proc_root" != "/proc" ]]; then
    [[ -f "$proc_root/$pid/alive" ]] || kill -0 "$pid" 2>/dev/null
    return
  fi
  kill -0 "$pid" 2>/dev/null
}

process_uid() {
  local pid=$1
  stat -f '%u' "$proc_root/$pid" 2>/dev/null || stat -c '%u' "$proc_root/$pid" 2>/dev/null
}

pid_belongs_to_install() {
  local pid=$1
  local expected_start=${2:-}
  local cwd process_name executable arguments start_identity expected_absolute expected_relative uid
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  process_alive "$pid" || return 1
  uid=$(process_uid "$pid")
  [[ "$uid" == "$(id -u)" ]] || return 1
  cwd=$(readlink -f "$proc_root/$pid/cwd" 2>/dev/null || true)
  process_name=$(cat "$proc_root/$pid/comm" 2>/dev/null || true)
  executable=$(readlink -f "$proc_root/$pid/exe" 2>/dev/null || true)
  arguments=$(process_arguments "$pid")
  start_identity=$(process_start_identity "$pid")
  expected_absolute=$(printf '%s\n%s' "$bun_bin" "$bootstrap")
  expected_relative=$(printf '%s\n%s' "$bun_bin" "src/bootstrap.ts")
  [[ "$cwd" == "$controller_dir" && "$process_name" == "bun" && "$executable" == "$bun_bin" ]] || return 1
  [[ "$arguments" == "$expected_absolute" || "$arguments" == "$expected_relative" ]] || return 1
  [[ -n "$start_identity" ]] || return 1
  [[ -z "$expected_start" || "$start_identity" == "$expected_start" ]]
}

collect_owned_controller_processes() {
  local pid start_identity
  for pid in $(pgrep -x bun 2>/dev/null || true); do
    if pid_belongs_to_install "$pid"; then
      start_identity=$(process_start_identity "$pid")
      printf '%s:%s\n' "$pid" "$start_identity"
    fi
  done | sed '/^$/d' | sort -n -u
}

collect_listener_pids() {
  local pid port_pids
  port_pids=$(fuser 8080/tcp 2>/dev/null || true)
  for pid in $port_pids; do
    printf '%s\n' "$pid"
  done | sed '/^$/d' | sort -n -u
}

single_listener_pid() {
  local listener_pids=$1
  local count
  count=$(printf '%s\n' "$listener_pids" | sed -n '/^[0-9][0-9]*$/p' | wc -l | tr -d '[:space:]')
  [[ "$count" == "1" ]] || return 1
  printf '%s\n' "$listener_pids"
}

process_records_contain_pid() {
  local expected=$1
  local records=$2
  local record
  while IFS= read -r record; do
    [[ "${record%%:*}" != "$expected" ]] || return 0
  done <<< "$records"
  return 1
}

port_is_listening() {
  ss -tlnp 2>/dev/null | grep -q ':8080\b'
}

require_owned_listener() {
  local owned_processes listener_pids listener_pid
  owned_processes=$(collect_owned_controller_processes)
  listener_pids=$(collect_listener_pids)
  if ! port_is_listening && [[ -z "$listener_pids" ]]; then
    return 0
  fi
  if [[ -z "$listener_pids" ]]; then
    echo "Refusing unowned listener on port 8080" >&2
    exit 1
  fi
  listener_pid=$(single_listener_pid "$listener_pids") || {
    echo "Refusing multiple listeners on port 8080" >&2
    exit 1
  }
  if ! process_records_contain_pid "$listener_pid" "$owned_processes"; then
    echo "Refusing unowned listener on port 8080: $listener_pid" >&2
    exit 1
  fi
}

require_exact_listener_record() {
  local record=$1
  local pid=${record%%:*}
  local start_identity=${record#*:}
  local listener_pids listener_pid
  pid_belongs_to_install "$pid" "$start_identity" || return 1
  port_is_listening || return 1
  listener_pids=$(collect_listener_pids)
  listener_pid=$(single_listener_pid "$listener_pids") || return 1
  [[ "$listener_pid" == "$pid" ]] || return 1
  pid_belongs_to_install "$pid" "$start_identity"
}

wait_for_exact_listener() {
  local pid=$1
  local start_identity record listener_pids listener_pid
  for _ in $(seq 1 100); do
    if pid_belongs_to_install "$pid"; then
      start_identity=$(process_start_identity "$pid")
      record="$pid:$start_identity"
      if require_exact_listener_record "$record"; then
        printf '%s\n' "$record"
        return 0
      fi
    fi
    listener_pids=$(collect_listener_pids)
    if port_is_listening || [[ -n "$listener_pids" ]]; then
      listener_pids=$(collect_listener_pids)
      listener_pid=$(single_listener_pid "$listener_pids") || return 1
      [[ "$listener_pid" == "$pid" ]] || return 1
    fi
    sleep 0.1
  done
  return 1
}

systemd_main_pid() {
  local properties pid
  properties=$(systemctl --user show "$1" --property=MainPID 2>/dev/null) || return 1
  pid=$(property_value "$properties" MainPID)
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$pid"
}

wait_for_systemd_controller() {
  local service=$1
  local pid record listener_pids listener_pid
  for _ in $(seq 1 100); do
    [[ "$(controller_service_state "$service")" == "owned" ]] || return 1
    pid=$(systemd_main_pid "$service" || true)
    if [[ -n "$pid" ]] && pid_belongs_to_install "$pid"; then
      record="$pid:$(process_start_identity "$pid")"
      if require_exact_listener_record "$record"; then
        printf '%s\n' "$record"
        return 0
      fi
    fi
    listener_pids=$(collect_listener_pids)
    if port_is_listening || [[ -n "$listener_pids" ]]; then
      listener_pids=$(collect_listener_pids)
      [[ -n "$pid" ]] || return 1
      listener_pid=$(single_listener_pid "$listener_pids") || return 1
      [[ "$listener_pid" == "$pid" ]] || return 1
    fi
    sleep 0.1
  done
  return 1
}

require_systemd_record() {
  local service=$1
  local record=$2
  local pid
  [[ "$(controller_service_state "$service")" == "owned" ]] || return 1
  pid=$(systemd_main_pid "$service") || return 1
  [[ "$pid" == "${record%%:*}" ]] || return 1
  require_exact_listener_record "$record"
}

require_controller_health() {
  local record=$1
  local service=${2:-}
  for _ in $(seq 1 30); do
    if { [[ -z "$service" ]] && require_exact_listener_record "$record"; } ||
      { [[ -n "$service" ]] && require_systemd_record "$service" "$record"; }; then
      if curl -fsS -m 3 http://127.0.0.1:8080/health >/dev/null 2>&1; then
        if { [[ -z "$service" ]] && require_exact_listener_record "$record"; } ||
          { [[ -n "$service" ]] && require_systemd_record "$service" "$record"; }; then
          return 0
        fi
        return 1
      fi
    fi
    sleep 0.2
  done
  return 1
}

require_controller_preflight() {
  require_runtime_identity
  require_safe_controller_units
  require_owned_listener
}

cd "$remote_dir"
controller_services=(local-studio-controller-8080.service vllm-studio-controller-b70.service vllm-studio-controller.service)
exact_controller_service=${controller_services[0]}
owned_controller_services=()
owned_controller_service_count=0
active_controller_services=()
active_controller_service_count=0
for controller_service in "${controller_services[@]}"; do
  controller_service_state=$(controller_service_state "$controller_service")
  if [[ "$controller_service_state" == "owned" ]]; then
    owned_controller_services+=("$controller_service")
    owned_controller_service_count=$((owned_controller_service_count + 1))
  elif [[ "$controller_service_state" == "foreign" ]] &&
    { [[ "$controller_service" == "$exact_controller_service" ]] ||
      systemctl --user is-active "$controller_service" >/dev/null 2>&1; }; then
    echo "Refusing foreign controller unit: $controller_service" >&2
    exit 1
  fi
done
require_safe_controller_units() {
  local service state
  for service in "${controller_services[@]}"; do
    state=$(controller_service_state "$service")
    if [[ "$state" == "foreign" ]] &&
      { [[ "$service" == "$exact_controller_service" ]] ||
        systemctl --user is-active "$service" >/dev/null 2>&1; }; then
      echo "Refusing foreign controller unit: $service" >&2
      exit 1
    fi
  done
}
if ! command -v ss >/dev/null 2>&1; then
  echo "Cannot verify controller port ownership without ss" >&2
  exit 1
fi
require_controller_preflight

if [[ $owned_controller_service_count -gt 0 ]]; then
  for controller_service in "${owned_controller_services[@]}"; do
    require_controller_preflight
    [[ "$(controller_service_state "$controller_service")" == "owned" ]] || {
      echo "Refusing changed controller unit: $controller_service" >&2
      exit 1
    }
    service_dropin="$HOME/.config/systemd/user/${controller_service}.d"
    mkdir -p -m 700 "$service_dropin"
    chmod 700 "$service_dropin"
    output_dropin="$(mktemp "$service_dropin/private-output.XXXXXX")"
    printf '[Service]\nWorkingDirectory="%s/controller"\nExecStart=\nExecStart="%s" "%s/controller/src/bootstrap.ts"\nUMask=0077\nStandardOutput=null\nStandardError=null\n' "$remote_dir" "$bun_bin" "$remote_dir" > "$output_dropin"
    chmod 600 "$output_dropin"
    mv -f "$output_dropin" "$service_dropin/10-private-output.conf"
    if systemctl --user is-active "$controller_service" >/dev/null 2>&1; then
      active_controller_services+=("$controller_service")
      active_controller_service_count=$((active_controller_service_count + 1))
    fi
  done
  require_controller_preflight
  systemctl --user daemon-reload
fi
if [[ $active_controller_service_count -gt 0 ]]; then
  [[ $active_controller_service_count -eq 1 ]] || {
    echo "Refusing multiple active controller services" >&2
    exit 1
  }
  for controller_service in "${active_controller_services[@]}"; do
    require_controller_preflight
    [[ "$(controller_service_state "$controller_service")" == "owned" ]] || {
      echo "Refusing changed controller unit: $controller_service" >&2
      exit 1
    }
    systemctl --user restart "$controller_service"
    controller_record=$(wait_for_systemd_controller "$controller_service") || {
      echo "Refusing unverified systemd controller process or listener" >&2
      exit 1
    }
    require_controller_health "$controller_record" "$controller_service" || {
      echo "Controller health was not served by the systemd MainPID" >&2
      exit 1
    }
  done
  exit 0
fi
require_controller_preflight
docker compose stop controller 2>/dev/null || true
controller_processes=$(collect_owned_controller_processes)
if [[ -n "$controller_processes" ]]; then
  while IFS=: read -r pid start_identity; do
    [[ -z "$pid" ]] || ! pid_belongs_to_install "$pid" "$start_identity" || kill -TERM "$pid" 2>/dev/null || true
  done <<< "$controller_processes"

  for _ in $(seq 1 20); do
    if [[ -z "$(collect_owned_controller_processes)" ]]; then
      break
    fi
    sleep 0.25
  done

  controller_processes=$(collect_owned_controller_processes)
  if [[ -n "$controller_processes" ]]; then
    while IFS=: read -r pid start_identity; do
      [[ -z "$pid" ]] || ! pid_belongs_to_install "$pid" "$start_identity" || kill -KILL "$pid" 2>/dev/null || true
    done <<< "$controller_processes"
    sleep 1
  fi
fi

remaining_listener_pids=$(collect_listener_pids)
if port_is_listening || [[ -n "$remaining_listener_pids" ]]; then
  echo "Port 8080 is still in use after stopping controller processes" >&2
  ss -tlnp | grep ':8080\b' >&2 || true
  exit 1
fi

sleep 1
require_runtime_identity
cd "$controller_dir"
nohup "$bun_bin" src/bootstrap.ts > /dev/null 2>&1 &
started_pid=$!
controller_record=$(wait_for_exact_listener "$started_pid") || {
  echo "Refusing unverified nohup controller process or listener" >&2
  exit 1
}
require_controller_health "$controller_record" || {
  echo "Controller health was not served by the launched process" >&2
  exit 1
}
REMOTE
  ok "controller :8080 verified"
}

restart_frontend() {
  step "Restarting frontend on :3000"
  remote bash -s -- "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
remote_dir=$1
frontend_service=vllm-studio-frontend.service

restart_managed_frontend() {
  local unit_file="$HOME/.config/systemd/user/$frontend_service"
  local drop_in_dir="${unit_file}.d"
  local drop_in
  systemctl --user cat "$frontend_service" >/dev/null 2>&1 || return 1
  [[ -f "$unit_file" ]] || return 1
  systemctl --user stop "$frontend_service" || return 1
  sed -i \
    's/vllm-studio-controller\.service/local-studio-controller-8080.service/g' \
    "$unit_file" || return 1
  for drop_in in "$drop_in_dir"/*.conf; do
    [[ -f "$drop_in" ]] || continue
    sed -i \
      's/vllm-studio-controller\.service/local-studio-controller-8080.service/g' \
      "$drop_in" || return 1
  done
  rm -f "$drop_in_dir/zz-local-studio-controller.conf"
  systemctl --user daemon-reload || return 1
  systemctl --user disable --now \
    vllm-studio-controller.service \
    vllm-studio-controller-b70.service >/dev/null 2>&1 || true
  fuser -k 3000/tcp >/dev/null 2>&1 || true
  systemctl --user restart "$frontend_service"
}

restart_detached_frontend() {
  cd "$remote_dir/frontend"
  docker compose -f "$remote_dir/docker-compose.yml" stop frontend 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "next dev" 2>/dev/null || true
  fuser -k 3000/tcp >/dev/null 2>&1 || true
  sleep 1
  export BACKEND_URL=http://localhost:8080
  export LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:8081
  nohup node scripts/start-standalone.mjs > /tmp/frontend-stdout.log 2>&1 &
}

restart_managed_frontend || restart_detached_frontend
REMOTE
  wait_port 3000 frontend 15 || return 1
  ok "frontend :3000 (production)"
}

# ─── Infra ────────────────────────────────────────────────────────────────

start_infra() {
  step "Starting Docker infra"
  remote "cd $REMOTE_DIR_SHELL && docker compose stop litellm 2>/dev/null || true"
  remote "cd $REMOTE_DIR_SHELL && docker compose up -d postgres 2>&1 | tail -5"
  ok "postgres :5432"
}

# ─── Status / diagnostics ────────────────────────────────────────────────

show_status() {
  step "Status"
  echo ""
  remote "cd $REMOTE_DIR_SHELL && bash" <<'REMOTE'
_g='\033[32m' _r='\033[31m' _d='\033[2m' _n='\033[0m'

if [[ -f .env && ! -L .env && -O .env ]]; then
  LOCAL_STUDIO_API_KEY="$(sed -n 's/^LOCAL_STUDIO_API_KEY=//p' .env | head -1)"
fi

case "${LOCAL_STUDIO_API_KEY:-}" in
  *[!A-Za-z0-9._~-]*) LOCAL_STUDIO_API_KEY="" ;;
esac

controller_curl() {
  if [[ -n "${LOCAL_STUDIO_API_KEY:-}" ]]; then
    printf 'header = "Authorization: Bearer %s"\n' "$LOCAL_STUDIO_API_KEY" | curl --config - "$@"
  else
    curl "$@"
  fi
}

probe() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo 000)
  if [[ "$code" =~ ^2 ]]; then
    printf "  ${_g}%-22s${_n} %s\n" "$label" ":$3 OK"
  else
    printf "  ${_r}%-22s${_n} %s\n" "$label" ":$3 ($code)"
  fi
}

probe "controller"      http://localhost:8080/health    8080
probe "agent-runtime"   http://localhost:8081/health    8081
probe "frontend"        http://localhost:3000            3000
probe "frontend→proxy"  http://localhost:3000/api/proxy/health 3000
probe "vllm"            http://localhost:8000/v1/models  8000

# Services that need port checks instead of HTTP probes
for pair in "postgres:5432"; do
  label="${pair%%:*}" port="${pair##*:}"
  if ss -tlnp 2>/dev/null | grep -q ":${port}\b"; then
    printf "  ${_g}%-22s${_n} %s\n" "$label" ":$port OK"
  else
    printf "  ${_r}%-22s${_n} %s\n" "$label" ":$port down"
  fi
done
echo ""

# GPU table
gpus=$(curl -s http://localhost:8080/gpus 2>/dev/null)
if echo "$gpus" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if not d.get('gpus'): sys.exit(1)
for g in d['gpus']:
    pct = g['memory_used_mb'] / g['memory_total_mb'] * 100
    print(f'  GPU {g[\"index\"]}  {g[\"name\"]:30s}  {g[\"memory_used_mb\"]:>5d}/{g[\"memory_total_mb\"]}MB ({pct:4.0f}%)  {g[\"temp_c\"]:>2d}°C  {g[\"power_draw\"]:>6.1f}W')
" 2>/dev/null; then
  echo ""
fi

# Running model
controller_curl -s http://localhost:8080/status 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('running'):
    p=d['process']
    print(f'  Model: {p[\"served_model_name\"]}  ({p[\"backend\"]}, pid {p[\"pid\"]}, :{p[\"port\"]})')
else:
    print('  Model: (none)')
" 2>/dev/null || true
REMOTE
}

# ─── Commands ─────────────────────────────────────────────────────────────

case "${1:-}" in
  controller)
    sync_controller; sync_shared; install_controller; restart_controller
    echo ""; show_status ;;
  frontend)
    sync_frontend; install_frontend; build_frontend_local; restart_frontend
    echo ""; show_status ;;
  agent-runtime)
    sync_shared; sync_services; build_agent_runtime; restart_agent_runtime
    echo ""; show_status ;;
  infra)
    sync_config; start_infra ;;
  status)
    show_status ;;
  ""|all)
    sync_all
    install_controller; install_frontend
    start_infra
    restart_controller
    build_agent_runtime; restart_agent_runtime
    build_frontend_local; restart_frontend
    echo ""; show_status ;;
  *)
    echo "Usage: $(basename "$0") [all|controller|frontend|agent-runtime|infra|status]"
    exit 1 ;;
esac
