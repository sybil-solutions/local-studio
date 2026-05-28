#!/usr/bin/env bash
# Deploy vLLM Studio from this machine to the remote GPU server.
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
#   ./scripts/deploy-remote.sh infra        Restart Docker infra
#   ./scripts/deploy-remote.sh status       Check what's running (no changes)

set -euo pipefail
cd "$(dirname "$0")/.."

# ─── Config ───────────────────────────────────────────────────────────────

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

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
  remote "tail -20 /tmp/${label}-stdout.log" 2>/dev/null || true
  return 1
}

# ─── Sync ─────────────────────────────────────────────────────────────────

sync_controller() {
  step "Syncing controller"
  sync_dir controller/src/      "$REMOTE_DIR/controller/src/"
  sync_dir controller/scripts/  "$REMOTE_DIR/controller/scripts/" 2>/dev/null || true
  rsync -az -e "ssh $SSH_OPTS" \
    controller/package.json controller/tsconfig.json \
    "$REMOTE:$REMOTE_DIR/controller/" 2>/dev/null
  ok "controller/src → remote"
}

sync_frontend() {
  step "Syncing frontend"
  sync_dir frontend/src/ "$REMOTE_DIR/frontend/src/"
  local frontend_files=(
    frontend/package.json
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
  sync_config
}

# ─── Install ──────────────────────────────────────────────────────────────

install_controller() {
  step "Installing controller deps"
  remote "cd $REMOTE_DIR_SHELL/controller && ~/.bun/bin/bun install --frozen-lockfile 2>&1 | tail -1" || \
  remote "cd $REMOTE_DIR_SHELL/controller && ~/.bun/bin/bun install 2>&1 | tail -1"
  ok "bun install"
}

install_frontend() {
  step "Installing frontend deps"
  remote "cd $REMOTE_DIR_SHELL/frontend && npm install --silent 2>&1 | tail -3"
  ok "npm install"
}

build_frontend_local() {
  step "Building frontend locally"
  (cd frontend && npm run build)
  ok "local next build"

  step "Syncing frontend build"
  rsync -az --delete \
    --exclude 'cache' \
    -e "ssh $SSH_OPTS" \
    frontend/.next/ "$REMOTE:$REMOTE_DIR/frontend/.next/" 2>/dev/null
  ok ".next/ → remote"
}

# ─── Restart ──────────────────────────────────────────────────────────────

restart_controller() {
  step "Restarting controller on :8080"
  remote bash <<REMOTE
set -e
cd $REMOTE_DIR_SHELL
docker compose stop controller 2>/dev/null || true
pkill -f "bun.*controller/src/main.ts" 2>/dev/null || true
fuser -k 8080/tcp >/dev/null 2>&1 || true
sleep 1
set -a; source .env 2>/dev/null || true; set +a
nohup ~/.bun/bin/bun run controller/src/main.ts > /tmp/controller-stdout.log 2>&1 &
REMOTE
  wait_port 8080 controller || return 1
  ok "controller :8080 (pid $(remote "pgrep -f 'bun.*controller/src/main.ts'" 2>/dev/null || echo '?'))"
}

restart_frontend() {
  step "Restarting frontend on :3000"
  remote bash <<REMOTE
set -euo pipefail
cd $REMOTE_DIR_SHELL/frontend
docker compose -f ../docker-compose.yml stop frontend 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
fuser -k 3000/tcp >/dev/null 2>&1 || true
sleep 1
export BACKEND_URL=http://localhost:8080
nohup npx next start > /tmp/frontend-stdout.log 2>&1 &
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
  remote bash <<'REMOTE'
_g='\033[32m' _r='\033[31m' _d='\033[2m' _n='\033[0m'

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
curl -s http://localhost:8080/status 2>/dev/null | python3 -c "
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
  infra)
    sync_config; start_infra ;;
  status)
    show_status ;;
  ""|all)
    sync_all
    install_controller; install_frontend
    start_infra
    restart_controller; build_frontend_local; restart_frontend
    echo ""; show_status ;;
  *)
    echo "Usage: $(basename "$0") [all|controller|frontend|infra|status]"
    exit 1 ;;
esac
