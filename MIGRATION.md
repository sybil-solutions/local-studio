# Migration Status

| Domain       | Phase | Status       |
|-------------|-------|-------------|
| engines     | 1.1   | 🟢 done — lifecycle/download hardening |
| system      | 2     | 🟢 done     |
| models      | 3.1   | 🟢 done — HF explore/search hardening |
| chat        | 4.1   | 🟢 done — Agent tab tool-call streaming |
| pass-through| 5     | 🟢 done     |

## Phase 1: Engines Module — Completed

### Summary

The `engines/` module is fully wired and replaces the old `lifecycle/engines/`, `lifecycle/process/`, `lifecycle/runtime/`, `lifecycle/state/`, and `downloads/` modules.

### What moved into `engines/`

| Old location | New location |
|---|---|
| `lifecycle/engines/backends.ts` | `engines/layers/backend-builder.ts` |
| `lifecycle/runtime/vllm-runtime.ts` | `engines/layers/vllm-runtime.ts` |
| `lifecycle/runtime/llamacpp-runtime.ts` | `engines/layers/llamacpp-runtime.ts` |
| `lifecycle/runtime/vllm-python-path.ts` | `engines/layers/vllm-python-path.ts` |
| `lifecycle/runtime/runtime-info.ts` | `engines/layers/runtime-info.ts` |
| `lifecycle/runtime/runtime-upgrade.ts` | `engines/layers/runtime-upgrade.ts` |
| `lifecycle/runtime/runtime-upgrade-config.ts` | `engines/layers/upgrade-config.ts` |
| `lifecycle/runtime/configs.ts` | merged into `engines/configs.ts` |
| `lifecycle/process/process-manager.ts` | `engines/layers/process-manager.ts` |
| `lifecycle/process/process-utilities.ts` | `engines/layers/process-utilities.ts` |
| `lifecycle/state/launch-state.ts` | `engines/layers/launch-state.ts` |
| `lifecycle/state/lifecycle-coordinator.ts` | `engines/layers/engine-coordinator.ts` |
| `lifecycle/configs.ts` | merged into `engines/configs.ts` |
| `lifecycle/routes/lifecycle-routes.ts` | `engines/routes.ts` |
| `lifecycle/routes/runtime-routes.ts` | `engines/routes.ts` |
| `downloads/manager.ts` | `engines/layers/download-manager.ts` |
| `downloads/store.ts` | `engines/layers/download-store.ts` |
| `downloads/huggingface-api.ts` | `engines/layers/huggingface-api.ts` |
| `downloads/download-paths.ts` | `engines/layers/download-paths.ts` |
| `downloads/download-math.ts` | `engines/layers/download-math.ts` |
| `downloads/download-globs.ts` | `engines/layers/download-globs.ts` |
| `downloads/types.ts` | `engines/types.ts` |
| `downloads/configs.ts` | merged into `engines/configs.ts` |
| `downloads/routes.ts` | `engines/routes.ts` |

### What was deleted

- `controller/src/modules/downloads/` — entire directory removed
- `controller/src/modules/lifecycle/engines/` — entire directory removed
- `controller/src/modules/lifecycle/process/` — entire directory removed
- `controller/src/modules/lifecycle/runtime/` — entire directory removed
- `controller/src/modules/lifecycle/state/` — entire directory removed
- `controller/src/modules/lifecycle/configs.ts` — removed
- `controller/src/modules/lifecycle/routes/lifecycle-routes.ts` — removed
- `controller/src/modules/lifecycle/routes/runtime-routes.ts` — removed

### What stays in `lifecycle/` (for Phase 2/3)

- `lifecycle/platform/` → Phase 2 (system module)
- `lifecycle/metrics/` → Phase 2 (system module)
- `lifecycle/recipes/` → Phase 3 (models module)
- `lifecycle/routes/system-routes.ts` → Phase 2 (system module)
- `lifecycle/types.ts` → Phase 2 (shared or system)

### Wiring changes

