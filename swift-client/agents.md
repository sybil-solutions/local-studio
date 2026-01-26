# swift-client/agents.md

## Daily workflow
- Run `./setup.sh` after adding/moving/renaming Swift files (regenerates Xcode project).
- Verify builds from the terminal:
  ```bash
  ./verify-build.sh
  # or
  xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio \
    -destination 'platform=iOS Simulator,name=iPhone 15' clean build
  ```

## Code organization
- Keep files in `sources/` and assets in `resources/`.
- Use kebab-case for filenames (e.g., `chat-detail-view.swift`).
- Files >60 LOC must start with `// CRITICAL`.
- Avoid splitting extensions across files when they share private helpers.

## Imports & scope
- Explicitly import required frameworks (UIKit, SwiftUI, Foundation, etc.).
- Avoid file-scoped `private` members needed by other extensions.
- Prefer one initializer per type (add optional params instead of new inits).

## SwiftUI patterns
- Keep views small and composable; extract subviews when they grow.
- Use view models for side effects and API calls.
- Use `@StateObject` for owned view models, `@ObservedObject` for injected ones.

## Testing & linting (recommended)
- Add/extend unit tests for view models and API clients.
- Consider SwiftLint/SwiftFormat for consistent style.

## AI-assisted development
- Ask AI for small, scoped changes and provide exact file context.
- Let the terminal build (`verify-build.sh`) validate AI output.
- Prefer AI for scaffolding, refactors, and test generation; review before commit.
