# 9 — Jobs module survival

> **Severity:** Medium
> **Cross-link:** [Chapter 2 — studio/audio/jobs modules](../chapter-02-controller/studio-audio-jobs-modules.md)

## Verified files (all in `controller/src/modules/jobs/`)

```
176 job-manager.ts
125 workflows/voice-assistant-turn.ts
 80 auto-orchestrator.ts
 66 routes.ts
 63 routes.test.ts
 54 memory-orchestrator.ts
 25 orchestrator.ts
 20 configs.ts
  7 types.ts
  6 index.ts
  1 workflows/index.ts
---
623 LoC total across 11 files
```

## Why it's complex

`CONTROLLER_SCOPE.md` explicitly flags this module as out-of-scope:

> **Three overlapping "orchestrators"** in `jobs/` (`auto-orchestrator`,
> `memory-orchestrator`, `orchestrator`) — none have a single clear
> purpose. `workflows/` contains one file.

> **Gone:**
> - `modules/jobs/` (three orchestrators + workflows) — replace with a
>   single 80-line "background task" helper inside the caller that needs
>   it, or cut entirely.

The phase plan in `CONTROLLER_SCOPE.md` is "Phase 1 — Prune" → delete this
tree. The plan was published, the engines / system / models / chat /
proxy phases all landed, and **`jobs/` survived all of them**.

Three nominally orchestrating files coexist:

- `auto-orchestrator.ts` (80 LoC)
- `memory-orchestrator.ts` (54 LoC)
- `orchestrator.ts` (25 LoC)

Plus `job-manager.ts` (176 LoC) and a single workflow
(`workflows/voice-assistant-turn.ts`, 125 LoC). No two of those file names
tell you which one is "the entry point". The entry point is wired in
`app-context.ts`:

```ts
const jobManager = new JobManager(baseContext as AppContext, jobStore);
```

…and in `http/app.ts`:

```ts
registerJobsRoutes(app, context, context.jobManager);
```

## Why it costs reading time

A new contributor reading the controller will:

1. See `jobs/` next to `engines/`, `system/`, `models/`, `proxy/`.
2. Reasonably assume it's a peer domain.
3. Read `CONTROLLER_SCOPE.md` and learn it's slated for removal.
4. Check `MIGRATION.md` — every phase is `🟢 done`.
5. Have to figure out from git history whether (a) the cull just hasn't
   been started yet, (b) it was started and reverted, or (c) the scope
   document is aspirational and `jobs/` actually intends to stay.

The route handler `controller/src/modules/jobs/routes.ts` (66 LoC) is
still wired into `http/app.ts`, so the surface is reachable. There is no
deprecation banner, no `// scheduled for removal` comment, and
`MIGRATION.md`'s phase tracker only lists phases 1–5 (none of which target
`jobs/`).

## The voice-assistant workflow

`workflows/voice-assistant-turn.ts` (125 LoC) is the **single workflow**
referenced by the orchestrators. The audio module
(`controller/src/modules/audio/routes.ts`, 410 LoC) is also flagged in
`CONTROLLER_SCOPE.md` as "move to a separate service if needed". So:

- jobs → orchestrates → voice-assistant-turn → calls audio
- All three modules are flagged for removal.
- All three are still here and still wired.

That's a coupled-deprecation cluster: removing any one of them requires
a coordinated edit across the others.

## What could simplify it

- Decide whether jobs/ stays or goes. If it goes, replace the cross-module
  imports with a tiny helper inside the one caller that actually needs
  background work.
- If jobs/ stays, collapse the three orchestrator files into one and
  document its purpose in a top-of-file docstring.
- Treat `audio/` and `jobs/voice-assistant-turn.ts` as one decision: the
  workflow exists only to drive audio.
- Update `CONTROLLER_SCOPE.md` with a status column — "scheduled" is not
  the same as "done", and readers cannot distinguish them today.
