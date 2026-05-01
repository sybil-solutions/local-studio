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
- Use this local server for fast browser verification unless the user explicitly asks for a different port or deployment target.

## Deployment Workflow

After finishing a feature, you **MUST** complete ALL deployment steps. This is not optional.

After finishing a feature, follow this checklist:

1. **Build check**: `cd frontend && npx next build`
2. **Verify local app**: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/agent` (should be 200 when the local dev server is running)
3. **Remote deploy** (if needed): `./scripts/deploy-remote.sh` (syncs, builds, restarts)
4. **Verify remote**: check production URLs (see `.env.local` for REMOTE_HOST)
5. **Desktop Electron update (REQUIRED - ALWAYS DO THIS)**: `cd frontend && npm run desktop:dist`
6. **Update installed Desktop app** (REQUIRED - ALWAYS DO THIS): See [Installed Desktop App Update](#installed-desktop-app-update-required) section below

### Installed Desktop App Update (Required)

Do **not** leave the new desktop build only in `frontend/dist-desktop/`.
There must be **one canonical installed app only**:

- Canonical app: `/Applications/vLLM Studio.app`
- Canonical bundle id: `org.vllm.studio.desktop`
- Legacy duplicate to remove if present: `~/Applications/vllm-studio-mac.app`

After `desktop:dist`, replace the installed app bundle cleanly. Do not layer a new app bundle on top
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

# Relaunch canonical app
killall "vLLM Studio" >/dev/null 2>&1 || true
open -a "vLLM Studio"
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
