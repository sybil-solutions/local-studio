#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${LOCAL_STUDIO_INSTALL_ROOT:-/Applications}"
ROLLBACK_ROOT="${LOCAL_STUDIO_ROLLBACK_ROOT:-$HOME/Library/Application Support/Local Studio Installer/Rollbacks}"
LSREGISTER="${LOCAL_STUDIO_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"
PLIST_BUDDY="${LOCAL_STUDIO_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
SKIP_RUNTIME_CLEANUP="${LOCAL_STUDIO_SKIP_RUNTIME_CLEANUP:-0}"
RELEASE_DMG_URL="${LOCAL_STUDIO_RELEASE_DMG_URL:-https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-arm64.dmg}"
RELEASE_TEMP=""
RELEASE_MOUNT=""

channel="stable"
keep_backup=1
mode="install"

for arg in "$@"; do
  case "$arg" in
    stable|dev) channel="$arg" ;;
    --no-backup) keep_backup=0 ;;
    --migrate-rollbacks) mode="migrate" ;;
    *) echo "error: unknown argument $arg" >&2; exit 2 ;;
  esac
done

if [[ "$INSTALL_ROOT" != /* || "$INSTALL_ROOT" == "/" ]]; then
  echo "error: install root must be an absolute directory below /" >&2
  exit 2
fi

if [[ "$ROLLBACK_ROOT" != /* || "$ROLLBACK_ROOT" == "/" || "$ROLLBACK_ROOT" == "$INSTALL_ROOT" || "$ROLLBACK_ROOT/" == "$INSTALL_ROOT/"* ]]; then
  echo "error: rollback root must be an absolute directory outside the install root" >&2
  exit 2
fi

if [[ "$channel" == "dev" ]]; then
  APP_NAME="Local Studio Dev"
  APP_ID="org.local.studio.desktop.dev"
  BUILT="${LOCAL_STUDIO_BUILT_APP:-$REPO_ROOT/frontend/dist-desktop-dev/mac-arm64/$APP_NAME.app}"
else
  APP_NAME="Local Studio"
  APP_ID="org.local.studio.desktop"
  BUILT="${LOCAL_STUDIO_BUILT_APP:-}"
fi

TARGET="$INSTALL_ROOT/$APP_NAME.app"
ROLLBACK="$ROLLBACK_ROOT/$APP_NAME.zip"
STAGED="$INSTALL_ROOT/.local-studio-installing-$APP_ID-$$"
REPLACED="$INSTALL_ROOT/.local-studio-replaced-$APP_ID-$$"

rollback_for_id() {
  case "$1" in
    org.local.studio.desktop) printf '%s/Local Studio.zip\n' "$ROLLBACK_ROOT" ;;
    org.local.studio.desktop.dev) printf '%s/Local Studio Dev.zip\n' "$ROLLBACK_ROOT" ;;
    *) return 1 ;;
  esac
}

canonical_for_id() {
  case "$1" in
    org.local.studio.desktop) printf '%s/Local Studio.app\n' "$INSTALL_ROOT" ;;
    org.local.studio.desktop.dev) printf '%s/Local Studio Dev.app\n' "$INSTALL_ROOT" ;;
    *) return 1 ;;
  esac
}

bundle_id() {
  "$PLIST_BUDDY" -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null
}

archive_bundle() {
  local source="$1"
  local destination="$2"
  local temporary="$destination.tmp.$$"

  mkdir -p "$(dirname "$destination")"
  rm -f "$temporary"
  if ! ditto -c -k --sequesterRsrc --keepParent "$source/Contents" "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  if ! archive_is_valid "$temporary"; then
    rm -f "$temporary"
    echo "error: rollback archive is incomplete" >&2
    return 1
  fi
  mv -f "$temporary" "$destination"
}

archive_is_valid() {
  local archive="$1"
  [[ -f "$archive" ]] || return 1
  unzip -tqq "$archive" || return 1
  unzip -Z1 "$archive" | awk '$0 == "Contents/Info.plist" || ($0 ~ /^Local Studio( Dev)?\.app/ && $0 ~ /\/Contents\/Info\.plist$/) { found = 1 } END { exit found ? 0 : 1 }'
}

legacy_bundles() {
  [[ -d "$INSTALL_ROOT" ]] || return 0
  find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -type d -iname '*Local Studio*' -print0
}

unregister_bundle_tree() {
  local root="$1"
  local nested
  [[ -x "$LSREGISTER" ]] || return 0
  while IFS= read -r -d '' nested; do
    "$LSREGISTER" -u "$nested" >/dev/null 2>&1 || true
  done < <(find "$root" -type d -name '*.app' -print0 2>/dev/null)
  "$LSREGISTER" -u "$root" >/dev/null 2>&1 || true
}

prune_stale_launch_services() {
  local registered
  [[ -x "$LSREGISTER" ]] || return 0
  while IFS= read -r registered; do
    case "$registered" in
      "$INSTALL_ROOT/Local Studio.app"|"$INSTALL_ROOT/Local Studio.app/"*|"$INSTALL_ROOT/Local Studio Dev.app"|"$INSTALL_ROOT/Local Studio Dev.app/"*) continue ;;
      "$INSTALL_ROOT/Local Studio"*) ;;
      *) continue ;;
    esac
    [[ ! -e "$registered" ]] || continue
    "$LSREGISTER" -u "$registered" >/dev/null 2>&1 || true
  done < <("$LSREGISTER" -dump 2>/dev/null | sed -nE 's/^[[:space:]]*path:[[:space:]]*(.*) \(0x[[:xdigit:]]+\)$/\1/p')
  "$LSREGISTER" -gc >/dev/null 2>&1 || true
}

migrate_legacy_bundles() {
  local skip_id="${1:-}"
  local candidate id canonical archive

  while IFS= read -r -d '' candidate; do
    id="$(bundle_id "$candidate" || true)"
    [[ "$id" == "org.local.studio.desktop" || "$id" == "org.local.studio.desktop.dev" ]] || continue
    canonical="$(canonical_for_id "$id")"
    [[ "$candidate" != "$canonical" ]] || continue
    archive="$(rollback_for_id "$id")"

    if [[ "$id" != "$skip_id" ]] && ! archive_is_valid "$archive"; then
      echo "==> archiving legacy rollback $candidate -> $archive"
      archive_bundle "$candidate" "$archive"
    fi

    echo "==> removing discoverable legacy bundle $candidate"
    unregister_bundle_tree "$candidate"
    rm -rf "$candidate"
  done < <(legacy_bundles)

  prune_stale_launch_services
}

cleanup_temporary_paths() {
  rm -rf "$STAGED"
  if [[ "${SWAP_VERIFIED:-0}" == "0" && -d "$REPLACED" ]]; then
    rm -rf "$TARGET"
    mv "$REPLACED" "$TARGET"
  elif [[ "${SWAP_VERIFIED:-0}" == "0" && "${TARGET_INSTALLED:-0}" == "1" ]]; then
    rm -rf "$TARGET"
  fi
  cleanup_release_source
}

cleanup_release_source() {
  if [[ -n "$RELEASE_MOUNT" ]]; then
    hdiutil detach "$RELEASE_MOUNT" -quiet || hdiutil detach "$RELEASE_MOUNT" -force -quiet || true
  fi
  [[ -z "$RELEASE_TEMP" ]] || rm -rf "$RELEASE_TEMP"
  RELEASE_MOUNT=""
  RELEASE_TEMP=""
}

if [[ "$mode" == "migrate" ]]; then
  migrate_legacy_bundles
  echo "==> done. rollback archives: $ROLLBACK_ROOT"
  exit 0
fi

HAD_TARGET=0
SWAP_VERIFIED=0
TARGET_INSTALLED=0
trap cleanup_temporary_paths EXIT

if [[ "$channel" == "stable" && -z "$BUILT" ]]; then
  RELEASE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/local-studio-release.XXXXXX")"
  RELEASE_MOUNT="$RELEASE_TEMP/mount"
  release_dmg="$RELEASE_TEMP/Local-Studio-arm64.dmg"
  mkdir -p "$RELEASE_MOUNT"
  echo "==> downloading latest stable release"
  curl --fail --location --silent --show-error "$RELEASE_DMG_URL" --output "$release_dmg"
  xcrun stapler validate "$release_dmg"
  spctl --assess --type open --context context:primary-signature "$release_dmg"
  hdiutil attach -readonly -nobrowse -mountpoint "$RELEASE_MOUNT" "$release_dmg" >/dev/null
  BUILT="$RELEASE_MOUNT/$APP_NAME.app"
fi

if [[ ! -d "$BUILT" ]]; then
  echo "error: no built bundle at $BUILT" >&2
  hint="desktop:dist"
  [[ "$channel" == "dev" ]] && hint="desktop:dist:dev"
  echo "       run: npm --prefix frontend run $hint" >&2
  exit 1
fi

if [[ "$(bundle_id "$BUILT" || true)" != "$APP_ID" ]]; then
  echo "error: built bundle identifier does not match $APP_ID" >&2
  exit 1
fi

if [[ ! -x "$BUILT/Contents/MacOS/$APP_NAME" ]]; then
  echo "error: built bundle has no executable" >&2
  exit 1
fi

if [[ "$BUILT" != /* ]]; then
  echo "error: built bundle path must be absolute" >&2
  exit 2
fi

codesign --verify --deep --strict "$BUILT"
if [[ "$channel" == "stable" ]]; then
  spctl --assess --type execute "$BUILT"
fi
mkdir -p "$INSTALL_ROOT" "$ROLLBACK_ROOT"
rm -rf "$STAGED" "$REPLACED"

ditto "$BUILT" "$STAGED"
codesign --verify --deep --strict "$STAGED"
cleanup_release_source

if [[ -d "$TARGET" && "$keep_backup" == "1" ]]; then
  echo "==> archiving current install -> $ROLLBACK"
  archive_bundle "$TARGET" "$ROLLBACK"
elif [[ "$keep_backup" == "0" ]]; then
  rm -f "$ROLLBACK"
fi

if [[ "$SKIP_RUNTIME_CLEANUP" != "1" ]]; then
  echo "==> quitting $APP_NAME"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null || break
    sleep 0.5
  done
  pkill -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || true

  while IFS= read -r volume; do
    [[ -n "$volume" ]] || continue
    echo "==> ejecting stale disk image $volume"
    hdiutil detach "$volume" -quiet || hdiutil detach "$volume" -force -quiet || true
  done < <(find /Volumes -mindepth 1 -maxdepth 1 -type d -name "$APP_NAME*" -print 2>/dev/null || true)

  for port in 3000 8081; do
    pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    [[ -n "$pid" ]] || continue
    echo "==> stopping stale server on :$port (pid $pid)"
    kill "$pid" 2>/dev/null || true
  done
fi

if [[ -d "$TARGET" ]]; then
  HAD_TARGET=1
  mv "$TARGET" "$REPLACED"
fi

mv "$STAGED" "$TARGET"
TARGET_INSTALLED=1
codesign --verify --deep --strict "$TARGET"
if [[ "$channel" == "stable" ]]; then
  spctl --assess --type execute "$TARGET"
fi
SWAP_VERIFIED=1
rm -rf "$REPLACED"

if [[ "$keep_backup" == "1" ]]; then
  migrate_legacy_bundles
else
  migrate_legacy_bundles "$APP_ID"
fi

if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$TARGET" >/dev/null 2>&1 || true
  "$LSREGISTER" -gc >/dev/null 2>&1 || true
fi

trap - EXIT
echo "==> installed $TARGET"
if [[ -f "$ROLLBACK" ]]; then
  echo "==> rollback archive: $ROLLBACK"
fi
echo "    launch with: open \"$TARGET\""