- `AppContext` now exposes `engineService: EngineCoordinator` instead of `lifecycleCoordinator`
- `engineService` provides `launch()`, `ensureActive()`, `evict()`, `cancelLaunch()`, download methods, and runtime methods
- `processManager` and `downloadManager` remain in AppContext for backward compatibility with consumers not yet migrated
- `proxy/openai-routes.ts` and `audio/routes.ts` updated to use `engineService` instead of `lifecycleCoordinator`
- `studio/routes.ts` updated to import from `engines/layers/` instead of `lifecycle/runtime/`
- `http/app.ts` registers `registerEngineRoutes` + `registerSystemRoutes` instead of `registerAllLifecycleRoutes` + `registerDownloadsRoutes`

### New constructs

- **State machines**: `engine-lifecycle-machine.ts` and `download-machine.ts` using shared `createStateMachine`
- **EngineService interface**: `services/engine-service.ts` — the single public contract
- **Engine coordinator**: `layers/engine-coordinator.ts` — orchestrates lifecycle, dispatches events to state machine, implements `EngineService`

### Verification

- `npx tsc --noEmit` passes (controller) ✓
- `bun test` passes (113/114, 1 pre-existing failure) ✓
- `npx next build` passes (frontend) ✓

### Phase 1.1 maintenance note — lifecycle/download hardening

Post-migration lifecycle fixes were made in the migrated `engines/` target files:

- `engine-coordinator.ts` now treats manual stop as an authoritative user intent, aborts in-flight launch/switch work, and blocks OpenAI proxy auto-load until the user explicitly starts a model again.
- `process-manager.ts` now stops Docker-backed inference containers more reliably, including the case where the detected backend process is the in-container Python server rather than the `docker run` parent.
- `download-manager.ts` now validates that the configured server-side models directory is writable before queueing a download, so setup errors fail synchronously with an actionable message.
- Added controller tests for manual-stop auto-load blocking and non-writable download directories.

Verification for this maintenance pass:

- `cd controller && bun run typecheck` ✓
- `cd controller && bun test` passes (101/101) ✓
- Remote stop + follow-up OpenAI request verified: stopped model did not relaunch ✓
- Remote server-side download verified under writable models directory and test artifact cleaned up ✓

## Phase 2: System Module — Completed

The `system/` module consolidates monitoring infrastructure and platform detection from three old directories into one.

- `monitoring/` (event-manager, metrics, metrics-store, logs, usage) → `system/`
- `lifecycle/routes/system-routes.ts` → `system/routes.ts`
- `lifecycle/metrics/metrics-collector.ts` → `system/metrics-collector/`
- `lifecycle/platform/` → `system/platform/`

**Deleted:** `monitoring/`, `lifecycle/platform/`, `lifecycle/metrics/`, `lifecycle/routes/`

**What stays in `lifecycle/`:** `recipes/` and `types.ts` (Phase 3 models module)

**Verification:** `bun test` passes (175/179, 4 pre-existing sandbox failures)

## Phase 3: Models Module — Completed

`lifecycle/` directory deleted. `lifecycle/recipes/` moved into `models/recipes/`, `lifecycle/types.ts` merged into `models/types.ts`. 34 import paths rewritten.

**Deleted:** `controller/src/modules/lifecycle/` — entire directory removed (was the last remnant)

**Verification:** `bun test` passes (175/179, 4 pre-existing sandbox failures)

### Phase 3.1 maintenance note — Hugging Face Explore/search hardening

Post-migration model-discovery fixes were made in the migrated `models/` target route and the frontend Explore surface:

- `models/routes.ts` now honors `offset`, normalizes Hugging Face model records, and promotes exact repo-id matches for searches like `Qwen/Qwen3-0.6B`.
- `use-explore.ts` no longer applies the default recency gate to explicit searches, and ranks search results by downloads instead of modified date.
- `explore-tab.tsx` clarifies that downloads are executed by the backend on the server and shows server-side download status/progress/path context.

Verification for this maintenance pass:

- `cd frontend && npm run lint` ✓
- `cd frontend && npm test` passes (55/55) ✓
- `cd frontend && npx next build` ✓
- Remote HF search endpoint verified with exact repo promotion ✓

