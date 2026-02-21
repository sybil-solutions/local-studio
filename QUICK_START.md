<!-- CRITICAL -->
# Quick Start

Use these commands before merging changes for each package.

## Installation

```bash
# Controller
cd controller && bun install
cd cli && bun install
cd frontend && npm install
```

## Core validation commands

```bash
cd controller
bun run typecheck
bun run lint
bun run check
bun test

cd ../cli
bun run typecheck
bun run lint
bun run check
bun run test

cd ../frontend
npm run lint
npm run build
npm run check
npm test
```

## Check command details

- `bun run check` (controller): `knip`, `jscpd src`, `depcheck`
- `bun run check` (cli): `knip`, `jscpd src`, `depcheck`
- `npm run check` (frontend): `knip`, `jscpd src`, `depcheck`

## Optional focused checks

- `bun run lint:fix` (controller, CLI)
- `bunx depcheck`
- `npm run lint:fix`

## Recommended order

1. Type checks and lint (`typecheck`, `lint`)
2. `check` command for stale code/dependency debt
3. Targeted tests (`test`)
4. Frontend full build

Avoid claiming production readiness until all checks are green.
