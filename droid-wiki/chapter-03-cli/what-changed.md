# What Changed in the CLI

Total CLI diff in `feat/plop-t3code-with-pi` vs `origin/main`:

```text
 cli/src/api.ts   | 9 ++++++++-
 cli/src/types.ts | 2 +-
 2 files changed, 9 insertions(+), 2 deletions(-)
```

That's it. Two files, ten lines.

## 1. `cli/src/api.ts` — API key header forwarding

Commit: `23662112 micro: cli — forward VLLM_STUDIO_API_KEY as X-API-Key header`

### The diff

```diff
+function resolveApiKey(): string | undefined {
+  return process.env.VLLM_STUDIO_API_KEY?.trim() || undefined;
+}
@@
   response = await fetch(url, {
     method,
-    headers: options.body ? { "Content-Type": "application/json" } : {},
+    headers: {
+      ...(options.body ? { "Content-Type": "application/json" } : {}),
+      ...(resolveApiKey() ? { "X-API-Key": resolveApiKey() } : {}),
+    },
     body: options.body ? JSON.stringify(options.body) : undefined,
   });
```

### What it does

`requestJson` is the single fetch wrapper used by every CLI API call. After this change, every request includes `X-API-Key: <value>` whenever `VLLM_STUDIO_API_KEY` is set in the CLI's environment. When unset, the header is omitted (no empty header, no `undefined` literal).

### What it does NOT do

| Concern | State |
|---|---|
| README documentation | **Not updated.** `cli/README.md` only lists `VLLM_STUDIO_URL` under "Configuration". `VLLM_STUDIO_API_KEY` is undocumented. |
| `headless.ts` help text | **Not updated.** The `help` command still lists only `VLLM_STUDIO_URL` under "Environment". |
| Test coverage | **Not added.** `cli/src/api.test.ts` does not assert that the header is sent (or omitted) based on the env var. The existing tests continue to pass because the new `resolveApiKey()` short-circuits to `undefined` when the env var is absent. |
| `resolveApiKey()` is called twice | Minor: in the spread expression it runs twice in a row. Functionally fine; cosmetically a single `const apiKey = resolveApiKey();` would have been cleaner. |

### Existing API surface (unchanged)

For reference, `cli/src/api.ts` exposes the following functions, all of which now carry the `X-API-Key` header automatically:

| Function | Method | Path | Returns |
|---|---|---|---|
| `fetchGPUs()` | GET | `/gpus` | `GPU[]` (normalized via `toFiniteNumber`) |
| `fetchRecipes()` | GET | `/recipes` | `Recipe[]` (raw array, no per-field validation) |
| `fetchStatus()` | GET | `/status` | `Status` (flattened from `{ running, launching, process: { ... } }`) |
| `fetchConfig()` | GET | `/config` | `Config` (extracted from `{ config: {...} }` envelope) |
| `fetchLifetimeMetrics()` | GET | `/lifetime-metrics` | `LifetimeMetrics` (renames `tokens_total → total_tokens` etc.) |
| `launchRecipe(id)` | POST | `/launch/:id` | `boolean` (uses `success` field if present, else `true`) |
| `evictModel()` | POST | `/evict` | `boolean` (same convention as launch) |

All of them go through `requestJson`, which is the only place that knows about the base URL (`VLLM_STUDIO_URL`, default `http://localhost:8080`) and now the API key.

### Error handling, unchanged

`CliApiError` carries `method`, `path`, and an optional `status`. `parseBody` first reads as text (handles empty bodies cleanly), then tries `JSON.parse`. `extractErrorMessage` drills `detail → error → message` from the body, falling back to `<status> <statusText>`. None of this changed.

## 2. `cli/src/types.ts` — Import path repointing

Commit: rolled in with `0bba921c feat: purge chat module entirely`

### The diff

```diff
-import type { Backend as SharedBackend, RecipePayload } from "../../shared/src";
+import type { Backend as SharedBackend, RecipePayload } from "../../controller/src/modules/shared/recipe-types";
```

### Why

The standalone `shared/` workspace was deleted in this PR. Eight files removed:

```text
shared/README.md                |   8 --
shared/src/agent.ts             |  10 ---
shared/src/controller-events.ts | 177 ----------------------------------------
shared/src/downloads.ts         |  34 --------
shared/src/index.ts             |  51 ------------
shared/src/recipe.ts            |  49 -----------
shared/src/state-machine.ts     |  45 ----------
shared/src/system.ts            | 121 ---------------------------
```

The CLI was the last consumer of the cross-package barrel `shared/src`. The two type imports it actually needed (`Backend`, `RecipePayload`) were re-homed inside the controller at `controller/src/modules/shared/recipe-types.ts`, and the import was repointed accordingly.

### What this means structurally

- The CLI now reaches **into the controller's source tree** with a relative path. `cli/` is a sibling Bun workspace; this creates a soft cross-workspace coupling that the old `shared/` package abstracted away.
- It still typechecks because both workspaces use TypeScript with `moduleResolution: "bundler"` and the path resolves on disk, but it is brittle: any restructuring inside `controller/src/modules/shared/` will break the CLI's typecheck.
- See `gaps.md` for the merge-opportunity angle, which we hand off to Chapter 8.

## What's notably missing from the CLI diff

- **No new commands.** `headless.ts` did not gain an `agent` or `events` subcommand despite the agent surface and SSE events being central to the rest of the PR.
- **No SSE consumer.** The CLI still polls every 2s in `main.ts` (`setInterval(refresh, 2000)`).
- **No bun.lock changes.** No new dependencies, no version bumps. The CLI's dep graph is unchanged.
