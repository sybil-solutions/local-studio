#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

OPEN_PROJECT=true
if [ "${1:-}" = "--no-open" ]; then
  OPEN_PROJECT=false
fi

# Install xcodegen if not present
if ! command -v xcodegen &> /dev/null; then
  echo "Installing XcodeGen..."
  brew install xcodegen
fi

# Generate Xcode project
echo "Generating Xcode project..."
xcodegen generate

echo "✅ Project generated"
echo "   - iPhone scheme: vllm-studio"
echo "   - Mac scheme:    vllm-studio-mac"

if [ "$OPEN_PROJECT" = true ]; then
  echo "Opening in Xcode..."
  open vllm-studio.xcodeproj
fi
