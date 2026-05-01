# PR Review Wiki: `feat/plop-t3code-with-pi`

A book-length, code-grounded review of the `feat/plop-t3code-with-pi` PR (485 files, +32k / −44k).

Start here: **[Overview](overview/index.md)** • **[Architecture](overview/architecture.md)** • **[Getting started](overview/getting-started.md)** • **[Glossary](overview/glossary.md)**.

## Table of contents

### Front matter

- [Overview / index](overview/index.md)
- [Architecture](overview/architecture.md)
- [Getting started with this review](overview/getting-started.md)
- [Glossary](overview/glossary.md)

### Chapter 1 — Frontend

- [Index](chapter-01-frontend/index.md)
- [Agent surface architecture](chapter-01-frontend/agent-surface-architecture.md)
- [ChatPane deep dive](chapter-01-frontend/chat-pane-deep-dive.md)
- [AgentWorkspace deep dive](chapter-01-frontend/agent-workspace-deep-dive.md)
- [Pi runtime](chapter-01-frontend/pi-runtime.md)
- [Stores and state](chapter-01-frontend/stores-and-state.md)
- [API routes](chapter-01-frontend/api-routes.md)
- [Electron desktop](chapter-01-frontend/electron-desktop.md)
- [Deletions inventory](chapter-01-frontend/deletions-inventory.md)
- [Modifications inventory](chapter-01-frontend/modifications-inventory.md)

### Chapter 2 — Controller

- [Index](chapter-02-controller/index.md)
- [Engines module](chapter-02-controller/engines-module.md)
- [System module](chapter-02-controller/system-module.md)
- [Models module](chapter-02-controller/models-module.md)
- [Proxy module](chapter-02-controller/proxy-module.md)
- [Studio / audio / jobs modules](chapter-02-controller/studio-audio-jobs-modules.md)
- [Shared types and AppContext](chapter-02-controller/shared-types-and-app-context.md)
- [Deletions inventory](chapter-02-controller/deletions-inventory.md)
- [Modifications inventory](chapter-02-controller/modifications-inventory.md)

### Chapter 3 — CLI

- [Index](chapter-03-cli/index.md)
- [What changed](chapter-03-cli/what-changed.md)
- [Architecture overview](chapter-03-cli/architecture-overview.md)
- [Gaps](chapter-03-cli/gaps.md)

### Chapter 4 — Anything else

- [Index](chapter-04-anything-else/index.md)
- [Shared package dissolution](chapter-04-anything-else/shared-package-dissolution.md)
- [Root docs and plans](chapter-04-anything-else/root-docs-and-plans.md)
- [Build and package](chapter-04-anything-else/build-and-package.md)
- [Factory config removal](chapter-04-anything-else/factory-config-removal.md)
- [Scripts and tooling](chapter-04-anything-else/scripts-and-tooling.md)
- [Skills / website / config](chapter-04-anything-else/skills-website-config.md)

### Chapter 5 — Patterns we're using

- [Index](chapter-05-patterns/index.md)
- [State machines and effects](chapter-05-patterns/state-machines-and-effects.md)
- [Service-as-contract](chapter-05-patterns/service-and-coordinator.md)
- [Subprocess RPC](chapter-05-patterns/subprocess-rpc.md)
- [SSE event bus](chapter-05-patterns/sse-event-bus.md)
- [Browser bridge](chapter-05-patterns/browser-bridge.md)
- [Module layout](chapter-05-patterns/module-layout.md)
- [Microcommits](chapter-05-patterns/microcommits.md)
- [Per-session runtime keys](chapter-05-patterns/per-session-runtime-keys.md)
- [Markdown rendering](chapter-05-patterns/markdown-rendering.md)
- [Dual-store projects](chapter-05-patterns/dual-store-projects.md)
- [State-machine UI hook](chapter-05-patterns/state-machine-ui-hook.md)
- [Test colocation](chapter-05-patterns/test-colocation.md)
- [Extension injection](chapter-05-patterns/extension-injection.md)

### Chapter 6 — Areas of complexity

