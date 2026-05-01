# D — Type & Route Orphans

> Code that survived a refactor by accident. Each item below is small in LoC but each is dead weight that confuses navigation and grep.

---

## `chat-database` orphan

**Path:** `controller/src/modules/system/usage/chat-database.ts`
**Size:** **531 LoC** (verified).

### Symptoms

- Refers to "chat" semantics (sessions, messages, runs, tool executions, agent files) that have been **deleted from the controller** in earlier phases (see [Chapter 2 deletions inventory](../chapter-02-controller/deletions-inventory.md)).
- Per [CONTROLLER_SCOPE.md §6 Phase 1](../../CONTROLLER_SCOPE.md): explicitly listed in the delete set.
- Currently still imported by:
  - `controller/src/modules/system/usage-routes.ts`
  - `controller/src/modules/system/usage/index.ts`
  - and itself + its test file
- The "usage" subset (token counters, cost) overlaps with `LifetimeMetricsStore`.

### Proposed action

Two options, in preference order:

1. **Delete entirely.** Verify with `rg "chatDatabase" controller/` that no business logic depends on writes; the read path goes away. **–531 LoC.**
2. **If usage rollups must survive:** rename to `controller/src/modules/system/usage/usage-database.ts` with a slimmer schema (`session_id, prompt_tokens, completion_tokens, cost, ts`). Trim to ~80 LoC. Migration: rewrite consumer imports, drop the table on next sqlite migration.

Either way, the file at this path goes away.

### Estimated impact

- **–531 LoC** (delete) or **–~450 LoC** (slim + rename).
- Risk: **low** — confirmable by grep + `bun test`.

### Dependencies

- Must scrub `usage-routes.ts` and `usage/index.ts` consumers in the same change.

---

## `types/chat.ts` orphan

**Path:** `controller/src/types/chat.ts`
**Size:** **126 LoC** (verified — earlier estimate "16 lines" undercounted; the file is bigger).

### Symptoms

- File defines `ChatSessionListItem`, `ChatSessionSummary`, `ChatMessage`, `ChatSession`, `ChatUsage`, `ModelPricing`, `ChatRun`, `ChatRunEvent`, `ChatToolExecution`, `ChatAgentFileVersion`, `ChatAgentFileVersionWrite`, `ChatAgentFileRecord`.
- **No importers in `controller/`** — verified with `rg "types/chat" controller/` returning 0 matches.
- Top of file says "CRITICAL" — almost certainly stale annotation from when chat lived in the controller.

### Proposed action

**Delete the file.** If any single type is needed downstream (the dashboard, the frontend), move that type to its actual consumer (e.g. `frontend/src/lib/agent/types.ts`). Do not keep this file as a shared "types pile" — that pattern is what created the orphan.

### Estimated impact

- **–126 LoC.**
- Risk: **none** (file is dead).

### Dependencies

- Should land alongside `chat-database.ts` cleanup so the chat naming goes away coherently.

---

## `provider-routing` default flip

**Path:** `controller/src/services/provider-routing.ts`
**Size:** **105 LoC** (verified).

### Symptoms

- `DEFAULT_CHAT_PROVIDER` is currently `"openai"`. Earlier branches had this as `"local"`.
- The flip changes routing behavior for any caller that submits a model name without an explicit `provider/` prefix — they now go to OpenAI by default, not the local controller.
- The change appears to have been silent (no comment in the file documenting *why* the default flipped, no entry in `MIGRATION.md`).
- Used by:
  - `controller/src/modules/proxy/openai-routes.ts` (the single live consumer)
  - `controller/src/services/provider-routing.test.ts` (covered there)

### Proposed action

Pick one:

- **A) Document.** If the flip is intentional (e.g. dashboard UX assumes external models by default), add a one-line comment near the constant explaining *why* and a paragraph in `MIGRATION.md`.
- **B) Revert.** If it was unintentional (commit message would clarify), set `DEFAULT_CHAT_PROVIDER = "local"`. Add a regression test asserting the default.

