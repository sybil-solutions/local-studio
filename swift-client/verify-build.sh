#!/bin/bash
# CRITICAL
# Build verification script for Swift client (iOS + macOS)
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v xcodegen &> /dev/null; then
  echo "❌ XcodeGen not installed. Run: brew install xcodegen"
  exit 1
fi

echo "🔧 Step 1/3: Regenerating Xcode project..."
xcodegen generate

run_build() {
  local label="$1"
  local command="$2"
  local log_file="$3"

  echo "🏗️  Building $label..."
  set +e
  eval "$command" | tee "$log_file" | grep -E "^(Build|==|/Users|error:|warning:)" || true
  local exit_code=${PIPESTATUS[0]}
  set -e

  local error_count
  local warning_count
  error_count=$(grep -c "error:" "$log_file" || echo "0")
  warning_count=$(grep -c "warning:" "$log_file" || echo "0")

  if [ "$exit_code" -ne 0 ]; then
    echo "❌ $label build failed"
    echo "   Errors: $error_count"
    echo "   Warnings: $warning_count"
    echo "   Full log: $log_file"
    exit "$exit_code"
  fi

  echo "✅ $label build passed (warnings: $warning_count)"
}

echo "📱 Step 2/3: Validating app targets..."
run_build \
  "iOS Simulator" \
  "xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio -destination 'platform=iOS Simulator,name=iPhone 15,OS=18.1' clean build" \
  "/tmp/swift-build-ios.log"

run_build \
  "macOS" \
  "xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio-mac -destination 'platform=macOS' clean build" \
  "/tmp/swift-build-mac.log"

echo ""
echo "✅ Step 3/3: All Swift builds succeeded"
echo "   iOS log: /tmp/swift-build-ios.log"
echo "   macOS log: /tmp/swift-build-mac.log"
