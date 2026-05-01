# Glossary

Terms that recur across this PR review.

| Term | Meaning |
|---|---|
| **pi** / **pi-mono** | The external coding-agent toolkit at [badlogic/pi-mono](https://github.com/badlogic/pi-mono). Three packages: `pi-ai` (LLM API), `pi-agent-core` (loop), `pi-coding-agent` (filesystem + skills + sessions). vLLM Studio now depends on the `pi` CLI binary as a subprocess rather than embedding `pi-agent-core` in the controller. |
| **t3code** | The web UI at [pingdotgg/t3code](https://github.com/pingdotgg/t3code) used as a visual + interaction reference for the new agent surface. |
| **AgentWorkspace** | The new top-level frontend chrome at `frontend/src/app/agent/_components/agent-workspace.tsx`. Hosts `ChatPane`, `FilesystemPanel`, optional embedded browser. |
| **ChatPane** | Per-pane chat surface at `frontend/src/app/agent/_components/chat-pane.tsx`. Talks to `/api/agent/turn` and renders streaming pi events. |
| **PiRpcSession** | The per-session subprocess wrapper in `frontend/src/lib/agent/pi-runtime.ts` that spawns `pi --mode rpc` and proxies JSON-RPC over stdio. |
| **EngineService** | The new public contract for the engines module at `controller/src/modules/engines/services/engine-service.ts`. Replaces the old `lifecycleCoordinator` + `downloadManager` ad-hoc surface. |
| **engine-coordinator** | `controller/src/modules/engines/layers/engine-coordinator.ts`. Orchestrates the engine lifecycle state machine, dispatches state events, executes effects (spawn/kill processes, fire SSE events). |
| **download-machine** | A pure state machine at `controller/src/modules/engines/layers/download-machine.ts` driving `idle → queued → downloading → verifying → ready | error`. |
| **System module** | New consolidated module at `controller/src/modules/system/` containing what used to be `monitoring/`, `lifecycle/platform/`, and `lifecycle/metrics/`. |
| **agent-files** | The deleted server-side abstraction (`controller/src/modules/chat/agent-files/`) that let the in-controller agent write to a sandboxed FS. Replaced by pi reading the user's actual project directory directly. |
| **agentfs-sdk** | External dep that backed the old agent-files. Removed. |
| **Project picker** | New flow ported from t3code: user picks a real directory via `dialog.showOpenDialog`, persisted in `~/.vllm-studio/projects.json`, becomes the `cwd` of the pi subprocess. |
| **Browser extension** | A pi-tool extension at `frontend/desktop/resources/pi-extensions/browser.ts`. Loaded with `--extension` only when the user toggles "Browser tool" on. Calls back into `/api/agent/browser/*` to drive an embedded `<webview>`. |
| **Recipe** | A launch profile for an inference backend: `id, name, backend, model_path, served_model_name, args, python_path`. Persisted in SQLite. Now owned by `models/recipes/`. |
| **Microcommit** | Per-turn commit hygiene rule from `frontend/AGENTS.md`. Visible across the 67-commit log as `micro:` prefixes. |
| **Phase 1–5** | The five migration phases logged in [MIGRATION.md](../../MIGRATION.md): engines, system, models, chat, proxy. |
