#!/bin/bash
# CRITICAL
# Build verification script for Swift client
set -e

cd "$(dirname "$0")"

echo "🔧 Step 1/3: Regenerating Xcode project..."
if ! command -v xcodegen &> /dev/null; then
  echo "❌ XcodeGen not installed. Run: brew install xcodegen"
  exit 1
fi
xcodegen generate

echo "🏗️  Step 2/3: Building project..."
xcodebuild -project vllm-studio.xcodeproj \
  -scheme vllm-studio \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  clean build \
  | tee /tmp/swift-build.log \
  | grep -E "^(Build|==|/Users|error:|warning:)" || true

BUILD_EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "📊 Step 3/3: Checking results..."
ERROR_COUNT=$(grep -c "error:" /tmp/swift-build.log || echo "0")
WARNING_COUNT=$(grep -c "warning:" /tmp/swift-build.log || echo "0")

if [ $BUILD_EXIT_CODE -eq 0 ]; then
  echo "✅ BUILD SUCCESSFUL"
  echo "   Warnings: $WARNING_COUNT"
  exit 0
else
  echo "❌ BUILD FAILED"
  echo "   Errors: $ERROR_COUNT"
  echo "   Warnings: $WARNING_COUNT"
  echo ""
  echo "Full build log: /tmp/swift-build.log"
  echo ""
  echo "Common fixes:"
  echo "  - Missing imports: Add 'import UIKit' or 'import Foundation'"
  echo "  - Scope errors: Move related functions to same file"
  echo "  - Type errors: Use full qualification (e.g., ColorScheme.dark)"
  exit 1
fi
