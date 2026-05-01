# Chapter 3 — CLI

## TL;DR

The CLI is **largely untouched** in `feat/plop-t3code-with-pi`. Only one functional change landed:

- `cli/src/api.ts` — forward `VLLM_STUDIO_API_KEY` as an `X-API-Key` request header.

A second one-line edit in `cli/src/types.ts` is purely a follow-on: the import path moved from `../../shared/src` to `../../controller/src/modules/shared/recipe-types` because the standalone `shared/` workspace was deleted in commit `0bba921c feat: purge chat module entirely`.

The CLI continues to talk to the controller via plain REST against `http://localhost:8080`. It does **not** consume the new `engineService` SSE event stream that the controller and frontend now share.

## Diff scope

| File | +/− | Nature |
|---|---|---|
| `cli/src/api.ts` | +9 / −1 | Functional — adds API-key header forwarding to `requestJson` |
| `cli/src/types.ts` | +1 / −1 | Mechanical — repoints `shared` import after `shared/` purge |

Diff command for reproduction:

```bash
git diff origin/main...HEAD -- cli/
git log --oneline origin/main..HEAD -- cli/
# 23662112 micro: cli — forward VLLM_STUDIO_API_KEY as X-API-Key header
# 0bba921c feat: purge chat module entirely
```

The bulk-purge commit `0bba921c` sweeps `cli/types.ts` along for the ride; only the API-key commit is a deliberate CLI change.

## CLI workspace at a glance

The CLI is its own Bun workspace under `cli/`:

| Path | Purpose |
|---|---|
| `cli/src/main.ts` | Entry point. Routes to TUI or headless mode based on `argv` length. |
| `cli/src/api.ts` | Thin REST client — `fetchGPUs`, `fetchRecipes`, `fetchStatus`, `fetchConfig`, `fetchLifetimeMetrics`, `launchRecipe`, `evictModel`. |
| `cli/src/headless.ts` | Command-line dispatch table (`status`, `gpus`, `recipes`, `config`, `metrics`, `launch`, `evict`, `help`). |
| `cli/src/render.ts` | TUI render loop — header tabs, footer hint, dispatches to per-view renderers. |
| `cli/src/views/dashboard.ts` | Dashboard view (GPU + status + lifetime metrics). |
| `cli/src/views/recipes.ts` | Recipe list + selection. |
| `cli/src/views/status.ts` | Engine status view. |
| `cli/src/views/config.ts` | Config view. |
| `cli/src/types.ts` | TS shapes shared across views; re-exports `Backend` and `RecipePayload` from controller shared types. |
| `cli/src/ansi.ts` | ANSI helpers (colors, table, byte formatting). |
| `cli/src/input.ts` | Raw-mode keypress handling. |
| `cli/src/api.test.ts` | Vitest coverage for `api.ts` (only test file in the workspace). |
| `cli/package.json` | Bun workspace manifest — own deps, own scripts, builds via `bun build --compile`. |
| `cli/bun.lock` | Lockfile, **untouched** in this PR. |
| `cli/vllm-studio` | **60 MB precompiled binary committed to the repo** — see `gaps.md` and Chapter 7. |

## Reading order for this chapter

1. **what-changed.md** — line-by-line diff walk-through.
2. **architecture-overview.md** — orientation for readers who've never opened `cli/`.
3. **gaps.md** — what the PR did not update in the CLI but probably should have, plus pointers to Chapter 7 (concerns) and Chapter 8 (merge opportunities).

## Repo-on-disk note

```text
$ ls -la cli/vllm-studio
-rwxr-xr-x  1 sero  staff  60308320 Apr 30 05:57 cli/vllm-studio
```

A 60 MB binary in source control. It is `.gitignore`-able (it's the `bun build --compile` output of `src/main.ts`). Flagged for Chapter 7.
