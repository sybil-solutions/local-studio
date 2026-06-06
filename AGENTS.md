# AGENTS.md

## Sensitive Configuration

**NEVER commit sensitive data to Git.** Store these in `.env.local` (already gitignored):

```bash
# Remote deployment
REMOTE_HOST=192.168.x.x          # Production server IP
REMOTE_USER=username             # SSH username
REMOTE_PATH=/home/user/project   # Deploy path
REMOTE_URL=https://your-domain.com

# API Keys
```

Access these in scripts via environment variables or load them from `.env.local` in your deployment scripts.

## Deployment Targets

### Production — Remote GPU Server

- **Deploy**: `./scripts/deploy-remote.sh` (or `controller` / `frontend` / `status`)
- Controller (bun :8080) and frontend (next :3000) run natively.

### Local Mac Dev / Verification

- **Agent surface**: `http://localhost:3001/agent`
- **Run**: `cd frontend && PORT=3001 npm run dev`
- **Do not run dev unless explicitly asked.** If a dev server is already running, you may use it for verification.
- Use this local server for fast browser verification unless the user explicitly asks for a different port or deployment target.
- **Always rebuild and reinstall the desktop app after any frontend change.** The desktop app bundles its own copy of the frontend (embedded standalone Next server), so `./scripts/deploy-remote.sh frontend` and any web/remote deploy update only the homelab web UI (`:3000`) — they do **not** update the desktop app. Whenever you touch `frontend/`, rebuild and reinstall the canonical app into `/Applications/vLLM Studio.app` per [Deployment Workflow](#deployment-workflow). The user has explicitly approved the documented clean reinstall step (`rm -rf "/Applications/vLLM Studio.app"` followed by `ditto`); do not leave rebuilt desktop apps only under `frontend/dist-desktop/`.
- **Beta desktop app (exception, for risky feature-branch testing only)**: if you need to test without touching the user's working app, build/install a separate beta app with its own app name, bundle id, and user data path. This is the exception — the default is to rebuild and reinstall the canonical `/Applications/vLLM Studio.app`.
- **Desktop dev mode for iterative UI work**: launch Electron against the local dev server so frontend changes show up without rebuilding the installed app:

```bash
# Terminal 1
cd frontend && PORT=3001 npm run dev

# Terminal 2
cd frontend && npm run desktop:build:main && VLLM_STUDIO_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:3001 npm run desktop:start
```

- Prefer this desktop dev mode while debugging/iterating on the Mac app.

## Build Modes

Use the right build mode for the situation:

### Fast Desktop Test Build

Use this when the user wants to quickly test the installed Mac app locally.

```bash
cd frontend && npm run desktop:pack
```

- `desktop:pack` builds the app directory only (`frontend/dist-desktop/mac-arm64/vLLM Studio.app`).
- It skips distributable DMG/ZIP/blockmap creation and is much faster than `desktop:dist`.
- After `desktop:pack`, always replace `/Applications/vLLM Studio.app` using the [Installed Desktop App Update](#installed-desktop-app-update-required) steps.
- This is for local testing only; it does **not** replace the production/pre-push gate.

### Production / Pre-Push Build

Use this before pushing, releasing, or calling a feature production-ready.

```bash
git push
```

The configured pre-push hook (`.githooks/pre-push`) is the production quality gate. It checks conventional commits and runs:

```bash
npm --prefix frontend run check:quality
```

For a production desktop artifact, run:

```bash
cd frontend && npm run desktop:dist
```

- `desktop:dist` creates the signed app plus DMG/ZIP distributables.
- Use `desktop:dist` for production/release readiness, not for every quick local visual test.
- After `desktop:dist`, always replace `/Applications/vLLM Studio.app` using the [Installed Desktop App Update](#installed-desktop-app-update-required) steps.

## Deployment Workflow

After finishing a feature, you **MUST** complete the appropriate deployment steps. This is not optional.

- For a quick user test, use the **Fast Desktop Test Build** path.
- Before pushing/release/production-ready status, use the **Production / Pre-Push Build** path.
- **The desktop rebuild + reinstall (steps 5–7 below) is mandatory after any frontend change** — the desktop app bundles its own frontend and is never updated by remote/web deploys. Use `desktop:pack` for iteration, `desktop:dist` before release.

After finishing a feature, follow this checklist:

1. **Build check**: `cd frontend && npx next build`
2. **Verify local app**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/agent` (should be 200 when the local dev server is running)
3. **Remote deploy** (if needed): `./scripts/deploy-remote.sh` (syncs, builds, restarts)
4. **Verify remote**: check production URLs (see `.env.local` for REMOTE_HOST)
5. **Desktop Electron update for quick local testing**: `cd frontend && npm run desktop:pack`
6. **Desktop Electron update for production/release**: `cd frontend && npm run desktop:dist`
7. **Update installed Desktop app** (REQUIRED after either desktop build): See [Installed Desktop App Update](#installed-desktop-app-update-required) section below

### Installed Desktop App Update (Required)

Do **not** leave the new desktop build only in `frontend/dist-desktop/`.
There must be **one canonical installed app only**:

- Canonical app: `/Applications/vLLM Studio.app`
- Canonical bundle id: `org.vllm.studio.desktop`
- Legacy duplicate to remove if present: `~/Applications/vllm-studio-mac.app`

After `desktop:pack` or `desktop:dist`, replace the installed app bundle cleanly. Do not layer a new app bundle on top
of the old one with plain `ditto`; stale sealed resources will invalidate the code signature.

```bash
# Apple Silicon
rm -rf "/Applications/vLLM Studio.app"
ditto "frontend/dist-desktop/mac-arm64/vLLM Studio.app" "/Applications/vLLM Studio.app"

# Intel fallback
rm -rf "/Applications/vLLM Studio.app"
# ditto "frontend/dist-desktop/mac/vLLM Studio.app" "/Applications/vLLM Studio.app"
```

Then enforce single-install + relaunch:

```bash
# Remove old non-canonical app if present
rm -rf "$HOME/Applications/vllm-studio-mac.app"

# Relaunch canonical app. Force LaunchServices to re-register the freshly
# replaced bundle first and open it by full path — otherwise `open -a` can
# fail with error -600 (stale registration / ambiguous name) right after ditto.
killall "vLLM Studio" >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  pgrep -x "vLLM Studio" >/dev/null || break
  sleep 0.5
done
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/vLLM Studio.app"
open "/Applications/vLLM Studio.app"
```

Verification (required):

```bash
# Must show only /Applications/vLLM Studio.app
find /Applications "$HOME/Applications" -maxdepth 1 -type d -iname "*v*llm*studio*.app"

# Must print org.vllm.studio.desktop
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "/Applications/vLLM Studio.app/Contents/Info.plist"
```

## Agent File System

- File writing/reading in chat is local-only and stored under `data/agentfs`
- If file operations break, inspect the local data directory and restart the controller before debugging frontend state

## Notes

- Remote server specs: AMD EPYC, 8x RTX 3090, CUDA 12.8 (see `.env.local` for host)
- rsync/scp fail due to remote shell output; deploy script uses tar+ssh pipe as workaround
- Remote `next build` may fail (turbopack + redis permissions); the deploy script builds locally and ships `.next/`
