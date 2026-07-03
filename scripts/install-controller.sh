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

DIR="${LOCAL_STUDIO_DIR:-$HOME/local-studio}"
PORT="${LOCAL_STUDIO_PORT:-8080}"
REPO="${LOCAL_STUDIO_REPO:-https://github.com/sybil-solutions/local-studio.git}"
BUN="$HOME/.bun/bin/bun"

log() { printf '[local-studio] %s\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || { log "git is required — install it and rerun"; exit 1; }
command -v curl >/dev/null 2>&1 || { log "curl is required — install it and rerun"; exit 1; }

if [ ! -x "$BUN" ] && ! command -v bun >/dev/null 2>&1; then
  log "installing bun…"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
fi
[ -x "$BUN" ] || BUN="$(command -v bun)"
log "bun: $("$BUN" --version)"

# --- source ------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  log "updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only || log "pull failed (local changes?) — keeping current checkout"
elif [ -d "$DIR/controller" ]; then
  log "using existing non-git install at $DIR (left untouched)"
else
  log "cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

log "installing controller dependencies…"
(cd "$DIR/controller" && "$BUN" install >/dev/null 2>&1) || (cd "$DIR/controller" && "$BUN" install)

# --- config ------------------------------------------------------------------
ENV_FILE="$DIR/.env"
if [ -f "$ENV_FILE" ] && grep -q '^LOCAL_STUDIO_API_KEY=' "$ENV_FILE"; then
  API_KEY="$(grep '^LOCAL_STUDIO_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  log "reusing existing API key from .env"
else
  if command -v openssl >/dev/null 2>&1; then
    API_KEY="$(openssl rand -hex 32)"
  else
    API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  {
    echo "LOCAL_STUDIO_PORT=$PORT"
    # A deployed controller exists to be reached from other machines; the API
    # key is the access control.
    echo "LOCAL_STUDIO_HOST=0.0.0.0"
    echo "LOCAL_STUDIO_API_KEY=$API_KEY"
  } >> "$ENV_FILE"
  log "wrote $ENV_FILE"
fi
mkdir -p "$DIR/data"

# --- service -----------------------------------------------------------------
started=""
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  # Port-scoped unit name so multiple installs on one box never clobber each
  # other's service definition.
  UNIT_NAME="local-studio-controller-$PORT.service"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$UNIT_NAME" <<UNIT
[Unit]
Description=Local Studio Controller
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
EnvironmentFile=$ENV_FILE
ExecStart=$BUN $DIR/controller/src/main.ts
Restart=on-failure
RestartSec=3
StandardOutput=append:$DIR/data/controller.log
StandardError=append:$DIR/data/controller.log

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  # restart (not enable --now) so a rewritten unit definition always applies.
  systemctl --user restart "$UNIT_NAME"
  # Keep the service alive after logout where allowed (best effort).
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
  started="systemd"
else
  log "no systemd — starting with nohup"
  pkill -f "$DIR/controller/src/main.ts" 2>/dev/null || true
  (cd "$DIR" && setsid nohup env "$(grep -v '^#' "$ENV_FILE" | xargs)" "$BUN" controller/src/main.ts >> "$DIR/data/controller.log" 2>&1 < /dev/null &)
  started="nohup"
fi

# --- health ------------------------------------------------------------------
log "waiting for controller on :$PORT…"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
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

log "controller did not become healthy in 60s — check $DIR/data/controller.log"
exit 1
