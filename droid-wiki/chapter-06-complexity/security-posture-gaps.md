# 12 — Security posture gaps

> **Severity:** Medium
> **Cross-link:** [Chapter 4 — factory-config-removal](../chapter-04-anything-else/factory-config-removal.md), [Chapter 2 — deletions inventory](../chapter-02-controller/deletions-inventory.md)

## What was lost

This PR deletes three security-relevant files:

| Path | Lines | What it was |
|------|------:|-------------|
| `.factory/threat-model.md` | ~600 | STRIDE threat model with auth/CORS findings |
| `.factory/security-config.json` | 23 | Scanner thresholds + enabled patterns |
| `controller/src/http/security-middleware.test.ts` | ~? | The test for the still-present middleware |

The `security-middleware.ts` implementation is preserved in
`controller/src/http/`. The test for it is gone.

## Why this matters as complexity

Security artefacts are inventory of concerns. Deleting them does not
delete the underlying concerns — it deletes the documentation that flagged
them. The threat model called out three properties of the controller that
are still true today:

> Authentication is largely optional and route-specific. There is no global
> controller middleware enforcing API key/session authorization in
> `controller/src/http/app.ts`; CORS allows all origins (`origin: "*"`).

> Authorization checks for object ownership/role boundaries are generally
> absent for mutable resources (chat sessions, files, recipes, and runtime
> upgrades).

> SSE streams are authenticated via the same route-level checks (where
> present) and otherwise inherit the global posture.

These findings remain valid for the post-PR controller. The frontend's
`/api/agent/*` routes inherit the same posture: in dev they listen on
`localhost:3001` and have **no authentication on the bridge to the pi
child**. Anything that can POST to `/api/agent/turn` can spawn a pi process
and hand it a `cwd` of its choosing.

## The compounding effect

The deleted artefacts referenced (now-stale) paths like
`controller/src/modules/lifecycle/` and `controller/src/modules/chat/`
that no longer exist. So the documents *would have been* outdated when
the engines/system/models/chat/proxy refactor landed. There are two
separate problems:

1. The threat model was outdated.
2. The findings inside it were not all stale.

The PR addresses (1) by deletion. It does not address (2). A reviewer
who looks at `feat/plop-t3code-with-pi` and asks "what's the auth model
for `/api/agent/turn`?" will find no answer in the repo.

## Test deletion compounds the loss

The deletion of `http/security-middleware.test.ts` while the
implementation lives means:

- The next change to `security-middleware.ts` ships unverified.
- A reader who finds the implementation cannot easily learn what it was
  *meant* to enforce.
- The middleware itself may be unwired — the existence of an
  implementation does not imply it is registered. A reviewer must trace
  `http/app.ts` to find out.

## Coupling diagram

```mermaid
graph LR
  TM[".factory/threat-model.md<br/>600 LoC<br/>DELETED"]
  SC[".factory/security-config.json<br/>23 LoC<br/>DELETED"]
  ST["http/security-middleware.test.ts<br/>DELETED"]
  IMPL["http/security-middleware.ts<br/>PRESERVED"]
  TM -->|enumerated| Findings[auth-optional, CORS *, SSE inherits]
  SC -->|enumerated| Patterns[sql_injection, xss, command_injection, ...]
  ST -->|verified| IMPL
  Findings -.still true on this branch.-> AgentRoutes[/api/agent/* in frontend]
  Findings -.still true on this branch.-> ControllerRoutes[/v1/* /studio/* /jobs in controller]
```

## What could simplify it

- Re-state the auth/CORS posture in a short README under `controller/`
  and one under `frontend/src/app/api/`. The threat model can be deleted;
  the findings cannot be — they need a short living home.
- Restore the security-middleware test or delete the implementation. A
  preserved, untested middleware module is a maintenance trap.
- If the local-only deployment story justifies the lax auth posture, say
  so. Today there is no comment in `app-context.ts` or `http/app.ts`
  acknowledging that the controller is single-user / local-network /
  trusted.