This is **not a split** — this is a five-minute decision + a one-line change.

### Estimated impact

- LoC delta: 0–3.
- Risk: **low**, but the consequences of leaving an undocumented routing default are **medium** — a request without an explicit provider may silently hit the wrong upstream.

### Dependencies

- Read the commit that introduced the flip to determine intent.

---

## Missing security-middleware test

**Path:** `controller/src/http/security-middleware.test.ts` — **deleted on this branch.**
**Companion:** `controller/src/http/security-middleware.ts` — **still present** (verified).

### Symptoms

- The middleware is still wired into `http/app.ts` but its test file was removed.
- No replacement test was added.
- Runtime behavior currently unverified beyond manual smoke.

### Proposed action

**Restore the test file.** If the middleware behavior changed since deletion, port the old assertions and add new ones for the new behavior. Test at minimum:

- `Origin` allowlist enforcement (good origin → 200; bad origin → 403).
- `X-API-Key` rejection when configured (no key → 401; bad key → 401; good key → 200).
- Local IPC bypass (loopback request without key → 200, when configured).

### Estimated impact

- **+~120 LoC** of test code.
- Risk: **low** — test-only change.

### Dependencies

- Should land before any other middleware change.

---

## `jobs/` orchestrators

**Path:** `controller/src/modules/jobs/`

### Files

| File | LoC |
|------|----:|
| `auto-orchestrator.ts` | 80 |
| `configs.ts` | 20 |
| `index.ts` | 6 |
| `job-manager.ts` | 176 |
| `memory-orchestrator.ts` | 54 |
| `orchestrator.ts` | 25 |
| `routes.test.ts` | 63 |
| `routes.ts` | 66 |
| `types.ts` | 7 |
| `workflows/index.ts` | (small) |
| `workflows/voice-assistant-turn.ts` | (single workflow) |
| **Total (non-test)** | **~430** |

### Symptoms

- Three "orchestrators" (`auto-orchestrator.ts`, `memory-orchestrator.ts`, `orchestrator.ts`) — none with a single clear purpose.
- One `workflows/` directory with a single workflow (`voice-assistant-turn.ts`).
- Per [CONTROLLER_SCOPE.md §1 + §6 + §7](../../CONTROLLER_SCOPE.md): `jobs/` is in the explicit delete set ("explicitly out of scope — do not bring back without a concrete product need").

### Proposed action

Pick one of:

1. **Delete `jobs/` entirely.** If `voice-assistant-turn.ts` is still wired to a frontend feature, move it inline to its single caller as a 50-line helper. **–~400 LoC.**
2. **If multiple orchestrators are still in use:** collapse into a single `controller/src/modules/jobs/job-runner.ts` (~100 LoC). Delete `auto-orchestrator.ts`, `memory-orchestrator.ts`, `orchestrator.ts`, `workflows/`. **–~300 LoC.**

Verify which case applies by:
- `rg "from.*modules/jobs" controller/` (find external callers).
- `rg "voiceAssistantTurn" controller/ frontend/` (find workflow consumers).

### Estimated impact

- **–300 to –400 LoC.**
- Risk: **low** if zero callers; **medium** if one frontend feature depends on `voice-assistant-turn`.

### Dependencies

- Verify caller graph before deletion.

---

## Summary

| Item | LoC delta | Risk | Owner action |
|------|----------:|------|--------------|
| `chat-database.ts` | **–531** (or –450) | Low | Confirm no live writers; delete or slim |
| `types/chat.ts` | **–126** | None | Delete |
| `provider-routing.ts` default flip | 0–3 | Low | Document or revert |
| `security-middleware.test.ts` | +~120 | Low | Restore tests |
| `jobs/*` orchestrators | **–~300 to –400** | Low/Medium | Delete or collapse |
| **Total source delta** | **–~830 to –~1,030** | | |

This section alone gets the controller close to **1 KLoC of dead-weight removal** before any of the splits in [section B](./giant-controller-files.md).
