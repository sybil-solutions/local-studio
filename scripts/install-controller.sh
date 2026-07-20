#!/usr/bin/env bash
# Local Studio controller installer — idempotent, single machine.
#
#   curl -fsSL https://raw.githubusercontent.com/sybil-solutions/local-studio/main/scripts/install-controller.sh | bash
#   # or piped over ssh by the desktop app's "Deploy controller" flow.
#
# Env overrides:
#   LOCAL_STUDIO_DIR        source directory
#   LOCAL_STUDIO_DATA_DIR   persistent controller data directory
#   LOCAL_STUDIO_MODELS_DIR persistent model directory
#   LOCAL_STUDIO_HOST       controller bind host
#   LOCAL_STUDIO_PORT       controller port
#   LOCAL_STUDIO_REPO       git repo to clone
#
# Prints a final machine-readable line on success:
#   LOCAL_STUDIO_CONTROLLER {"url":"http://<host>:<port>","api_key":"<key>"}
set -euo pipefail

OS_NAME="$(uname -s)"
if [ "$OS_NAME" = "Darwin" ]; then
  DEFAULT_DIR="$HOME/Library/Application Support/Local Studio/controller-source"
  DEFAULT_DATA_DIR="$HOME/Library/Application Support/Local Studio/controller-data"
else
  DEFAULT_DIR="$HOME/local-studio"
  DEFAULT_DATA_DIR="$DEFAULT_DIR/data"
fi
DIR="${LOCAL_STUDIO_DIR:-$DEFAULT_DIR}"
DATA_DIR="${LOCAL_STUDIO_DATA_DIR:-$DEFAULT_DATA_DIR}"
MODELS_DIR="${LOCAL_STUDIO_MODELS_DIR:-$DATA_DIR/models}"
HOST="${LOCAL_STUDIO_HOST:-0.0.0.0}"
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
read_env_value() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-
}
if [ -f "$ENV_FILE" ] && grep -q '^LOCAL_STUDIO_API_KEY=' "$ENV_FILE"; then
  API_KEY="$(read_env_value LOCAL_STUDIO_API_KEY)"
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
    echo "LOCAL_STUDIO_HOST=$HOST"
    echo "LOCAL_STUDIO_API_KEY=$API_KEY"
    echo "LOCAL_STUDIO_DATA_DIR=$DATA_DIR"
    echo "LOCAL_STUDIO_MODELS_DIR=$MODELS_DIR"
  } >> "$ENV_FILE"
  log "wrote $ENV_FILE"
fi
grep -q '^LOCAL_STUDIO_HOST=' "$ENV_FILE" || echo "LOCAL_STUDIO_HOST=$HOST" >> "$ENV_FILE"
grep -q '^LOCAL_STUDIO_PORT=' "$ENV_FILE" || echo "LOCAL_STUDIO_PORT=$PORT" >> "$ENV_FILE"
grep -q '^LOCAL_STUDIO_DATA_DIR=' "$ENV_FILE" || echo "LOCAL_STUDIO_DATA_DIR=$DATA_DIR" >> "$ENV_FILE"
grep -q '^LOCAL_STUDIO_MODELS_DIR=' "$ENV_FILE" || echo "LOCAL_STUDIO_MODELS_DIR=$MODELS_DIR" >> "$ENV_FILE"
if [ -z "${LOCAL_STUDIO_HOST:-}" ]; then HOST="$(read_env_value LOCAL_STUDIO_HOST)"; fi
if [ -z "${LOCAL_STUDIO_PORT:-}" ]; then PORT="$(read_env_value LOCAL_STUDIO_PORT)"; fi
if [ -z "${LOCAL_STUDIO_DATA_DIR:-}" ]; then DATA_DIR="$(read_env_value LOCAL_STUDIO_DATA_DIR)"; fi
if [ -z "${LOCAL_STUDIO_MODELS_DIR:-}" ]; then MODELS_DIR="$(read_env_value LOCAL_STUDIO_MODELS_DIR)"; fi
mkdir -p "$DATA_DIR" "$MODELS_DIR"

# --- service -----------------------------------------------------------------
started=""
if [ "$OS_NAME" = "Darwin" ]; then
  LABEL="org.local.studio.controller"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG_FILE="$DATA_DIR/controller.log"
  xml_escape() {
    printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
  }
  mkdir -p "$HOME/Library/LaunchAgents"
  BUN_XML="$(xml_escape "$BUN")"
  MAIN_XML="$(xml_escape "$DIR/controller/src/main.ts")"
  DIR_XML="$(xml_escape "$DIR")"
  DATA_XML="$(xml_escape "$DATA_DIR")"
  MODELS_XML="$(xml_escape "$MODELS_DIR")"
  LOG_XML="$(xml_escape "$LOG_FILE")"
  API_KEY_XML="$(xml_escape "$API_KEY")"
  PATH_XML="$(xml_escape "$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BUN_XML</string><string>$MAIN_XML</string></array>
  <key>WorkingDirectory</key><string>$DIR_XML</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOCAL_STUDIO_HOST</key><string>$(xml_escape "$HOST")</string>
    <key>LOCAL_STUDIO_PORT</key><string>$PORT</string>
    <key>LOCAL_STUDIO_API_KEY</key><string>$API_KEY_XML</string>
    <key>LOCAL_STUDIO_DATA_DIR</key><string>$DATA_XML</string>
    <key>LOCAL_STUDIO_MODELS_DIR</key><string>$MODELS_XML</string>
    <key>PATH</key><string>$PATH_XML</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG_XML</string>
  <key>StandardErrorPath</key><string>$LOG_XML</string>
</dict>
</plist>
PLIST
  plutil -lint "$PLIST" >/dev/null
  SERVICE="gui/$(id -u)/$LABEL"
  launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "$SERVICE"
  launchctl kickstart -k "$SERVICE"
  started="launchd"
elif command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
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
StandardOutput=append:$DATA_DIR/controller.log
StandardError=append:$DATA_DIR/controller.log

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
  (cd "$DIR" && setsid nohup env "$(grep -v '^#' "$ENV_FILE" | xargs)" "$BUN" controller/src/main.ts >> "$DATA_DIR/controller.log" 2>&1 < /dev/null &)
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

log "controller did not become healthy in 60s — check $DATA_DIR/controller.log"
exit 1
