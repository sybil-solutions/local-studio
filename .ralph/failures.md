# Ralph Failures
## Failure: CI depcheck missing built-ins
- Trigger: CI depcheck flagged `bun:test` as missing dependency.
- Fix: Add `bun:test` to depcheck ignore list (workflow + script).

## Failure: Frontend build panic on server data dir
- Trigger: Next/Turbopack attempted to read `/data/postgres` (permission denied).
- Fix: Set `turbopack.root` to frontend directory to avoid monorepo root scanning.

## Failure: Frontend tests with no files
- Trigger: `vitest run` exits non-zero when no tests exist.
- Fix: Use `vitest run --passWithNoTests`.
