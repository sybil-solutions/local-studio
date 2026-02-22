# Contributing to vLLM Studio

Thank you for your interest in contributing!

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Bun | >= 1.0 | `curl -fsSL https://bun.sh/install \| bash` |
| Node.js | >= 20 | [nodejs.org](https://nodejs.org) |
| Docker | Latest (optional) | [docker.com](https://docs.docker.com/get-docker/) |

## Getting Started

```bash
# Clone
git clone https://github.com/0xSero/vllm-studio.git
cd vllm-studio

# Install dependencies
cd controller && bun install && cd ..
cd cli && bun install && cd ..
cd frontend && npm install && cd ..

# Run controller (mock inference, no GPU needed)
./start.sh --direct

# Run frontend (separate terminal)
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the controller runs on port 8080.

## Development Commands

### Controller (`controller/`)

```bash
bun run dev          # Start with auto-reload
bun run typecheck    # Type check
bun run lint         # ESLint
bun run lint:fix     # ESLint auto-fix
bun test             # Run tests
bun run check        # All checks (knip, jscpd, depcheck)
```

### CLI (`cli/`)

```bash
bun run dev          # Start with auto-reload
bun run typecheck    # Type check
bun run lint         # ESLint
bun test             # Run tests
bun run check        # All checks
```

### Frontend (`frontend/`)

```bash
npm run dev          # Start dev server
npm run lint         # ESLint
npm test             # Vitest
npm run check        # All checks (knip, jscpd, depcheck)
```

## Code Style

- **Linting**: ESLint + Prettier in all workspaces
- **Pre-commit**: Husky runs lint-staged on commit
- **Commits**: Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)

## Project Structure

| Directory | Runtime | Description |
|-----------|---------|-------------|
| `controller/` | Bun + Hono | API server, process management, SQLite stores |
| `cli/` | Bun | Terminal UI for managing models |
| `frontend/` | Node + Next.js | Web UI (chat, recipes, analytics) |
| `swift-client/` | Swift | iOS client |
| `desktop/` | — | Desktop application |

## Pull Request Guidelines

1. Fork the repository
2. Create a branch: `git checkout -b feat/your-feature`
3. Make changes and run checks: `bun run check` / `npm run check`
4. Commit with a conventional commit message
5. Open a Pull Request

Keep PRs focused on a single feature or fix. Update documentation if needed.

## Questions?

Open an issue for any questions or discussions.
