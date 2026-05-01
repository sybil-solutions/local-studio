# Pattern 12 — Test colocation

Tests live next to the source they exercise as `<source>.test.ts`. The PR
both adds many new colocated tests and **deletes the dedicated
`frontend/tests/` Playwright tree** — the message being "unit tests next
to source" rather than "end-to-end suite at the root".

## Where it appears

### Controller-side new/changed colocated tests

| Test file | Source it covers |
|-----------|------------------|
| `controller/src/modules/engines/routes.test.ts` | `engines/routes.ts` — registers routes against a fake `EngineService` and asserts HTTP behaviour. |
| `controller/src/modules/engines/layers/engine-coordinator.test.ts` | `engines/layers/engine-coordinator.ts` |
| `controller/src/modules/system/event-manager.test.ts` | `system/event-manager.ts` — pub/sub + backpressure. |
| `controller/src/modules/system/usage/chat-database.test.ts` | `system/usage/chat-database.ts` |
| `controller/src/modules/system/usage/pi-sessions.test.ts` | `system/usage/pi-sessions.ts` (the new pi-session reader). |
| `controller/src/modules/proxy/openai-routes.test.ts` | `proxy/openai-routes.ts` |
| `controller/src/modules/models/recipes/recipe-store.test.ts` | `models/recipes/recipe-store.ts` |

### Frontend-side new/changed colocated tests

| Test file | Source it covers |
|-----------|------------------|
| `frontend/src/hooks/use-model-lifecycle.test.ts` | `hooks/use-model-lifecycle.ts` |
| `frontend/src/lib/agent/models.test.ts` | `lib/agent/models.ts` |
| `frontend/src/app/agent/_components/chat-pane.test.ts` | `app/agent/_components/chat-pane.tsx` |
| `frontend/src/app/usage/lib/normalize-usage-stats.test.ts` | `app/usage/lib/normalize-usage-stats.ts` |
| `frontend/src/hooks/use-controller-events/routing.test.ts` | `hooks/use-controller-events/routing.ts` |

### Deleted

- `frontend/tests/` — the dedicated Playwright directory was deleted in
  this PR. See Chapter 1 — `deletions-inventory.md` for the full list of
  removed files.
- `controller/src/http/security-middleware.test.ts` — the test file was
  removed even though the implementation remains. Flagged for Chapter 7.

## Why this pattern

- **Discoverability.** Refactoring a module means touching its tests in
  the same diff hunk. Out-of-tree tests get forgotten or land in
  follow-up PRs.
- **No test-only path mapping.** The colocated test imports from `./`
  and reuses the same `tsconfig.json` resolution as the source.
- **Bun test runner finds them.** `bun test` (controller) and
  `vitest`-equivalent runners (frontend) follow `*.test.ts` globs by
  default; no extra configuration needed.
- **Forces tests to be unit-shaped.** When a test file lives next to a
  500-LoC implementation, the social pressure is to keep the test
  exercising small surfaces — call the public functions directly and
  assert on returned values, not "spin up the whole controller and hit
  HTTP".
- **Reduces the appeal of E2E.** The deleted `frontend/tests/`
  Playwright suite was a maintenance liability (real browser, real
  ports, real pi binary). The PR signals that the team prefers to
  invest in unit-level coverage instead.

## Trade-offs

- **No integration safety net.** Without E2E tests, regressions that
  span controller + frontend (e.g., "the renderer's SSE event types fall
  out of sync with the controller's published events") may go
  undetected. Chapter 7 will flag this.
- **Test files inflate module size.** A reader `cat`-ing
  `engines/layers/` sees test files alongside source. The pattern works
  best when test files are notably smaller than their source.
- **Source-test boundaries blur.** A `routes.test.ts` that mocks an
  entire `EngineService` is closer to integration-level than unit-level.
  The colocation convention doesn't enforce a granularity.
- **Playwright was deleted, not migrated.** The PR doesn't introduce a
  smaller integration suite to replace it. The implicit policy "we test
  units only" leaves a gap.

## Cross-references

- [Chapter 1 — `deletions-inventory.md`](../chapter-01-frontend/deletions-inventory.md) — the deleted `frontend/tests/` Playwright tree.
- [Chapter 2 — `engines-module.md`](../chapter-02-controller/engines-module.md), [`system-module.md`](../chapter-02-controller/system-module.md), [`proxy-module.md`](../chapter-02-controller/proxy-module.md) — see the colocated tests in context.
- [Chapter 7 — TBD] — security-middleware test deletion as a regression.