- [Index](chapter-06-complexity/index.md)
- [Giant frontend files](chapter-06-complexity/giant-frontend-files.md)
- [Engine lifecycle orchestration](chapter-06-complexity/engine-lifecycle-orchestration.md)
- [Pi subprocess management](chapter-06-complexity/pi-subprocess-management.md)
- [Proxy streaming](chapter-06-complexity/proxy-streaming.md)
- [Browser bridge coupling](chapter-06-complexity/browser-bridge-coupling.md)
- [Dual projects stores](chapter-06-complexity/dual-projects-stores.md)
- [Usage / metrics fragmentation](chapter-06-complexity/usage-metrics-fragmentation.md)
- [Dead-shape leftovers](chapter-06-complexity/dead-shape-leftovers.md)
- [Jobs module survival](chapter-06-complexity/jobs-module-survival.md)
- [Next API process lifetime](chapter-06-complexity/next-api-process-lifetime.md)
- [Path resolution fallbacks](chapter-06-complexity/path-resolution-fallbacks.md)
- [Security posture gaps](chapter-06-complexity/security-posture-gaps.md)
- [Doc fragmentation](chapter-06-complexity/doc-fragmentation.md)
- [Committed binary](chapter-06-complexity/committed-binary.md)

### Chapter 7 — Files we need to improve

- [Index](chapter-07-files-to-improve/index.md)
- [Giant UI files](chapter-07-files-to-improve/giant-ui-files.md)
- [Giant controller files](chapter-07-files-to-improve/giant-controller-files.md)
- [Pi-runtime split](chapter-07-files-to-improve/pi-runtime-split.md)
- [Type and route orphans](chapter-07-files-to-improve/type-and-route-orphans.md)
- [Documentation drift](chapter-07-files-to-improve/documentation-drift.md)
- [Repo hygiene](chapter-07-files-to-improve/repo-hygiene.md)
- [Test gaps](chapter-07-files-to-improve/test-gaps.md)

### Chapter 8 — Things we can merge

- [Index](chapter-08-merge-opportunities/index.md)
- [Shared types package](chapter-08-merge-opportunities/shared-types-package.md)
- [Projects store merge](chapter-08-merge-opportunities/projects-store-merge.md)
- [Engine state merge](chapter-08-merge-opportunities/engine-state-merge.md)
- [Metrics and usage collapse](chapter-08-merge-opportunities/metrics-and-usage-collapse.md)
- [UI hooks cohesion](chapter-08-merge-opportunities/ui-hooks-cohesion.md)
- [Controller stores collocation](chapter-08-merge-opportunities/controller-stores-collocation.md)
- [Delete audio module](chapter-08-merge-opportunities/delete-audio-module.md)
- [Collapse jobs orchestrators](chapter-08-merge-opportunities/collapse-jobs-orchestrators.md)
- [CLI workspace integration](chapter-08-merge-opportunities/cli-workspace-integration.md)
- [Logger uniformity](chapter-08-merge-opportunities/logger-uniformity.md)
- [Pi-runtime helpers](chapter-08-merge-opportunities/pi-runtime-helpers.md)
- [Chat leftover cleanup](chapter-08-merge-opportunities/chat-leftover-cleanup.md)

### Reference

- [Index](reference/index.md)
- [Diff inventory](reference/diff-inventory.md)
- [Commit log](reference/commit-log.md)
- [pi-mono comparison](reference/pi-mono-comparison.md)
- [t3code comparison](reference/t3code-comparison.md)

---

## How this wiki was built

Eight chapter sub-agents (run in two parallel waves of four) each authored a directory of markdown files based on direct reads of the codebase, the diff against `origin/main`, and the design documents `MIGRATION.md`, `scope.md`, `plan.md`, `CONTROLLER_SCOPE.md`. The top-level orchestrator wrote the overview, reference, glossary, and this README.

Total: **87 markdown files**. 

To verify any claim, the orchestrator and sub-agents always cited full repo-relative file paths and ran live `Read` / `git diff` against the working tree at HEAD `7e40ffd9`.
