# 8 — Dead-shape leftovers

> **Severity:** Medium
> **Cross-link:** [Chapter 2 — deletions inventory](../chapter-02-controller/deletions-inventory.md), [Chapter 2 — modifications inventory](../chapter-02-controller/modifications-inventory.md)

Three artefacts on this branch are silent reminders that a deletion was
incomplete. None is a bug today; each is an attractive nuisance that will
mislead a reader.

## 1. `controller/src/types/chat.ts` (126 LoC)

The chat module under `controller/src/modules/chat/` was deleted in this PR
(Phase 4 of `MIGRATION.md`). The 56 files of run-manager / tool-registry /
message-mapper / system-prompt-builder are gone.

But `controller/src/types/chat.ts` survives, complete with:

```ts
// CRITICAL
/**
 * Chat/session DTOs.
 *
 * These types are intentionally shaped to match the controller's existing JSON payloads
 * (including snake_case keys coming from SQLite). They extend `Record<string, unknown>`
 * so legacy call sites that still treat these as generic records remain compatible…
 */
export type ChatSessionListItem = ...;
export type ChatSessionSummary = ...;
```

The `// CRITICAL` comment is the most informative part of the file — it
warns the reader to be careful around shapes that, in fact, no live code
writes anymore. The types **are** read (by `chat-database.ts` — see [#7
usage-metrics-fragmentation](./usage-metrics-fragmentation.md)) — but only
to interpret historical SQLite rows.

### Why it's complex

A reader who edits `chat-database.ts` and notices `ChatSessionSummary`
imports will reasonably expect that type to be live. They have to read the
deletions inventory, then `MIGRATION.md`'s Phase 4 entry, then check git
history, to learn that the chat module was deleted entirely. The `//
CRITICAL` comment makes the trap worse.

## 2. `DEFAULT_CHAT_PROVIDER = "openai"`

```
controller/src/services/provider-routing.ts:4
```

```ts
export const DEFAULT_CHAT_PROVIDER = "openai";
```

This is the default provider used by the proxy when no `provider:model`
prefix is present in the request body. On `origin/main` the value was
`"local"` — meaning unmarked requests went to the local inference server.
This branch flips it to `"openai"` — meaning unmarked requests go to the
upstream OpenAI provider configured in the studio settings.

### Why it's complex

It's a one-line, four-character change with **no associated UI banner, no
migration log, no comment explaining the flip**. A reviewer scanning the
file diff sees `"local" → "openai"` and may not realise the cascading
behaviour:

- `openai-routes.ts:215, 218, 231` switch on this constant.
- An unmarked model id that previously routed to the on-host vLLM now
  routes to OpenAI — using whatever API key the user configured for that
  provider, billing their account.
- Any client that was sending bare model ids (e.g., `Llama-3.1-8B`) now
  fails because OpenAI doesn't know that model.

The `provider-routing.test.ts` file was updated to match the new default,
which means the tests pass and CI is green — but the behaviour change is
not gated by a config flag.

## 3. Deleted `http/security-middleware.test.ts`

```
controller/src/http/security-middleware.ts        (still present)
controller/src/http/security-middleware.test.ts   (deleted)
```

The implementation file is preserved; the test file is gone. Chapter 2's
deletions inventory flags this:

> `controller/src/http/security-middleware.test.ts` (the implementation
> remains; the test file was deleted).

### Why it's complex

A test file rarely deserves to be deleted while its implementation lives.
Possible reasons:

- The test was flaky and someone decided to silence it. (Bad — the next
  edit to `security-middleware.ts` is unverified.)
- The middleware itself is no longer wired into `http/app.ts`. (Worse — a
  dead implementation that imports look live in routes.)
- The test referenced fixtures that moved with the chat-module deletion.
  (Plausible, but in that case the fix is to update the test, not delete
  it.)

Combined with the deletion of `.factory/threat-model.md` and
`.factory/security-config.json` (see [#12](./security-posture-gaps.md)),
this is a **pattern of security tests/docs being removed** without a
replacement.

## What could simplify it

- Delete `controller/src/types/chat.ts` and inline its two types into
  `chat-database.ts` as private types. The `// CRITICAL` comment goes
  with it.
- Either revert `DEFAULT_CHAT_PROVIDER` to `"local"`, or add an explicit
  comment + UI surface explaining that bare model ids now bill against
  OpenAI.
- Restore `security-middleware.test.ts` — or, if the middleware itself is
  no longer needed, delete the implementation in the same commit.
