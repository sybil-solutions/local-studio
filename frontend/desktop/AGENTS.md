# Desktop (Electron) Agent Notes

- Keep main process hardened: `contextIsolation=true`, `sandbox=true`, `nodeIntegration=false`.
- Never expose raw Node APIs to renderer; route through explicit IPC allowlists.
- Keep packaged runtime self-contained (embedded standalone Next server + static/public assets).
- Preserve deterministic logs in `app.getPath("userData")/logs/desktop.log` for supportability.
- Do not build, package, replace, or relaunch the desktop app unless the user explicitly asks for desktop verification.
- When desktop verification is requested, use an isolated beta app name, bundle id, and user data path so `/Applications/vLLM Studio.app` and the user's production work app are not disturbed.
