# swift-client/agents.md

## Daily workflow
- Run `./setup.sh` after any Swift file change (edit/add/move/rename); it regenerates the Xcode project.
- Verify builds from the terminal:
  ```bash
  cd swift-client
  ./verify-build.sh
  # or
  xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio \
    -destination 'platform=iOS Simulator,name=iPhone 15' clean build
  echo $?  # must be 0 (success)
  ```

## Code organization
- Keep files in `sources/` and assets in `resources/`.
- Use kebab-case for filenames and directories (e.g., `chat-detail-view.swift`).
- Files >60 LOC must start with `// CRITICAL` (or `<!-- CRITICAL -->` in Markdown).
- Max 20 files per directory; create subdirectories when needed.
- Avoid splitting extensions across files when they share private helpers.

## Imports & scope
- Explicitly import required frameworks (SwiftUI, UIKit, Foundation, AVFoundation, PhotosUI).
- Avoid file-scoped `private` members needed by other extensions.
- Prefer one initializer per type (add optional params instead of new inits).

## SwiftUI patterns
- Keep views small and composable; extract subviews when they grow.
- Use view models for side effects and API calls.
- Use `@StateObject` for owned view models, `@ObservedObject` for injected ones.
- Qualify enum cases where required (e.g., `ColorScheme.dark`, not `.dark`).

## Testing & linting (recommended)
- Add/extend unit tests for view models and API clients.
- Let `verify-build.sh` catch errors/warnings before committing.

## AI-assisted development
- Ask AI for small, scoped changes and provide exact file context.
- Let the terminal build (`verify-build.sh`) validate AI output.
- Prefer AI for scaffolding, refactors, and test generation; review before commit.
