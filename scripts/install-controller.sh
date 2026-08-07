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
umask 077

version_at_least() {
  local current="$1" minimum="$2"
  local current_major current_minor current_patch minimum_major minimum_minor minimum_patch
  [[ "$current" =~ ^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] || return 1
  [[ "$minimum" =~ ^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$ ]] || return 1
  IFS=. read -r current_major current_minor current_patch <<< "$current"
  IFS=. read -r minimum_major minimum_minor minimum_patch <<< "$minimum"
  current_major=$((10#$current_major)); current_minor=$((10#$current_minor)); current_patch=$((10#$current_patch))
  minimum_major=$((10#$minimum_major)); minimum_minor=$((10#$minimum_minor)); minimum_patch=$((10#$minimum_patch))
  if [ "$current_major" -ne "$minimum_major" ]; then [ "$current_major" -gt "$minimum_major" ]; return; fi
  if [ "$current_minor" -ne "$minimum_minor" ]; then [ "$current_minor" -gt "$minimum_minor" ]; return; fi
  [ "$current_patch" -ge "$minimum_patch" ]
}

log() { printf '[local-studio] %s\n' "$*"; }
install_bun() {
  log "installing supported bun…"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
}
ensure_supported_bun() {
  local minimum="$1" current=""
  [ -x "$BUN" ] && current="$("$BUN" --version 2>/dev/null || true)"
  if version_at_least "$current" "$minimum"; then
    log "bun: $current"
    return 0
  fi
  install_bun || { log "failed to install Bun $minimum or newer"; return 1; }
  BUN="$HOME/.bun/bin/bun"
  [ -x "$BUN" ] || { log "Bun upgrade did not install an executable"; return 1; }
  current="$("$BUN" --version 2>/dev/null || true)"
  version_at_least "$current" "$minimum" || {
    log "Bun ${current:-unknown} is older than required $minimum after upgrade"
    return 1
  }
  log "bun: $current"
}

if [ "${1:-}" = "--check-bun-version" ]; then
  [ "$#" -eq 3 ] || exit 2
  version_at_least "$2" "$3"
  exit
fi
if [ "${1:-}" = "--ensure-bun-version" ]; then
  [ "$#" -eq 2 ] || exit 2
  BUN="${LOCAL_STUDIO_BUN_BINARY:-$HOME/.bun/bin/bun}"
  ensure_supported_bun "$2"
  exit
fi

OS_NAME="$(uname -s)"
HOST_WAS_SET="${LOCAL_STUDIO_HOST+x}"
PORT_WAS_SET="${LOCAL_STUDIO_PORT+x}"
DATA_DIR_WAS_SET="${LOCAL_STUDIO_DATA_DIR+x}"
MODELS_DIR_WAS_SET="${LOCAL_STUDIO_MODELS_DIR+x}"
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
ENV_FILE="$DIR/.env"

read_env_value() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-
}
harden_private_file() {
  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -f "$1" ]; }; then
    log "refusing unsafe private file at $1"
    exit 1
  fi
  [ ! -f "$1" ] || chmod 600 "$1"
}
harden_private_directory() {
  if [ -L "$1" ] || { [ -e "$1" ] && [ ! -d "$1" ]; }; then log "refusing unsafe private directory at $1"; exit 1; fi
  [ ! -d "$1" ] || chmod 700 "$1"
}

harden_private_file "$ENV_FILE"
if [ -f "$ENV_FILE" ]; then
  if [ -z "$HOST_WAS_SET" ] && grep -q '^LOCAL_STUDIO_HOST=' "$ENV_FILE"; then HOST="$(read_env_value LOCAL_STUDIO_HOST)"; fi
  if [ -z "$PORT_WAS_SET" ] && grep -q '^LOCAL_STUDIO_PORT=' "$ENV_FILE"; then PORT="$(read_env_value LOCAL_STUDIO_PORT)"; fi
  if [ -z "$DATA_DIR_WAS_SET" ] && grep -q '^LOCAL_STUDIO_DATA_DIR=' "$ENV_FILE"; then DATA_DIR="$(read_env_value LOCAL_STUDIO_DATA_DIR)"; fi
  if [ -z "$MODELS_DIR_WAS_SET" ] && grep -q '^LOCAL_STUDIO_MODELS_DIR=' "$ENV_FILE"; then MODELS_DIR="$(read_env_value LOCAL_STUDIO_MODELS_DIR)"; fi
fi
harden_private_directory "$DATA_DIR"; harden_private_directory "$MODELS_DIR"
harden_private_file "$DATA_DIR/controller.log"
harden_private_file "$HOME/Library/LaunchAgents/org.local.studio.controller.plist"
harden_private_file "$HOME/.config/systemd/user/local-studio-controller-$PORT.service"

# --- prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || { log "git is required — install it and rerun"; exit 1; }
command -v curl >/dev/null 2>&1 || { log "curl is required — install it and rerun"; exit 1; }

if [ ! -x "$BUN" ] && ! command -v bun >/dev/null 2>&1; then
  install_bun
fi
[ -x "$BUN" ] || BUN="$(command -v bun)"

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

MINIMUM_BUN_VERSION="$(sed -nE 's/^[[:space:]]*"bun"[[:space:]]*:[[:space:]]*">=([^" ]+)".*$/\1/p' "$DIR/controller/package.json" | head -1)"
[ -n "$MINIMUM_BUN_VERSION" ] || { log "controller Bun requirement is missing"; exit 1; }
ensure_supported_bun "$MINIMUM_BUN_VERSION"

log "installing controller dependencies…"
(cd "$DIR/controller" && "$BUN" install >/dev/null 2>&1) || (cd "$DIR/controller" && "$BUN" install)

# --- config ------------------------------------------------------------------
write_env_value() {
  key="$1"
  value="$2"
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    awk -v key="$key" -v value="$value" 'index($0, key "=") == 1 { if (!written) print key "=" value; written=1; next } { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
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
  printf 'LOCAL_STUDIO_API_KEY=%s\n' "$API_KEY" >> "$ENV_FILE"
  log "wrote $ENV_FILE"
fi
if [ -z "$HOST_WAS_SET" ] && grep -q '^LOCAL_STUDIO_HOST=' "$ENV_FILE"; then HOST="$(read_env_value LOCAL_STUDIO_HOST)"; fi
if [ -z "$PORT_WAS_SET" ] && grep -q '^LOCAL_STUDIO_PORT=' "$ENV_FILE"; then PORT="$(read_env_value LOCAL_STUDIO_PORT)"; fi
if [ -z "$DATA_DIR_WAS_SET" ]; then
  if grep -q '^LOCAL_STUDIO_DATA_DIR=' "$ENV_FILE"; then
    DATA_DIR="$(read_env_value LOCAL_STUDIO_DATA_DIR)"
  elif [ -d "$DIR/data" ]; then
    DATA_DIR="$DIR/data"
  fi
fi
if [ -z "$MODELS_DIR_WAS_SET" ]; then
  if grep -q '^LOCAL_STUDIO_MODELS_DIR=' "$ENV_FILE"; then
    MODELS_DIR="$(read_env_value LOCAL_STUDIO_MODELS_DIR)"
  else
    MODELS_DIR="$DATA_DIR/models"
  fi
fi
write_env_value LOCAL_STUDIO_HOST "$HOST"
write_env_value LOCAL_STUDIO_PORT "$PORT"
write_env_value LOCAL_STUDIO_DATA_DIR "$DATA_DIR"
write_env_value LOCAL_STUDIO_MODELS_DIR "$MODELS_DIR"
mkdir -p "$DATA_DIR" "$MODELS_DIR"
harden_private_file "$ENV_FILE"
chmod 600 "$ENV_FILE"
harden_private_directory "$DATA_DIR"; harden_private_directory "$MODELS_DIR"
harden_private_file "$DATA_DIR/controller.log"
touch "$DATA_DIR/controller.log"
chmod 600 "$DATA_DIR/controller.log"

# --- service -----------------------------------------------------------------
started=""
if [ "$OS_NAME" = "Darwin" ]; then
  LABEL="org.local.studio.controller"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  xml_escape() {
    printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
  }
  mkdir -p "$HOME/Library/LaunchAgents"
  BUN_XML="$(xml_escape "$BUN")"
  MAIN_XML="$(xml_escape "$DIR/controller/src/main.ts")"
  DIR_XML="$(xml_escape "$DIR")"
  DATA_XML="$(xml_escape "$DATA_DIR")"
  MODELS_XML="$(xml_escape "$MODELS_DIR")"
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
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
PLIST
  chmod 600 "$PLIST"
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
UMask=0077
KillMode=mixed
TimeoutStopSec=15
StandardOutput=null
StandardError=null

[Install]
WantedBy=default.target
UNIT
  chmod 600 "$UNIT_DIR/$UNIT_NAME"
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
  (cd "$DIR" && setsid nohup env "$(grep -v '^#' "$ENV_FILE" | xargs)" "$BUN" controller/src/main.ts >/dev/null 2>&1 < /dev/null &)
  started="nohup"
fi

# --- health ------------------------------------------------------------------
log "waiting for controller on :$PORT…"
HEALTH_HOST="$HOST"
case "$HEALTH_HOST" in
  ""|"0.0.0.0"|"::") HEALTH_HOST="127.0.0.1" ;;
esac
HEALTH_URL_HOST="$HEALTH_HOST"
case "$HEALTH_URL_HOST" in
  *:*) HEALTH_URL_HOST="[$HEALTH_URL_HOST]" ;;
esac
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://$HEALTH_URL_HOST:$PORT/health" >/dev/null 2>&1; then
    HOST_ADDR="$HOST"
    case "$HOST_ADDR" in
      ""|"0.0.0.0"|"::")
        HOST_ADDR=""
        if command -v tailscale >/dev/null 2>&1; then
          HOST_ADDR="$(tailscale ip -4 2>/dev/null | head -1 || true)"
        fi
        if [ -z "$HOST_ADDR" ]; then
          HOST_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
        fi
        ;;
    esac
    [ -n "$HOST_ADDR" ] || HOST_ADDR="$(hostname)"
    HOST_URL_ADDR="$HOST_ADDR"
    case "$HOST_URL_ADDR" in
      *:*) HOST_URL_ADDR="[$HOST_URL_ADDR]" ;;
    esac
    log "controller healthy ($started)"
    printf 'LOCAL_STUDIO_CONTROLLER {"url":"http://%s:%s","api_key":"%s"}\n' "$HOST_URL_ADDR" "$PORT" "$API_KEY"
    exit 0
  fi
  sleep 2
done

log "controller did not become healthy in 60s — check $DATA_DIR/controller.log"
exit 1
