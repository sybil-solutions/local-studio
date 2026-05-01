# Annotated commit log

68 entries (one is the merge of `origin/main`). Most-recent-first.

The branch name `feat/plop-t3code-with-pi` and the commit messages encode the intent: take a t3code-shaped UI ("plop"), wire it to a `pi`-backed agent runtime, delete the legacy chat module.

## Phases visible in the log

Reading bottom-up, the commits cluster into 5 visible phases:

| Phase | Commits | Theme |
|---|---|---|
| **0. Scope-and-plan** | `5c92e387` | Design docs (`scope.md`) |
| **1. Controller refactor** | `66e40ee7`, `f882cf04`, `9dc914de`, `23f277a4` | Phases 1–5 of MIGRATION.md |
| **2. Plop the new agent surface** | `0bba921c` (purge), `96942692` (add pi-backed t3 agent surface), `ec1bdaa7`, `bad5d1b6`, `3bd636ec`, `d164aabd` | Replace chat with agent UI |
| **3. Feature build-out** | `5ee61d70`, `c5c6894e`, `00326fb6`, `e79f8caf`, `f5f012fa`, `908c2745`, `dac05e1c`, `c768f1eb`, `365eac90` | Sessions sidebar, browser tool, filesystem panel, multi-pane, project picker, terminal drawer, polished aesthetics, markdown rendering |
| **4. Micro-polish (50+ commits)** | `23662112` through `7e40ffd9` and many others | Per-turn microcommits enforced by `frontend/AGENTS.md` |

## Most-recent (top of branch)

| # | SHA | Title |
|---|---|---|
| 1 | 7e40ffd9 | micro: refine agent session UI (HEAD) |
| 2 | 1bbdef10 | micro: add solid agent icon set |
| 3 | f6c0ef2d | Merge origin/main into feat/plop-t3code-with-pi |
| 4 | 002540bd | micro: render file previews |
| 5 | 9badd86a | micro: improve agent browser navigation |
| 6 | 5ed78fa6 | micro: keep agent sessions visible |
| 7 | 04fbeb73 | micro: add pi session usage aggregation |
| 8 | ef79c5cd | micro: replay pi session messages |
| 9 | aba3f01d | micro: raise pi local model output budget |
| 10 | e30a97a9 | micro: surface running indicator + separate messages + expand thinking |

## Notable inflection points

| SHA | Title | Why it matters |
|---|---|---|
| `5c92e387` | docs: comprehensive scope doc for Pi agent integration | Sets the design target |
| `66e40ee7` | refactor: migrate engines module | Phase 1 of MIGRATION.md |
| `f882cf04` | refactor: complete Phase 2 — system/ module | Phase 2 |
| `9dc914de` | refactor: complete Phase 3 — models/ absorbs lifecycle/recipes | Phase 3 |
| `23f277a4` | refactor: split proxy tool-call parsing | Phase 5 |
| `0bba921c` | feat: purge chat module entirely | The moment chat dies |
| `96942692` | micro: add pi-backed t3 agent surface | The moment the new surface lands |
| `f5f012fa` | feat: project picker — ported from t3code | t3code lineage made explicit |
| `3df8d7e1` → `671e3b18` | feat: real PTY terminal → chore: remove it | A feature added then reverted (sub-day cycle) |
| `c5c6894e` | feat(agent): browser tool — navigate, read, click, scroll, fill | The browser bridge debuts |
| `e79f8caf` | feat(agent): multiplex — split panes + per-pane tabs | Multi-pane lands |
| `0bba921c` | feat: purge chat module entirely | Single-commit removal of the legacy chat |
| `a55577f3` | micro: remove engine lifecycle FSM | An FSM was added then removed |

## Reverts and oscillations

- **PTY terminal** added in `3df8d7e1` and removed in `671e3b18`. Implementation pulled `xterm.js` + `node-pty` + `ws`, then dropped them. (Documented in chapters 4/7.)
- **Engine lifecycle FSM** added then removed (`a55577f3`).
- **`micro: route dashboard lifecycle through hook`** (`2a2b085b`) — implies a previous direct dispatch.

These oscillations suggest the agent surface is still actively converging on a stable shape; reviewers should expect more churn.

## Microcommit hygiene

46 of the 67 non-merge commits use the `micro:` prefix per `frontend/AGENTS.md`. See pattern doc: [microcommits](../chapter-05-patterns/microcommits.md).
