# AGENTS.md

Local Studio is one Bun/Hono controller binary (discovery, lifecycle, a three-dialect gateway, metrics, federation, deploy) plus a read-mostly Vite/React UI and a thin Electron shell. `docs/ARCHITECTURE.md` is the design contract.

- Types, request bodies, formulas and formatters are defined once in `packages/contracts`; the controller and UI import them.
- Keep it small: stay inside the size budgets in `docs/ARCHITECTURE.md` and the "left out" list. Hard cap: `git ls-files '*.ts' '*.tsx' '*.css' '*.js' '*.cjs' '*.mjs' '*.sh' | xargs cat | wc -l` must stay at or under 14,000; CI fails above it. Prefer deleting to adding.
- Controller self-observability: `GET /api/health/detail` (event-loop lag, memory, scan/scrape/gateway timings, db size and write queue, SSE clients, error counters, last errors) and `GET /metrics` (Prometheus text). Logs are JSON lines with `level`.
- Never set `max_tokens`, output caps or thinking budgets, never use `--enforce-eager` or disabled CUDA graphs.
- Every ssh, docker, process and network call carries a hard timeout.
- A value that cannot be measured correctly is `null`, never 0.
- Do not write tests; verify against a live controller and real engines.
- Never expose credentials: keys live in 0600 files, never on argv or in logs.
- Branch from `origin/dev`, one scoped PR per branch targeting `dev`, conventional commits, never bypass git hooks (`git config core.hooksPath .githooks`).
- Run `bun run typecheck && bun run build:ui` before handoff.
