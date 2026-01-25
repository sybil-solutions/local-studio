# Changelog

All notable changes to vLLM Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-01-25

### Added
- **Branch Protection**: Configured strict branch protection rules for main branch
  - Requires 1 approval before merge
  - Requires all CI checks to pass
  - Blocks force pushes and deletions
- **Dependency Automation**: Added Dependabot for automated dependency updates
  - Weekly updates for npm (controller, cli, frontend)
  - Weekly updates for pip (python)
  - Weekly updates for GitHub Actions
- **Security Scanning**: Added comprehensive security workflow
  - TruffleHog secret scanning
  - CodeQL static analysis for JS/TS/Python
  - Dependency review with vulnerability checks
- **Automated PR Reviews**: Integrated CodeRabbit AI for code review
  - Custom instructions for this monorepo
  - Focus on type safety, performance, and security
- **CI/CD Metrics**: Added workflow to track CI performance
  - Posts duration metrics to PRs
  - Tracks deployment frequency
- **Deployment Automation**: Added deployment workflow for main branch
- **Issue Labels**: Created comprehensive label schema
  - Priority levels (Critical, High, Medium, Low)
  - Type labels (Bug, Feature, Enhancement, etc.)
  - Area labels (Controller, Frontend, CLI, Infrastructure)
  - Status labels (Ready, In Progress, Blocked, Needs Review)
- **Enhanced PR Template**: Updated with:
  - Performance & Security section
  - Enhanced testing checklist
  - Label requirements

### Changed
- Significantly improved agent readiness score (Level 3 → Level 4)
- All future changes to main must go through PR review process

## [0.3.1] - 2026-01-24

### Added
- Frontend: Added `frontend/AGENTS.md` with rebuild notes and standalone asset copy guidance

### Fixed
- Chat: Toolbelt controls remain interactive regardless of composer state
- Chat: Session navigation loads messages and titles when opening a session id
- Chat: Model list now uses `/v1/models` ids for selection
- Mobile: Composer input respects min-height without fixed cap

## [0.3.0] - 2026-01-10

### Added
- **Unified Sidebar Navigation**: All app navigation (Dashboard, Chat, Recipes, Logs, Usage, Configs) moved into the chat sidebar
- **Chat Pagination**: Chats now load 15 at a time with "Load more" button to prevent performance issues
- **Date Grouping**: Chat sessions organized by Today, Yesterday, Last 7 days, Older
- **Model Selector Dropdown**: Quick model switching directly in chat header with search
- **Sidebar Search**: Filter conversations by title or model name
- **Empty State Illustration**: Friendly SVG art when no conversations exist

### Changed
- **Sidebar Design**: Full-height sidebar with logo, nav, and chat list in one unified component
- **Color Scheme**: Replaced green accent with subtle purple (`hsl(270)`) for links and highlights
- **Composer Buttons**: Unified dim accent styling instead of multiple colored badges (blue/purple/emerald/amber)
- **Light Mode**: Improved readability with better contrast and softer backgrounds
- **Collapsed Sidebar**: Minimal icon rail with nav icons and first-letter chat indicators

### Fixed
- Chat page layout now properly accounts for full-height sidebar
- Navigation hidden on chat page (sidebar contains all nav)

## [0.2.1] - 2025-12-20

### Fixed
- Frontend: Added redirect from `/models` to `/recipes` to fix 404 error when accessing model management page
  - Updated `frontend/next.config.ts` with permanent redirect (HTTP 308)

## [0.2.0] - 2024-12-XX

Previous release - vLLM Studio v0.2.0
