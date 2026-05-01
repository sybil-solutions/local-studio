# Pattern 7 — Microcommit hygiene

The PR is delivered as 67 commits, of which **46 are prefixed `micro:`**.
The convention is codified in two `AGENTS.md` files and enforced by the
agent's per-turn workflow.

## The rule

From `frontend/AGENTS.md` (and the `frontend/desktop/AGENTS.md` addendum):

> **Microcommits (Required)**
>
> - On every agent turn that changes files, create a microcommit before handoff.
> - Keep each microcommit to one logical change (small, auditable diff).
> - Stage only files changed in that turn.
> - If a turn has no file changes, do not create an empty commit.
>
> **Required turn-close flow**
> 1. `git add <files-changed-this-turn>`
> 2. Run pre-commit checks against staged files (`./.husky/pre-commit` or `npx lint-staged`)
> 3. If checks fail, fix issues and rerun checks.
> 4. Commit: `git commit -m "micro: <concise change summary>"`
> 5. Report commit SHA and hook/check output in the handoff.
>
> **Guardrails**
> - Never bypass hooks with `--no-verify`.
> - Never batch unrelated work into one commit.
> - If blocked by failing hooks you cannot safely fix in-turn, stop and report the blocker with logs.

## Where it appears

In the PR's git log:

```
$ git log --oneline origin/main..HEAD | wc -l
67
$ git log --oneline origin/main..HEAD | grep -c '^[0-9a-f]\+ micro:'
46
```

A representative sample:

| SHA | Message |
|-----|---------|
| `7e40ffd9` | micro: refine agent session UI |
| `002540bd` | micro: render file previews |
| `9badd86a` | micro: improve agent browser navigation |
| `5ed78fa6` | micro: keep agent sessions visible |
| `04fbeb73` | micro: add pi session usage aggregation |
| `ef79c5cd` | micro: replay pi session messages |
| `e30a97a9` | micro: surface running indicator + separate messages + expand thinking |
| `88371e55` | micro: scope new session to projects + per-tab pi runtime |
| `970cc32d` | micro: polish model lifecycle dialogs |
| `e0ad6ac2` | micro: harden embedded browser commands |
| `0afa48fa` | micro: refine agent workspace chrome |
| `c6a817d4` | micro: detect privileged process liveness |
| `c2ff828c` | micro: kill privileged inference processes |

The "headline feature" commits are also small (each `feat:` lands a
self-contained slice rather than a sprawling change set):

| SHA | Message |
|-----|---------|
| `e79f8caf` | feat(agent): multiplex — split panes + per-pane tabs |
| `00326fb6` | feat(agent): filesystem panel with file viewer and per-line comments |
| `c5c6894e` | feat(agent): browser tool — agent can navigate, read, click, scroll, fill |
| `5ee61d70` | feat(agent): session history sidebar — list, load, resume via pi --session |
| `f5f012fa` | feat: project picker — open + persist working directories (ported from t3code) |
| `0bba921c` | feat: purge chat module entirely |

## Why this pattern

- **Bisectability.** With 67 small commits, `git bisect` lands on a
  ~5–50 LoC suspect rather than on a 500-LoC blob.
- **Reverts are surgical.** The PTY terminal episode is a clean example
  — `3df8d7e1 feat: real PTY terminal — xterm.js + node-pty` was undone
  by `671e3b18 chore(terminal): remove xterm + node-pty + ws + pty
  routes`. No collateral damage in the revert.
- **Reviewable diffs.** Each `micro:` is small enough to read in one
  pass. The 46 micro commits average less than 100 LoC apiece.
- **Pre-commit gate runs per turn.** The required flow runs lint-staged
  on each commit, so quality drift is bounded by one turn.

## Trade-offs

- **History noise.** A `git log --oneline origin/main..HEAD` is 67 lines
  long for a single PR. Squash-merge into `main` flattens this, but
  reviewing the unsquashed branch requires patience.
- **Commit messages skew terse.** "micro: refine agent session UI" is
  hard to grep for later. The convention works because the diff itself is
  small enough that the commit message doesn't have to carry much weight.
- **Forces an agent-style cadence on humans.** The rule is written for an
  agent's "turn"; humans editing the same branch have to opt in to the
  same rhythm or break the convention.
- **Hooks must always pass.** The "no `--no-verify`" guardrail is sound,
  but means a flaky pre-commit hook stalls the agent's turn. There's no
  carve-out for "I'll fix it in the next commit".

## Cross-references

- [Chapter 1 — index](../chapter-01-frontend/index.md) — the commit-shape callout that motivates this pattern.
- [`frontend/AGENTS.md`](../../frontend/AGENTS.md) — the rule, verbatim.
- [`frontend/desktop/AGENTS.md`](../../frontend/desktop/AGENTS.md) — the desktop addendum that re-affirms the same flow.
- [Chapter 7 — TBD] — pros/cons retention. (Recommendation: keep it.)
