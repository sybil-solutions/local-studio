#!/usr/bin/env bash
# Local Studio preflight checks. Exits non-zero only when a FAIL check trips.
# Needs only bash, coreutils, and curl.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
WARN=0
FAILED=0

if [ -t 1 ]; then
  C_PASS=$'\033[32m' C_WARN=$'\033[33m' C_FAIL=$'\033[31m' C_INFO=$'\033[36m' C_OFF=$'\033[0m'
else
  C_PASS="" C_WARN="" C_FAIL="" C_INFO="" C_OFF=""
fi

pass() { PASS=$((PASS + 1)); echo "${C_PASS}PASS${C_OFF}  $1"; }
warn() { WARN=$((WARN + 1)); echo "${C_WARN}WARN${C_OFF}  $1"; }
fail() { FAILED=$((FAILED + 1)); echo "${C_FAIL}FAIL${C_OFF}  $1"; }
info() { echo "${C_INFO}INFO${C_OFF}  $1"; }

echo "Local Studio doctor"
echo ""

# --- Toolchain ---
if command -v bun >/dev/null 2>&1; then
  pass "bun $(bun --version 2>/dev/null) found"
else
  fail "bun not found — install Bun 1.x (https://bun.sh)"
fi

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
  NODE_MAJOR="${NODE_VERSION#v}"
  NODE_MAJOR="${NODE_MAJOR%%.*}"
  if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then
    pass "node $NODE_VERSION (>= 20)"
  else
    fail "node $NODE_VERSION found, but Node.js 20+ is required"
  fi
else
  fail "node not found — install Node.js 20+"
fi

if command -v python3 >/dev/null 2>&1; then
  pass "python3 $(python3 --version 2>&1 | awk '{print $2}') found"
else
  fail "python3 not found — engine installs need Python 3.10+ on PATH"
fi

if command -v uv >/dev/null 2>&1; then
  pass "uv found ($(uv --version 2>/dev/null))"
else
  warn "uv not found — engine installs fall back to pip, which is much slower"
fi

# --- GPU stack (informational) ---
if command -v nvidia-smi >/dev/null 2>&1; then
  info "nvidia-smi found — CUDA backends (vllm/sglang) available"
elif command -v rocm-smi >/dev/null 2>&1; then
  info "rocm-smi found — ROCm stack detected"
elif [ "$(uname -s)" = "Darwin" ]; then
  info "no NVIDIA/ROCm tools (macOS) — Apple Silicon uses the MLX backend"
else
  info "neither nvidia-smi nor rocm-smi found — CUDA/ROCm serving unavailable"
fi

# --- Ports (informational) ---
port_status() {
  local port="$1" label="$2"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    info "port $port ($label): in use"
  else
    info "port $port ($label): free"
  fi
}
port_status 8080 "controller"
port_status 3000 "frontend"

# --- Directories ---
MODELS_DIR="${LOCAL_STUDIO_MODELS_DIR:-/models}"
if [ -d "$MODELS_DIR" ] && [ -w "$MODELS_DIR" ]; then
  pass "models dir $MODELS_DIR exists and is writable"
elif [ -d "$MODELS_DIR" ]; then
  warn "models dir $MODELS_DIR exists but is not writable"
else
  warn "models dir $MODELS_DIR does not exist — the controller will try to create it (set LOCAL_STUDIO_MODELS_DIR to override)"
fi

DATA_DIR="$ROOT/data"
if [ -d "$DATA_DIR" ] && [ -w "$DATA_DIR" ]; then
  pass "data dir $DATA_DIR is writable"
elif [ ! -d "$DATA_DIR" ] && [ -w "$ROOT" ]; then
  pass "data dir $DATA_DIR will be auto-created (repo root is writable)"
else
  warn "data dir $DATA_DIR is not writable"
fi

# --- Network ---
if command -v curl >/dev/null 2>&1; then
  if curl -sI --max-time 5 https://pypi.org >/dev/null 2>&1; then
    pass "pypi.org reachable — engine installs can download packages"
  else
    warn "pypi.org not reachable — engine installs will fail without network access"
  fi
else
  warn "curl not found — skipped pypi.org reachability check"
fi

# --- Summary ---
echo ""
echo "Summary: $PASS pass, $WARN warn, $FAILED fail"
echo ""
echo "Quick start:"
echo "  cd controller && bun install && bun src/main.ts   # controller on 127.0.0.1:8080"
echo "  cd frontend && npm ci && npm run dev              # frontend on http://localhost:3000"
echo "  open http://localhost:3000/setup                  # first-run setup wizard"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
