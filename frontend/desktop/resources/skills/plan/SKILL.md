---
name: plan
description: Shared task plan between the human and the model in Local Studio. Use it to maintain a Cursor-style checklist for any multi-step task so the human can watch progress live in the Plan panel. Always use the plan tools for this instead of writing a plan to a Markdown file in the workspace.
---

# Plan

The plan is a single Markdown checklist that the user sees and can edit live in the right-hand "Plan" panel of Local Studio. It is **shared** state: anything you write is rendered immediately as a checklist, and status the user toggles in the panel is visible to you on your next read.

Two tools are available:

- `plan_read` - Returns the full current plan Markdown.
- `plan_write` - **Replaces** the entire plan with the Markdown you provide.

## Format

The plan is a `### To-dos` heading followed by checkbox lines. The checkbox mark encodes status:

- `- [ ]` pending
- `- [/]` in progress
- `- [x]` completed
- `- [-]` cancelled

Example:

```
### To-dos
- [x] Read the controller auth flow
- [/] Add the JwtService
- [ ] Swap session middleware for JWT middleware
- [ ] Update integration tests
```

## When to use it

Use the plan for any task that takes more than a couple of steps, or whenever the user asks you to "make a plan", "set a plan", "plan out", or "track" work. This is the **canonical** place for a plan.

- **Do not** write the plan to a Markdown file in the workspace (e.g. `PLAN.md`, `REVIEW.md`). Use `plan_write` so it appears in the Plan panel.
- Keep exactly **one** item `in progress` at a time.
- Mark an item `completed` only after you have actually finished and verified it.
- Keep items short, concrete, and actionable (one line each).

## Usage protocol

1. **Read first.** At the start of a multi-step task, call `plan_read` once to pick up any plan the user or a previous turn left.
2. **Write the plan early.** Once you understand the task, call `plan_write` with the full `### To-dos` checklist before doing the work.
3. **Keep it current.** As you start and finish steps, call `plan_write` again with the updated marks. Always send the complete document (the tool replaces the whole plan).
4. **Don't clobber user edits.** If `plan_read` shows the user changed items, preserve their intent when you rewrite.

Keep the plan tight. It is a live checklist for the user, not a log.
