# Desktop (Electron) Agent Notes

- Keep main process hardened: `contextIsolation=true`, `sandbox=true`, `nodeIntegration=false`.
- Never expose raw Node APIs to renderer; route through explicit IPC allowlists.
- Keep packaged runtime self-contained (embedded standalone Next server + static/public assets).
- Preserve deterministic logs in `app.getPath("userData")/logs/desktop.log` for supportability.
- Always rebuild, reinstall, and relaunch the desktop app after any frontend change — it bundles its own copy of the frontend (embedded standalone Next server), so remote/web deploys never update it. Use `desktop:pack` for iteration and `desktop:dist` before release, then replace the canonical `/Applications/Local Studio.app` (see ../../AGENTS.md → Deployment Workflow). Confirm before the `rm -rf` of the installed app.
- A separate isolated beta app (its own app name, bundle id, user data path) is the exception, only for risky feature-branch testing where the user's working app must stay untouched.
