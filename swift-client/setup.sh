#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install xcodegen if not present
if ! command -v xcodegen &> /dev/null; then
  echo "Installing XcodeGen..."
  brew install xcodegen
fi

# Generate Xcode project
echo "Generating Xcode project..."
xcodegen generate

# Open in Xcode
echo "Opening in Xcode..."
open vllm-studio.xcodeproj
