# Ralph Guardrails

## Sign: Avoid hidden destructive git operations
- Trigger: need to reset branches or rewrite history
- Instruction: avoid git reset --hard; use safe alternatives or note divergence
- Added after: policy blocked git reset

## Sign: Keep CI depcheck aligned with Bun built-ins
- Trigger: depcheck fails on bun:test or similar built-ins
- Instruction: add bun built-ins to depcheck ignores (workflow + scripts)
- Added after: CI blocked on bun:test missing dependency

## Sign: Pin Turbopack root in monorepo
- Trigger: Next build scans repo root or hits permission errors
- Instruction: set `turbopack.root` to frontend dir in `next.config.ts`
- Added after: build failed reading data/postgres on server

## Sign: Avoid client-only state in SSR render
- Trigger: using window/localStorage during initial render
- Instruction: initialize deterministic defaults and apply window/localStorage in useEffect after mount
- Added after: React #418 hydration failure on /chat

## Sign: Handle settings file ownership mismatch
- Trigger: API settings save fails with EACCES/EPERM on existing file
- Instruction: if file exists but is unwritable, unlink and rewrite in a writable directory
- Added after: Config save failed on server-mounted data volume
