# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Pi extensions catalog: browse `pi-package`-tagged packages from npm directly in the right-sidebar **Plugins** panel and install with one click. Adds `/api/agent/extensions/catalog` proxying `registry.npmjs.org`. Installed extensions appear with version, scope, and an on/off pill, and a custom-source installer is tucked under a collapsible details block.
- Mention picker redesign: unified layout for `@`, `$`, `/`, and the extension picker — per-kind colored icon (sky/violet/amber/emerald), shared row component (icon | title + version | description | source), and a header bar with kind label, query, hint, and a "Manage" shortcut for extensions. Loaded-context pills are bordered, color-coded, and use proper close buttons.
- Slash commands surface installed Pi extensions: typing `/` now also lists enabled Pi extensions (with on/off chips) so commands like `/goal` are discoverable next to prompt templates. Catalog auto-refreshes when the picker opens.
- Side chat: `openSideSessionFromFocusedPane` exposed so a side session can be spawned in the same project from any pane (foundation for the right-sidebar side-chat tab).
- Multiple controllers: the dashboard renders every saved controller as a compact tab row (status dot, name, state, gpu count, model), and switching the active controller now reloads the agent's model picker against the new backend. A small chip on the model picker shows the currently active controller.
- Connection settings unified list: one row per controller with name (editable, double-click to rename in the dashboard / inline in settings), URL, API key, and a radio that activates that controller. Activation persists `/api/settings` so server-side `/api/agent/*` routes hit the right backend without restarting.

### Fixed

- Mention picker no longer lingers after the composer is submitted; it closes on Send and Queue.
- Switching active controller previously dropped other controllers from the list — now the full list is preserved across switches.
- Controller inputs no longer trigger per-keystroke storage events / `/api/settings` POSTs; rows commit on blur only.
- Agent model picker re-fetches models when the active backend URL or API key changes (was only loading on initial hydrate).
- Connection settings now use `useSyncExternalStore` instead of render-triggered sync to keep the dashboard tab row and settings list in lockstep.

### Refactors

- Pi runtime: replaced the `pi --mode rpc` subprocess pipeline with the in-process `@earendil-works/pi-coding-agent` SDK. Removed `pi-binary.ts`, `buildPiLaunchPlan`, `PiRpcSession`, and the `desktop:prepare-pi` build step. Extensions are now loaded as ESM via dynamic `import()` instead of `--extension <path>` CLI flags.

### Fixes

- Pi resume now binds the SDK's `SessionManager` to the requested session JSONL via `findSessionFile`, restoring conversation continuity across tab reloads.

### Documentation

- Documented the SDK-based Pi runtime entry points, extension/skill loading, and resume semantics in `frontend/AGENTS.md`.

## [v1.18.5] - 2026-04-26

### Changed

- Refactored the agent workspace into typed store, controller, persistence, lifecycle, hook, and panel boundaries with React effect-hook budget guards.
- performance-simplifications: enable SGLang metrics by default for controller launches and command previews.
- performance-simplifications: expose live metrics snapshots through the controller polling endpoint.
- performance-simplifications: render dashboard logs verbatim and support container-backed log sessions.

### Fixed

- Fixed SGLang decode, prefill, TTFT, and request counters staying blank when metrics were not enabled.
- Scoped Tailwind CSS source scanning to the frontend tree to prevent runaway dev workers.

## [v1.17.0] - 2026-04-14

### Added

- Computer sidebar **Browser** tab (embedded `http(s)` preview, URL allow-list) and richer **Files** previews (Markdown, HTML, JSON/code).
- `browser_open_url` streams sync the Browser tab URL; agent system prompt notes the behavior.

### Fixed

- GitHub **Release** workflow: semantic-release no longer requires a root `package.json` or pushes commits to protected `main` (tag + GitHub Release only).

## [v1.13.0] - 2026-03-02

### Added

- controller tests for SSE run termination and stricter agent system prompt contracts
- Daytona tool registry tests for command alias handling (`cmd`, `workdir`, `timeout_ms`)
- Daytona toolbox client tests for legacy route fallback and sandbox quota-recovery flow

### Changed

- OpenAI proxy model activation now supports policy control via `VLLM_STUDIO_OPENAI_MODEL_ACTIVATION_POLICY`:
  - `load_if_idle` (default): reuse currently running model and rewrite request model when needed
  - `switch_on_request`: switch active model to requested recipe before proxying
- lifecycle coordinator now aborts active chat runs when model eviction occurs
- SSE run streams now terminate immediately after `run_end` on both controller and frontend
- Daytona toolbox command execution now accepts alias keys (`cmd`, `workdir`, `timeout_ms`) and string payloads
- Daytona toolbox client now retries sandbox creation after cleaning stopped sandboxes on quota/limit errors
- Daytona toolbox client now supports modern and legacy toolbox endpoint patterns
- Dashboard launch state now clears reliably when launch stages enter a done state

### Fixed

- reduced LiteLLM retry layering by setting router and client retries to zero in `config/litellm.yaml`
- frontend launch API timeout reduced to avoid long-hanging launch calls

## [v1.12.0] - 2026-02-24

- release: repo-wide stabilization, docs reset, and deployment hardening
