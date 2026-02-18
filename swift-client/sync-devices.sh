#!/bin/bash
# CRITICAL
# Local delivery pipeline: build + install macOS app and install iOS app on connected iPhone.
set -euo pipefail

cd "$(dirname "$0")"

DERIVED_ROOT="${DERIVED_ROOT:-$PWD/.build/device-sync}"
MAC_INSTALL_DIR="${MAC_INSTALL_DIR:-$HOME/Applications}"
IOS_DEVICE_ID="${IOS_DEVICE_ID:-${1:-}}"
IOS_BUNDLE_ID="com.sero.vllmstudio"

if ! command -v xcodegen &> /dev/null; then
  echo "❌ XcodeGen not installed. Run: brew install xcodegen"
  exit 1
fi

echo "🔧 Regenerating Xcode project..."
xcodegen generate

echo "🖥️  Building macOS app..."
rm -rf "$DERIVED_ROOT/mac"
xcodebuild \
  -project vllm-studio.xcodeproj \
  -scheme vllm-studio-mac \
  -destination 'platform=macOS' \
  -derivedDataPath "$DERIVED_ROOT/mac" \
  clean build

MAC_APP_PATH="$DERIVED_ROOT/mac/Build/Products/Debug/vllm-studio-mac.app"
if [ ! -d "$MAC_APP_PATH" ]; then
  echo "❌ macOS app not found at: $MAC_APP_PATH"
  exit 1
fi

mkdir -p "$MAC_INSTALL_DIR"
rm -rf "$MAC_INSTALL_DIR/vllm-studio-mac.app"
cp -R "$MAC_APP_PATH" "$MAC_INSTALL_DIR/vllm-studio-mac.app"
echo "✅ Installed macOS app: $MAC_INSTALL_DIR/vllm-studio-mac.app"

if [ -z "$IOS_DEVICE_ID" ]; then
  IOS_DEVICE_ID=$(xcrun xctrace list devices | perl -ne 'if (/iPhone/ && !/Simulator/ && /\(([A-F0-9-]+)\)\s*$/) { print "$1\n"; exit }')
fi

if [ -z "$IOS_DEVICE_ID" ]; then
  echo "⚠️  No physical iPhone detected. Skipping iOS install."
  echo "    Re-run with a device ID: ./sync-devices.sh <IOS_DEVICE_ID>"
  exit 0
fi

echo "📱 Building iOS app for device: $IOS_DEVICE_ID"
rm -rf "$DERIVED_ROOT/ios"
xcodebuild \
  -project vllm-studio.xcodeproj \
  -scheme vllm-studio \
  -destination "id=$IOS_DEVICE_ID" \
  -configuration Debug \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  -derivedDataPath "$DERIVED_ROOT/ios" \
  clean build

IOS_APP_PATH="$DERIVED_ROOT/ios/Build/Products/Debug-iphoneos/vllm-studio.app"
if [ ! -d "$IOS_APP_PATH" ]; then
  echo "❌ iOS app not found at: $IOS_APP_PATH"
  exit 1
fi

echo "📲 Installing app on iPhone..."
if ! xcrun devicectl device install app --device "$IOS_DEVICE_ID" "$IOS_APP_PATH"; then
  echo "❌ iOS install failed."
  echo "   Make sure iPhone is unlocked and Developer Mode is enabled, then retry."
  echo "   Built app is available at: $IOS_APP_PATH"
  exit 1
fi

echo "🚀 Launching app on iPhone..."
xcrun devicectl device process launch --device "$IOS_DEVICE_ID" "$IOS_BUNDLE_ID" || true

echo "✅ Device sync complete"
