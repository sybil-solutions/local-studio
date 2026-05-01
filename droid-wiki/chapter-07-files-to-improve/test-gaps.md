# G — Test Gaps

> Two specific gaps. Both are cheap to fill and both unlock safer refactors elsewhere in this chapter.

---

## CLI `X-API-Key`

**Path under test:** `cli/src/api.ts` — **198 LoC** (verified).
**Test file:** `cli/src/api.test.ts` — **192 LoC** (verified).

### Symptoms

- `cli/src/api.ts:86` adds an `X-API-Key` header when `resolveApiKey()` returns a truthy value:
  ```ts
  ...(resolveApiKey() ? { "X-API-Key": resolveApiKey() } : {}),
  ```
- The existing test file does not assert this behavior — verified by reading `cli/src/api.test.ts`.
- Result: future refactors (e.g. moving `resolveApiKey` into a config layer) can silently break the header without test failure.

### Proposed action

Add three test cases to `cli/src/api.test.ts`:

| Case | Setup | Expected |
|------|-------|----------|
| no key configured | `resolveApiKey()` returns `undefined` | request headers do **not** contain `X-API-Key` |
| key from env | `VLLM_STUDIO_API_KEY=abc123` (or however it's read) | request headers contain `X-API-Key: abc123` |
| key from config file | mock `resolveApiKey()` to return a value | request headers contain that value |

Each test asserts on the headers passed to the HTTP client (mock `fetch`).

### Estimated impact

- **+~40 LoC** of test code.
- Risk: **none** (test-only).
- Coverage delta: catches header regressions on every CI run.

### Dependencies

- None.

---

## `tool-call-stream` tests

**Path under test:** `controller/src/modules/proxy/tool-call-stream.ts` — **423 LoC** (verified).
**Test file:** *does not exist.*

### Symptoms

- `controller/src/modules/proxy/openai-routes.test.ts` exists.
- `controller/src/modules/engines/routes.test.ts` exists.
- `tool-call-stream.ts` has **zero tests** despite being a stateful stream transform with the most complex parsing logic in the proxy module.
- This is the file flagged in [section B](./giant-controller-files.md#10-tool-call-streamts) for splitting; tests must land **before** the split to pin behavior.

### Proposed action

Build coverage in two passes.

**Pass 1 (now):** add `controller/src/modules/proxy/tool-call-stream.test.ts` with end-to-end fixtures. Each test feeds a sequence of upstream stream chunks and asserts on the emitted OpenAI tool-call deltas.

Suggested fixtures (one test each):

| Fixture | Input | Expected output |
|---------|-------|-----------------|
| no tool call | normal text deltas | passthrough; no tool-call deltas |
| single XML tool call (in one chunk) | `<tool_call>…</tool_call>` arriving complete | one tool-call delta with `name`, `arguments` |
| single XML tool call (split across chunks) | tag opens in chunk N, closes in chunk N+2 | same final delta as above |
| single JSON tool call | `{"tool":...}` form | one tool-call delta |
| two sequential tool calls | back-to-back | two tool-call deltas with distinct ids |
| malformed XML | `<tool_call>…` never closes | passthrough as text; no orphan tool-call delta |
| usage chunk | upstream final `usage` chunk | passthrough untouched |
| client abort mid-stream | abort signal fires after N deltas | clean teardown, no thrown |

**Pass 2 (after split):** with `tool-call-stream/` split into `accumulator.ts` + `emit.ts`, port the fixtures into per-file unit tests:

- `accumulator.test.ts` asserts the buffer detects partial tags correctly.
- `emit.test.ts` asserts the OpenAI shape is exact.
- `index.test.ts` becomes a small integration test on top.

### Estimated impact

- **Pass 1:** **+~250 LoC** of tests, +0 source LoC.
- **Pass 2 (after split):** redistribute to ~50 LoC each across three test files.
- Coverage on `tool-call-stream` goes from 0 to high.
- Risk: **none** (test-only).
- Unblocks: the split in [section B](./giant-controller-files.md#10-tool-call-streamts) and CONTROLLER_SCOPE.md's target of `proxy/tool-calls.ts ≈ 300 LoC` (the dead-paths can only be safely deleted with the test net in place).

### Dependencies

- **Must land before** the `tool-call-stream` split.

---

## Other tests already in place (no action required, listed for context)

| Path | Status |
|------|--------|
| `controller/src/modules/proxy/openai-routes.test.ts` | exists |
| `controller/src/modules/engines/routes.test.ts` | exists |
| `controller/src/services/provider-routing.test.ts` | exists |
| `controller/src/modules/system/usage/chat-database.test.ts` | exists (will be deleted with the file — see [type-and-route-orphans.md](./type-and-route-orphans.md#chat-database-orphan)) |
| `controller/src/modules/jobs/routes.test.ts` | exists (may be deleted with the module — see [type-and-route-orphans.md](./type-and-route-orphans.md#jobs-orchestrators)) |

Plus the gap from [type-and-route-orphans.md](./type-and-route-orphans.md#missing-security-middleware-test):

| Path | Status |
|------|--------|
| `controller/src/http/security-middleware.test.ts` | **deleted on this branch — restore.** |

---

## Summary

| Item | LoC delta (test) | Risk | Unlocks |
|------|-----------------:|------|---------|
| CLI `X-API-Key` coverage | +~40 | None | safer CLI refactors |
| `tool-call-stream` Pass 1 (e2e) | +~250 | None | the split in section B |
| `tool-call-stream` Pass 2 (per-file unit) | redistribute existing | None | dead-path deletion in CONTROLLER_SCOPE.md Phase 3 |
| `security-middleware` restore (cross-listed in section D) | +~120 | Low | confidence in middleware contract |
| **Total new test code** | **+~410** | | |
