# Getting started with this review

This wiki is a **PR review book**, not a project user guide. Audience: anyone reviewing the merge of `feat/plop-t3code-with-pi` into `main`.

## Read in this order

1. **[Index](index.md)** — total scope (485 files, ±36k LoC).
2. **[Architecture](architecture.md)** — the new three-runtime topology (Electron desktop, Next frontend, Bun controller) plus the external `pi` subprocess.
3. **[Glossary](glossary.md)** — terms used throughout (pi, t3code, EngineService, AgentWorkspace, etc.).
4. **[Reference / diff inventory](../reference/diff-inventory.md)** — counts and where additions/deletions concentrate.
5. **[Reference / commit log](../reference/commit-log.md)** — annotated 67-commit history.
6. **Chapters 1–4** — descriptive (what changed, where, how does it work).
7. **Chapters 5–8** — analytical (patterns, complexity, files to improve, things to merge).

## Reading the descriptive chapters

| Chapter | If you want to understand... |
|---|---|
| 1 — Frontend | The new agent UI (Next.js + Electron) and the deleted chat tree |
| 2 — Controller | The 5-phase Bun-side refactor, deleted chat agent runtime, and the `EngineService` |
| 3 — CLI | The single API-key forwarding change |
| 4 — Anything else | The dissolved `shared/` package, three new design docs, deleted `.factory/` files |

## Reading the analytical chapters

| Chapter | Use it as... |
|---|---|
| 5 — Patterns | A taxonomy of what idioms the PR commits to (state machines, subprocess RPC, layered modules, microcommits) |
| 6 — Complexity | A heatmap of where bugs and review effort will concentrate |
| 7 — Files to improve | A concrete refactor backlog |
| 8 — Things to merge | A consolidation backlog (cross-runtime type duplication, parallel stores, etc.) |

## Verifying claims

Every claim in this wiki cites a repo-relative file path. To reproduce any quoted size or content, run from the repo root:

```bash
git diff --stat origin/main...HEAD                  # totals
git diff --name-status origin/main...HEAD           # file-mode for each path
git log origin/main..HEAD --oneline                 # commit list
git show origin/main:<path>                         # content of a deleted file
wc -l <path>                                        # current size
```

## What this wiki is **not**

- Not a user-facing product manual.
- Not a recommendation to merge or block — just structured findings.
- Not exhaustive on every single line of every diff. The 280+ deleted files are summarized by area, not enumerated line by line.
