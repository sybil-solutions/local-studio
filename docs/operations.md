# Setup & Operations

How to get vLLM Studio running — locally, as a daemon, on a remote GPU server, or as a desktop app.

---

## Prerequisites

- **Node.js** ≥ 20 (frontend)
- **Bun** ≥ 1.1 (controller, CLI)
- **Python** ≥ 3.10 (inference runtimes — vLLM, SGLang, llama.cpp)
- **GPU** with CUDA ≥ 12 or ROCm (for real inference; mock mode works on CPU)
- **PostgreSQL** (optional — only needed for production persistence; SQLite is the default)

---

## Quick Start (Local Dev)

### 1. Controller

```bash
cd controller
bun install
bun test          # verify everything works
bun src/main.ts   # starts on http://127.0.0.1:8080
```

### 2. Frontend

```bash
cd frontend
npm ci
npm run dev       # starts on http://localhost:3000
```

### 3. Verify

```bash
curl -sS http://localhost:8080/health    # controller
curl -I http://localhost:3000             # frontend
```

Open `http://localhost:3000/agent` for the agent workspace.

---

## Configuration

All knobs are environment variables. See [environment.md](./environment.md) for the full reference.

For local dev the defaults work out of the box. The most common overrides:

```bash
# Controller on a different port
VLLM_STUDIO_PORT=9090 bun src/main.ts

# Frontend pointed at a remote controller
BACKEND_URL=http://192.168.1.50:8080 npm run dev

# Skip API key auth for local dev
VLLM_STUDIO_ALLOW_UNAUTHENTICATED=1 bun src/main.ts
```

---

## Docker (Infrastructure Only)

The controller and frontend run natively (they need GPU tool access and host process visibility). Docker is only used for the PostgreSQL database when you want production persistence:

```bash
docker compose up -d postgres
```

SQLite is used by default — you don't need Docker at all for local dev.

---

## Daemon Mode

Run the controller as a background daemon on a Linux server:

```bash
./scripts/daemon-start.sh    # starts controller in background
./scripts/daemon-status.sh   # check if it's running
./scripts/daemon-stop.sh     # stop the daemon
```

Logs go to `logs/controller.log`.

---

## Remote Deployment

Deploy to a remote GPU server via SSH. Requires `.env.local` with connection details:

```bash
# .env.local (gitignored)
REMOTE_HOST=192.168.x.x
REMOTE_USER=username
REMOTE_PATH=/home/user/project
```

Then:

```bash
./scripts/deploy-remote.sh            # full deploy (sync, build, restart)
./scripts/deploy-remote.sh controller  # controller only
./scripts/deploy-remote.sh frontend    # frontend only
./scripts/deploy-remote.sh status      # check remote service status
```

The deploy script builds the frontend locally and ships `.next/` to avoid Turbopack permission issues on the remote.

---

## Desktop App (macOS)

### Dev mode — iterate without reinstalling

```bash
# Terminal 1: dev server
cd frontend && PORT=3001 npm run dev

# Terminal 2: Electron against dev server
cd frontend && npm run desktop:build:main && \
  VLLM_STUDIO_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:3001 npm run desktop:start
```

### Quick local test build

```bash
cd frontend && npm run desktop:pack
```

Then replace the installed app:

```bash
rm -rf "/Applications/vLLM Studio.app"
ditto "frontend/dist-desktop/mac-arm64/vLLM Studio.app" "/Applications/vLLM Studio.app"
rm -rf "$HOME/Applications/vllm-studio-mac.app"  # remove legacy install
killall "vLLM Studio" >/dev/null 2>&1 || true
open -a "vLLM Studio"
```

### Production build

```bash
cd frontend && npm run desktop:dist   # creates signed app + DMG/ZIP
```

Then replace the installed app using the same steps as above.

### Verify the installed app

```bash
# Must show only /Applications/vLLM Studio.app
find /Applications "$HOME/Applications" -maxdepth 1 -type d -iname "*v*llm*studio*.app"

# Must print org.vllm.studio.desktop
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
  "/Applications/vLLM Studio.app/Contents/Info.plist"
```

---

## Health Checks

| Endpoint | Purpose |
|---|---|
| `GET /health` | Controller liveness |
| `GET /status` | Controller status (models, runtime info) |
| `GET /api/docs` | Swagger UI |
| `GET /api/spec` | OpenAPI spec |
| `GET /` (frontend :3000) | Frontend liveness |

---

## Mock Mode

Run without a GPU for UI development and testing:

```bash
VLLM_STUDIO_MOCK_INFERENCE=1 bun src/main.ts
```

Mock mode returns synthetic inference responses — no real model is loaded.

---

## Troubleshooting

**Controller won't start:**
- Check nothing else is on port 8080: `lsof -i :8080`
- Verify Bun is installed: `bun --version`
- Run typecheck first: `cd controller && npx tsc --noEmit`

**Frontend can't reach the controller:**
- Verify the controller is running: `curl http://localhost:8080/health`
- Check `BACKEND_URL` is set correctly if the controller isn't on localhost:8080
- See [environment.md](./environment.md) for URL resolution precedence

**Agent file operations broken:**
- Inspect `data/agentfs/` on the controller host
- Restart the controller before debugging frontend state
- Agent file operations are local-only and stored under `data/agentfs`

**Build failures on remote:**
- The deploy script builds locally and ships `.next/` — Turbopack + Redis permissions on the remote can cause failures if you try `next build` there directly

---

[← Back to docs index](./README.md)
