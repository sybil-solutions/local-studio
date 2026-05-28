---
name: canvas
description: Shared scratchboard between the human and the model in vLLM Studio. Use it to read the human's running notes/plan and to record concise, durable state (plans, decisions, open questions, links, important values) that should survive across turns and be visible to both sides.
---

# Canvas

The canvas is a single plain-text document that the user can see and edit live in the right-hand "Canvas" panel of vLLM Studio. It is **shared** state: anything you write into it is immediately rendered to the user, and anything the user types into it is visible to you on your next read.

This skill is loaded **only when the user has explicitly turned the Canvas toggle ON** in the composer (the `</>` icon next to the browser globe). When this skill is loaded, the following tools are available:

- `canvas_read` — Returns the full current canvas text.
- `canvas_write` — **Replaces** the entire canvas with the text you provide.
- `canvas_append` — Appends a short note to the bottom of the existing canvas (separated by a blank line). Prefer this over `canvas_write` for incremental updates so you don't accidentally clobber the user's edits.

## When to use it

Use the canvas when state should outlive the current message **and** benefit from being visible to the user. Good examples:

- A short, evolving **plan / checklist** for a multi-step task ("1. read X, 2. patch Y, 3. run tests").
- **Decisions and constraints** the user has confirmed ("DB schema is frozen; do not migrate").
- **Open questions** you still need answered.
- **Important values** discovered mid-task (file paths, IDs, URLs, ports, env vars) that you'll need to re-quote later.
- A **summary** at the end of a complex turn so the next turn (or the user) can resume quickly.

## When NOT to use it

- Don't dump verbose tool output, full file contents, or transcripts into the canvas. It is a scratchboard, not a log — keep it tight (<~2KB is a good target).
- Don't use the canvas for ephemeral per-turn reasoning. Use your normal thinking/response stream for that.
- Don't write secrets, credentials, or anything the user hasn't already shared in chat.

## Usage protocol

1. **Read first.** At the start of a non-trivial turn, call `canvas_read` once to pick up any notes the user (or a previous turn) left there. Treat the canvas as additional context.
2. **Append, don't clobber.** Prefer `canvas_append` for incremental updates. Reserve `canvas_write` for cases where you are intentionally rewriting the canvas (e.g., replacing a stale plan with a refreshed one — and in that case, preserve anything the user clearly authored).
3. **Be concise and structured.** Use short markdown bullet lists or labelled lines (`Plan:`, `Decisions:`, `Open Qs:`). The user is reading this in real time.
4. **Mirror, don't duplicate.** Don't repeat your full chat reply in the canvas. The canvas should capture only what's worth remembering across turns.
5. **Per-session.** The canvas is scoped to the currently focused vLLM Studio session. If the user opens or switches sessions, the canvas you see will switch with them — that's expected.

## Quick example

User says: "Help me migrate the auth service to JWT. Use the canvas to track the plan."

Reasonable canvas content after the first turn:

```
Plan: migrate auth → JWT
- [x] read current session-cookie flow in controller/src/auth
- [ ] add JwtService (HS256, 1h TTL, refresh token rotation)
- [ ] swap session middleware for jwt middleware in routes/*
- [ ] migrate frontend to store token in httpOnly cookie
- [ ] update integration tests

Decisions:
- Algorithm: HS256 (per user)
- Secret in env: AUTH_JWT_SECRET (not committed)

Open Qs:
- Refresh token storage on the client?
```

Keep it that compact. The canvas is a teammate's whiteboard, not a logfile.
