# CLI Gaps

What this PR did **not** update in the CLI but arguably should have, plus pointers to later chapters.

## 1. CLI does not consume the new SSE event stream

The rest of the PR introduces an `engineService` SSE channel that the controller emits and the frontend consumes for live status updates. The CLI is left out:

- `cli/src/main.ts` still uses `setInterval(refresh, 2000)` for both the dashboard and status view.
- `cli/src/api.ts` has zero SSE plumbing — no `EventSource`, no streaming `fetch` reader, no event handler registry.
- The TUI's status view will lag the truth by up to 2 seconds, and during a launch the user sees stale data until the next poll tick.

For interactive use this is annoying. For headless `vllm-studio status` it is fine (one-shot snapshot, then exit), so a partial migration is plausible: keep headless polling, give TUI mode an SSE consumer.

## 2. `headless.ts` did not gain agent-related commands

The PR introduces an "agent surface" elsewhere in the codebase. Within the CLI:

- `cli/src/headless.ts` still ships only `status | gpus | recipes | config | metrics | launch | evict | help`.
- The agent surface is currently a frontend-only concern (lives at `http://localhost:3001/agent` per `AGENTS.md`).
- The CLI's `launchRecipe` continues to call `POST /launch/:id` against the controller and works unchanged — the agent layer is parallel to recipe launching, not a replacement.

This is not necessarily a defect — it could be deliberate scoping — but if the agent surface is meant to be a first-class workflow, the CLI should probably gain an `agent` subcommand. Flagging for product/scope review, not as a code defect.

## 3. API key is undocumented in CLI surfaces

`VLLM_STUDIO_API_KEY` is now read by `cli/src/api.ts` but:

- `cli/README.md` "Configuration" section lists only `VLLM_STUDIO_URL`.
- `cli/src/headless.ts` `help` command "Environment" section lists only `VLLM_STUDIO_URL`.
- No test in `cli/src/api.test.ts` asserts the header is sent, omitted, or trimmed correctly.

Low-effort follow-up. See "Suggested follow-ups" below.

## 4. CLI has its own dependency closure (untouched)

| Concern | State |
|---|---|
| `cli/bun.lock` | Untouched in this PR. No version bumps, no new deps. |
| `cli/node_modules` | Independent of the root install. |
| `cli/package.json` `devDependencies` | Includes its own copies of `eslint`, `typescript`, `vitest`, `husky`, `knip`, `jscpd`, `depcheck`, `@typescript-eslint/*`. These are duplicated with root and/or `controller/` tooling. |

The PR neither cleans this up nor makes it worse. It's a standing condition and a candidate for Chapter 8 (merge opportunities) — see below.

## 5. Cross-workspace type coupling now goes through a relative path

Before this PR:

```ts
import type { Backend, RecipePayload } from "../../shared/src";
```

After:

```ts
import type { Backend, RecipePayload } from "../../controller/src/modules/shared/recipe-types";
```

The CLI now reaches across a workspace boundary into controller internals via a deep relative path. This is brittle: any move within `controller/src/modules/shared/` will silently break the CLI's typecheck.

**Hand-off to Chapter 8 (merge opportunities):** the natural fix is to give `controller/src/modules/shared/` either a barrel `index.ts` with a stable public surface, or to expose it as a workspace package (e.g. `@vllm-studio/shared-types`) that both `cli/` and `controller/` import. Tracking there.

## 6. Committed 60 MB binary

```text
$ ls -la cli/vllm-studio
-rwxr-xr-x  1 sero  staff  60308320 Apr 30 05:57 cli/vllm-studio
```

`cli/vllm-studio` is the output of `bun build src/main.ts --compile --outfile vllm-studio`. It is committed to the repo. Its presence is a known smell:

- It bloats every clone.
- Every time someone runs `bun run build`, the working tree changes by ~60 MB and they may accidentally commit a new copy.
- `cli/.depcheckrc.json`, `cli/eslint.config.mjs`, `cli/knip.ts`, and `cli/.jscpd.json` all explicitly ignore the file, which is evidence that the team has bumped into it repeatedly.
- `cli/.gitignore` exists but apparently does not list `vllm-studio`.

**Hand-off to Chapter 7 (files to improve):** add `vllm-studio` to `cli/.gitignore`, remove from history (or at minimum from the working tree on `feat/plop-t3code-with-pi`), and produce the binary via CI/release rather than committing it.

## Suggested follow-ups (cheap)

| Item | File | Effort |
|---|---|---|
| Document `VLLM_STUDIO_API_KEY` | `cli/README.md` | trivial |
| List `VLLM_STUDIO_API_KEY` in help | `cli/src/headless.ts` | trivial |
| Test that `X-API-Key` is sent / omitted / trimmed | `cli/src/api.test.ts` | small |
| Cache `resolveApiKey()` in the headers spread | `cli/src/api.ts` | cosmetic |
| Add `vllm-studio` to `cli/.gitignore` and stop tracking it | `cli/.gitignore`, working tree | small |

## What this PR does **not** break in the CLI

For balance:

- All existing `requestJson` callers continue to work; the new header is purely additive when the env var is set.
- All headless commands still exit with the documented codes.
- The TUI keybindings, refresh cadence, and view layouts are untouched.
- Tests in `cli/src/api.test.ts` still pass without modification because they don't set `VLLM_STUDIO_API_KEY` and `resolveApiKey()` returns `undefined`, so the spread contributes no header.

The CLI's role in this PR is, essentially: pick up the API-key contract that the controller is about to enforce, and otherwise stay out of the way.