## Phase 4: Chat Module — Completed

### Summary

The chat module was already in its final location at `controller/src/modules/chat/` (no duplicate existed). Phase 4 focused on internal structure: extracting services from the 248-line `chat-run-factory.ts` orchestration function.

### What changed

- Extracted `user-message-writer.ts` (45 lines) — builds user message parts (text + images), persists via `chatStore.addMessage()`, returns agent-compatible image array. Removes ~30 lines from the factory.
- Extracted `agent-event-pipeline.ts` (159 lines) — owns per-run mutable state (7 fields), builds agent tools, subscribes to agent events, publishes RUN_START/RUN_END, runs `agent.prompt()` with abort/error handling and cleanup. Removes ~125 lines from the factory.
- `chat-run-factory.ts` slimmed from 248 to 126 lines — pure orchestration: validate, resolve model, build system prompt, map history, write user message, create run record, setup queue/publisher, construct agent, delegate to pipeline, return SSE stream.

### Verification

- `bun test` passes (107/108, 1 pre-existing DNS sandbox failure) ✓

### Phase 4.1 maintenance note — Agent tab tool-call streaming

Post-migration Agent tab fixes were made in the migrated chat/agent frontend surface:

- `frontend/src/app/agent/_components/chat-pane.tsx` now consumes Pi `toolcall_start` / `toolcall_delta` message updates from `assistantMessageEvent.partial.content[contentIndex]` and `delta`, matching pi-mono's streamed tool-call argument protocol.
- File-writing tool blocks (`write`, `edit`, and related names) now receive partial parsed arguments while the model is still generating the tool call, so large file content appears incrementally instead of only after `toolcall_end`.
- Session replay now hydrates streamed tool-call deltas as well as finalized tool-call events.
- Added a regression test for streamed `write` tool-call argument deltas in `chat-pane.test.ts`.

Verification for this maintenance pass:

- `cd frontend && npm test -- --run src/app/agent/_components/chat-pane.test.ts` ✓
- `cd frontend && npx eslint src/app/agent/_components/chat-pane.tsx src/app/agent/_components/chat-pane.test.ts` ✓
- `cd frontend && npx next build` ✓
- `cd frontend && npm run desktop:dist` ✓
- Installed `/Applications/vLLM Studio.app` replaced and bundle id verified (`org.vllm.studio.desktop`) ✓

## Phase 5: Pass-through/OpenAI Proxy — Completed

### Summary

The proxy module was already consolidated in `controller/src/modules/proxy/` (no old duplicate existed). Phase 5 focused on internal structure: moving cross-cutting utilities to the right layer and splitting the monolithic `tool-call-core.ts` (863 lines) into focused files.

### What changed

- Moved `cleanUtf8StreamContent()` + `Utf8State` from `proxy/proxy-parsers.ts` and `proxy/types.ts` to `core/utf8.ts` — these are text utilities used by `chat/agent/run-manager-utf8.ts`, not proxy concerns. Fixes the backward dependency where chat imported from proxy.
- Deleted `proxy/proxy-parsers.ts` (empty after move).
- Split `tool-call-core.ts` (863 lines) into 4 focused files:
  - `tool-call-parser.ts` — `ToolCall` interface, `createToolCallId()`, `parseToolCallsFromContent()`
  - `content-normalizer.ts` — `normalizeToolRequest()`, `normalizeChatMessageContentParts()`
  - `reasoning-extractor.ts` — `normalizeReasoningAndContentInMessage()`, `normalizeToolCallsInMessage()`
  - `tool-call-stream.ts` — `StreamUsage` interface, `createToolCallStream()`
- Updated `openai-routes.ts` and test imports to reference the new files.
- Proxy barrel (`index.ts`) now exports from all 4 new files instead of the monolithic `tool-call-core.ts`.

### Verification

- `bun test` passes (107/108, 1 pre-existing DNS sandbox failure) ✓
- `bun test src/modules/proxy/openai-routes.test.ts src/tests/tool-call-core.test.ts` passes (20/20) ✓
