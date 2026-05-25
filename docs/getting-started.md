# Getting Started

Pick the path that matches what you want. Each section is self-contained — you only need the commands in your path.

---

## I want the desktop app (macOS)

You need:
- **Node.js** ≥ 20 — `node --version`
- **Git** — `git --version`

```bash
# 1. Clone
git clone https://github.com/sybil-solutions/vllm-studio.git && cd vllm-studio

# 2. Install & build
cd frontend && npm ci && npm run desktop:pack

# 3. Install to /Applications
rm -rf "/Applications/vLLM Studio.app"
ditto "dist-desktop/mac-arm64/vLLM Studio.app" "/Applications/vLLM Studio.app"
rm -rf "$HOME/Applications/vllm-studio-mac.app"   # remove legacy install

# 4. Launch
open -a "vLLM Studio"
```

The desktop app connects to `http://localhost:8080` by default — point it at your GPU server in Settings, or use mock mode on the server side if you just want to explore the UI.

- [Desktop app details](./desktop-electron.md)
- [Controller setup (for your GPU server)](./operations.md#quick-start-local-dev)

---

## I have a GPU server

You need on the server:
- **Linux** with an NVIDIA GPU (CUDA ≥ 12) or AMD GPU (ROCm)
- **Bun** ≥ 1.1 — `curl -fsSL https://bun.sh/install | bash`
- **Python** ≥ 3.10 — `python3 --version`

### On the GPU server

```bash
# 1. Clone
git clone https://github.com/sybil-solutions/vllm-studio.git && cd vllm-studio

# 2. Start the controller (bind to 0.0.0.0 so other machines can reach it)
cd controller
bun install
VLLM_STUDIO_HOST=0.0.0.0 bun src/main.ts   # runs on http://0.0.0.0:8080
```

To keep it running after you log out:

```bash
# Daemon mode (from the repo root)
./scripts/daemon-start.sh
./scripts/daemon-status.sh   # confirm it's running
```

### On your local machine (or anywhere)

```bash
# 1. Clone (same repo)
git clone https://github.com/sybil-solutions/vllm-studio.git && cd vllm-studio

# 2. Start the frontend, pointing at your server
cd frontend
npm ci
BACKEND_URL=http://your-server-ip:8080 npm run dev
```

Open `http://localhost:3000/agent`.

**Skip auth for local/trusted networks** — on the server, start the controller with:

```bash
VLLM_STUDIO_ALLOW_UNAUTHENTICATED=1 bun src/main.ts
```

- [Full operations guide](./operations.md)
- [Environment variables](./environment.md)

---

## I just want to try the UI (no GPU needed)

You need:
- **Bun** ≥ 1.1 — `curl -fsSL https://bun.sh/install | bash`
- **Node.js** ≥ 20 — `node --version`

```bash
# 1. Clone
git clone https://github.com/sybil-solutions/vllm-studio.git && cd vllm-studio

# 2. Start the controller in mock mode
cd controller
bun install
VLLM_STUDIO_MOCK_INFERENCE=1 bun src/main.ts

# 3. In a second terminal, start the frontend
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000/agent`. Mock mode returns synthetic responses — no model loading, no GPU, just the full UI to explore.

- [Mock mode details](./operations.md#mock-mode)

---

## I want to contribute

You need:
- **Bun** ≥ 1.1
- **Node.js** ≥ 20
- **Python** ≥ 3.10

```bash
# 1. Clone
git clone https://github.com/sybil-solutions/vllm-studio.git && cd vllm-studio

# 2. Controller — install, typecheck, test
cd controller
bun install
npx tsc --noEmit
bun test

# 3. Frontend — install, lint, typecheck, test
cd ../frontend
npm ci
npm run lint
npm run typecheck
npm test
```

All green? You're ready. Pick an issue and open a PR.

- [Contributing guide](../CONTRIBUTING.md)
- [Codebase context](../CONTEXT.md)
- [Architecture docs](./architecture/README.md)

---

## Next: set up a model

Once you're running, head to [Recipes & Models](./recipes.md) to create a recipe, configure a backend, and launch your first model.

---

[← Back to docs index](./README.md)
