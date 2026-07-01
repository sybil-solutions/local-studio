# Engine system refactor + /environments — progress ledger

Autonomous, multi-session initiative (30-min cron loop, unattended). Read this file
first at the start of every iteration; update it before ending each iteration.
Never leave the repo broken — all local gates (`npm run check:static` in
`frontend/`, `bun run typecheck`/tests in `controller/`) must pass before an
iteration ends.

## Origin

User wants two things:
1. A new `/environments` page: create Docker containers for recipes with pinned
   `vllm`/`sglang`/`llama.cpp`/`mlx` versions.
2. Our controller's engine system (`controller/src/modules/engines/*`,
   `controller/src/modules/models/recipes/*`) reworked to be as clean as
   `~/exo-cli` (real path — `~/ai/exo-cli` is a red herring research bundle,
   not a CLI).
3. A full repo-wide code-quality sweep (see "Sweep checklist" below).

## exo-cli reference findings (`/Users/sero/exo-cli`, github 0xSero/exo-spark)

- TS/Bun CLI, ~2000 LOC total across ~30 files, **none over 126 lines**.
- **No Docker anywhere.** Engines are installed into a shared venv (vLLM/SGLang/MLX
  as pinned pip wheels, e.g. `vllm==0.23.0`) or built from source with a pinned
  git branch (llama.cpp: `git clone --branch step3.7 ...`). Only one version
  live at a time per install root.
- Clean `EngineSpec` interface (`src/engines/types.ts`):
  ```ts
  export interface EngineSpec {
    readonly id: EngineId;
    readonly bin: string;
    readonly healthPath: string;
    readonly platforms: readonly NodeJS.Platform[];
    readonly serveCommand: (recipe: ModelRecipe, port: number) => readonly string[];
    readonly install: Effect.Effect<void, ShError>;
    readonly env?: () => Record<string, string>;
  }
  ```
  Flat registry `Record<EngineId, EngineSpec>` in `src/engines/registry.ts`,
  `engineFor(recipe)` lookup. Each adapter (`vllm.ts`/`llama.ts`/`sglang.ts`/`mlx.ts`)
  is 30-50 lines.
- Recipes (`ModelRecipe`) are plain interfaces, one TS file per model×device combo,
  aggregated into `src/models/catalog.ts`. Type-checked at build time, not JSON.
- Built on Effect (v4-beta) throughout for shell exec/spawn/HTTP.
- Serving lifecycle (`serving/instance.ts`) is ~20 lines: check-alive, reap-stale,
  allocate port, spawn, write instance record, health-wait. No hidden cross-cutting
  logic.

**Implication for us:** "work more like exo-cli" = adopt the *shape* (tiny
`EngineSpec`-style interface, flat registry, small single-purpose adapter files,
Effect end-to-end) for our EXISTING vLLM/SGLang/llama.cpp/MLX process-launch
logic. It does NOT mean copy Docker usage — exo-cli has none. The Docker
requirement is a **new, orthogonal** capability (`/environments`) we design
ourselves: pinned-version containerized recipes, separate from the native
process-launch path exo-cli's pattern informs.

## Part A — `/environments` (new feature)

Goal: a page where a user picks a recipe + explicit pinned engine version
(vllm/sglang/llama.cpp) and we run it as a Docker container using the
**official upstream image** for that version, instead of the native-process
launch path.

**2026-07-01 (iter 5) important design correction:** the codebase already has
a Docker-run mechanism (`backend-builder.ts`'s `wrapVllmInDocker`,
`extra_args.docker_image` on a recipe, `process-manager.ts`'s docker
stop/kill, `runtime-targets.ts`'s docker image/container discovery,
`logs-routes.ts`'s docker log streaming) — but it is a **narrow, vLLM-only
escape hatch for one specific custom-forked image** (`CONTAINER_VLLM_BIN =
"/opt/venv/bin/vllm"` is that image's specific file layout, not a generic
convention). Generalizing it by guessing container paths for sglang/
llama.cpp would have been irresponsible — instead, researched each engine's
**real, official, published Docker image** via WebSearch/WebFetch (sourced,
not guessed):

- **vLLM** — `vllm/vllm-openai` (Docker Hub). `ENTRYPOINT ["vllm", "serve"]`.
  Plain semver tags for CUDA (`v0.11.0`), accelerator-suffixed variants exist
  too (`v0.24.0-cu129-ubuntu2404`). Container command = just the engine flags
  (`--model`, `--host`, `--port`, ...) — no subcommand needed, the entrypoint
  already runs `vllm serve`.
  Sources: [vLLM Docker docs](https://docs.vllm.ai/en/stable/deployment/docker/),
  [vllm/vllm-openai tags](https://hub.docker.com/r/vllm/vllm-openai/tags).
- **SGLang** — `lmsysorg/sglang` (Docker Hub). No fixed server entrypoint —
  tags are always accelerator-suffixed (`v0.4.7-cu124`,
  `v0.4.10.post2-rocm700-mi35x`), and the container command must explicitly
  invoke `python3 -m sglang.launch_server --model-path ... --host ... --port ...`.
  Source: [lmsysorg/sglang](https://hub.docker.com/r/lmsysorg/sglang),
  [sglang docker compose](https://github.com/sgl-project/sglang/blob/main/docker/compose.yaml).
- **llama.cpp** — `ghcr.io/ggml-org/llama.cpp`. Versioned by **build number**,
  not semver (e.g. `server-cuda-b9853`, `server-b9853` for CPU,
  `server-rocm-b{n}`/`server-vulkan-b{n}`/`server-openvino-b{n}` for other
  accelerators). The `server*` tag variants already run `llama-server` as
  their entrypoint — container command is just `-m <path> --host --port`.
  Sources: [llama.cpp docker.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md),
  [ghcr.io/ggml-org/llama.cpp packages](https://github.com/ggerganov/llama.cpp/pkgs/container/llama.cpp).
- **MLX is intentionally excluded.** MLX's entire value proposition is native
  Apple Silicon Metal acceleration; Docker on macOS runs containers inside a
  Linux VM with no GPU/Metal passthrough, so a "containerized MLX
  environment" would run with no acceleration at all — not useful. No
  official MLX Docker image exists either. `EnvironmentEngineId` is
  `Extract<EngineBackend, "vllm" | "sglang" | "llamacpp">`.

Progress:

- [x] **Safe prerequisite refactor**: extracted `buildDockerRunArguments`
      (renamed per `unicorn/prevent-abbreviations`) out of `wrapVllmInDocker`
      in `backend-builder.ts` — the generic `docker run` invocation shape
      (container naming, `--gpus all --network host --ipc host`, env
      forwarding, model bind-mount) is now a shared, parameterized helper
      (`extraEnv`/`extraVolumes` per-call), with `wrapVllmInDocker` reduced to
      supplying its own JIT-cache-specific env/volume on top. Verified
      byte-for-byte identical behavior against the existing
      `vllm-docker-image.test.ts` (4/4 pass unchanged).
- [x] **`EnvironmentSpec` foundation** (new `controller/src/modules/
      environments/` module, built on the research above — NOT the
      vllm-only escape hatch):
  - `types.ts` (16 lines) — `EnvironmentEngineId`, `EnvironmentAccelerator`,
    `EnvironmentImageSpec`.
  - `image-registry.ts` (32 lines) — `resolveEnvironmentImage({engineId,
    version, variant})`: pure function mapping a pinned version + optional
    accelerator/build variant to the exact official image reference per
    engine, using the real tag shapes above (no invented defaults for
    variants that vary per engine — caller supplies the exact suffix).
  - `container-command.ts` (49 lines) — `buildEnvironmentContainerCommand
    (engineId, recipe, image)`: builds the per-engine container CMD (reusing
    the existing `Recipe` type — no forked recipe concept, per the original
    plan) and wraps it via the shared `buildDockerRunArguments`.
  - New test file `tests/controller/integration/environments-docker-images
    .test.ts` (9 tests, all passing) covering image resolution for all 3
    engines + variants, and container-command shape for all 3 engines
    (entrypoint assumptions, model bind-mount, served-model-name handling).
  - `npm run test:integration` (108/108, up from 99), `test:unit` (4/4),
    lint, typecheck, jscpd, depcheck all green. `knip` flags the 3 new files
    as "unused" — expected and correct: nothing wires them into routes yet
    (next step below), not dead code.
- [x] **Persistence** (2026-07-01): `recipe-store.ts` turned out to be
      **SQLite-backed** (via `openSqliteDatabase`/`bun:sqlite`), not JSON-file
      as originally assumed above — corrected before building anything.
      `environments/types.ts` now has `Environment`/`EnvironmentId` (branded,
      matching `RecipeId`'s pattern) — `{id, name, recipeId, engineId,
      version, variant, createdAt, updatedAt}`. No `image`/`status` field:
      the image is *derived* on demand via `resolveEnvironmentImage`, not
      stored (avoids a second source of truth), and container run/build
      status is a runtime concern like a recipe's running state — not part
      of the definition record. `environment-serializer.ts` uses Effect v4
      `Schema` for validation (`Schema.Struct`/`Schema.Literals`), mirroring
      `recipe-serializer.ts`'s established pattern exactly.
      `environment-store.ts` mirrors `RecipeStore`'s CRUD shape (list/get/
      save/delete), simpler since there's no legacy schema to migrate. Wired
      into `AppContext.stores.environmentStore` alongside `recipeStore`,
      sharing the same `dbPath`. Also deleted `EnvironmentImageSpec`/
      `EnvironmentAccelerator` from `types.ts` — leftover from iter 5, never
      actually used once `image-registry.ts` settled on a more flexible
      `variant: string` design; found via this iteration's knip run.
      New test file `environments-store.test.ts` (4 tests: parse
      defaults/validation, store round-trip, upsert-bumps-updatedAt).
      112/112 integration (up from 108) + 4/4 unit + lint/typecheck/jscpd/
      depcheck all green.
- [x] **Controller routes** (2026-07-01): new `environments/routes.ts`
      (`registerEnvironmentRoutes`, wired into `http/app.ts` next to
      `registerModelsRoutes`) — `GET /environments` (list), `GET
      /environments/:id` (get), `POST /environments` (create — validates
      `recipeId` references a real recipe before saving, mirrors
      `engines/routes.ts`'s recipe-route error-handling shape), `DELETE
      /environments/:id`. Every response includes the *resolved* `image`
      field (computed via `resolveEnvironmentImage` on read, never stored —
      per the no-second-source-of-truth decision from the persistence step).
      New route-level test `environments-routes.test.ts` (4 tests: reject
      create for a nonexistent recipe, create + resolve image, list/get/404,
      delete + re-delete 404) using the existing shared test harness
      (`fixtures.ts`'s `createTestApp`/`registerControllerTestLifecycle`).
      116/116 integration (up from 112) + 4/4 unit + lint/typecheck/jscpd/
      depcheck green. `container-command.ts` is the only remaining "unused
      file" per knip — expected, start/stop lifecycle (next) is what calls it.
      Also fixed a small pre-existing Effect-v4 gap found along the way: the
      shared `fixtures.ts` test harness had a raw `new Promise(resolve =>
      setTimeout(...))` in its `afterEach` — replaced with `delay()` from
      `core/async.ts`. Confirmed safe (116/116 still pass) since it's the
      exact same underlying `Effect.sleep`, just via the established
      Effect-backed helper instead of a bare Promise.
- [x] **Start/stop lifecycle** (2026-07-01): `environment-process.ts`
      (`startEnvironment`, `stopEnvironment`, `isEnvironmentRunning`) +
      `POST /environments/:id/start|stop` routes. Fixed a naming bug first:
      `buildDockerRunArguments`/`buildEnvironmentContainerCommand` derived the
      container name from `recipe.id`, but one recipe can back *multiple*
      environments (different engine/version) — added a `containerName`
      override (`environmentContainerName(environmentId)` = `local-studio-
      env-{id}`), defaulting to the old recipe-based name for
      `wrapVllmInDocker`'s existing callers so nothing regressed there.
      `startEnvironment` mirrors `process-manager.ts`'s launch-then-verify
      pattern (spawn detached, `Effect.gen` + `delayEffect` for a brief
      settle window, check for an immediate crash) rather than the full
      `launchModel` machinery (log-tail capture, crash-loop budget) — kept
      deliberately minimal for a first pass. `stopEnvironment` reuses the
      same stop→poll→force-kill shape as `process-manager.ts`'s
      `killProcess`, simplified because Docker's own `--rm` flag handles
      container removal once it exits (no PID-tree walking needed).
      `isEnvironmentRunning` is a plain `docker ps --filter` check — no
      in-memory tracking, so it's correct even across controller restarts.
      List/get responses now include `running` alongside `image`.
      **Testing note**: Docker is actually installed on this dev machine, so
      tests deliberately never exercise a real successful `start` — that
      would spawn a genuine `docker run` against a multi-gigabyte official
      image with no model/GPU present, hanging or polluting the host. Tests
      cover the safe paths only (unknown-id 404s, not-running short-circuit,
      `isEnvironmentRunning` for a nonexistent container) — a real start/stop
      round-trip still needs manual verification on a host with Docker + GPU
      + a downloaded model. 122/122 integration (up from 116) + 4/4 unit +
      lint/typecheck/jscpd/depcheck green. Whole `environments/` module is
      now 399 lines across 7 files, none over 90 lines.
- [x] **Frontend** (2026-07-01): `/environments` page (`app/environments/
      page.tsx`, 192 lines) + `features/environments/use-environments.ts`
      (153 lines, the data/actions hook) + `lib/api/environments.ts` (28
      lines, `createEnvironmentsApi` following the exact `createRecipesApi`
      shape). Deliberately used the simpler "container calls a hook, renders
      inline" pattern from `usage-page.tsx` rather than the heavier
      3-file atom/component/container split `recipes-content/` uses — that
      split earns its complexity from ~30 files of tabs/modal/explore-tab
      logic; a v1 list+create-form page doesn't need the same ceremony
      (matches "don't design for hypothetical future requirements"). Reuses
      existing `@/ui` primitives entirely (`AppPage`, `PageState`, `Table`,
      `Select`, `Input`, `Button`, `RefreshButton`) — no new form controls
      invented. Added a `/environments` nav entry in `left-sidebar.tsx`
      (`Boxes` icon). Data-fetching follows the established
      `useSyncExternalStore`-based "load once on mount" pattern (no
      `useEffect`, matching the codebase's ban). Frontend
      lint/typecheck/cycles/ui-structure/deadcode/dupes/depcheck/build all
      green; `/environments` shows in the build's static route list.
      **Part A (the user's headline `/environments` ask) is now
      end-to-end complete**: types → persistence → image resolution →
      container command building → CRUD + start/stop routes → frontend page.
- [x] **Reuse existing recipe types**: confirmed — `buildEnvironmentContainerCommand`
      takes the existing `Recipe` type directly, no second recipe concept forked.

## Part B — engine system simplification

**2026-07-01 (iter 2) research complete** — full duplication map + ordered
refactor steps below, produced by deep-reading every file in
`controller/src/modules/engines/`. Key finding: **`engine-spec.ts` already IS**
a rich `EngineSpec`-shaped interface (`id, healthPath, cliBinary, buildCommand,
managedPackageSpec, install, detectInvocation, extract*, probeBinary?,
resolvePythonPath?, getRuntimeInfo?, getConfigHelp?`), and
`specs/{vllm,sglang,llamacpp,mlx}-spec.ts` already implement it. **This is not
a from-scratch redesign** — it's (1) deleting dead/duplicate parallel
implementations that bypass the spec, and (2) making every consumer
(`routes.ts` above all) go through `getEngineSpec(backend).X` instead of ad-hoc
direct imports into `runtime-info.ts`/`vllm-runtime.ts`/`llamacpp-runtime.ts`.

Ordered steps (each = one verifiable commit; run `npm run test:integration`
+ the two named contract tests after each):

- [x] **Step 1** (2026-07-01): `vllm-runtime.ts` had its own private near-copy
      of `runEnvironmentUpgradeCommand` (different default timeout) instead of
      importing the shared one from `upgrade-config.ts`. Deleted the copy.
- [x] **Step 2** (2026-07-01): `runtime-info.ts`'s `getMlxRuntimeInfo` (sync,
      `runCommand`) duplicated `specs/mlx-spec.ts`'s `getRuntimeInfoAsync`
      (async, `runCommandAsync`) — same candidate-python discovery + a
      copy-pasted `MLX_IMPORT_PROBE` string. `routes.ts`'s `GET /runtime/mlx`
      called the sync dead-path directly instead of
      `getEngineSpec("mlx").getRuntimeInfo`. Repointed the route, deleted the
      duplicate implementation + its private helpers.
- [x] **Step 3** (2026-07-01): same pattern for llama.cpp — `runtime-info.ts`'s
      `getLlamacppConfigHelp` duplicated `specs/llamacpp-spec.ts`'s
      `getConfigHelp` (same "resolve bin → runCommandAsync --help" logic).
      Repointed `/runtime/llamacpp/config` to `getEngineSpec("llamacpp")`,
      deleted the duplicate.
- [ ] **Step 4**: Unify `routes.ts`'s four different backend-info access
      patterns (vllm/mlx go direct to runtime files, sglang/llamacpp go
      through `runtime-targets.ts`, only sglang's `/config` route uses
      `getEngineSpec`) onto one consistent `getEngineSpec(backend).X` pattern.
      Keep `runtime-targets.ts` only for the multi-source discovery UI
      (`/runtime/targets*`), not per-backend single-info routes. NOT DONE YET
      — bigger/riskier than steps 1-3, touches `routes.ts` (474 lines) broadly.
- [x] **Step 5** (2026-07-01): Converted the two leaf files that actually had
      async work. `install-lock.ts`'s `acquireEngineInstallLock` (a polling
      loop: try-acquire, `await delay(pollMs)`, repeat until timeout) is now
      `Effect.gen`-based using the existing `delayEffect`, with the original
      Promise-returning signature kept as a thin `Effect.runPromise` wrapper
      (same convention as `core/command.ts`'s `runCommandAsync`) — zero
      call-site changes needed. `managed-venv.ts`'s `installIntoManagedVenv`
      (venv creation → installer resolution → pip/uv install with streaming
      progress callbacks → post-install probe) fully converted to
      `Effect.gen` composing `runCommandAsyncEffect` directly instead of
      awaiting the Promise wrapper; the one remaining Promise call
      (`probePythonRuntime`, in a different file, out of scope today) is
      lifted via `Effect.promise` since it never rejects (internally uses
      `runCommandAsync`, which never rejects). **`launch-failure-budget.ts`
      needed NO conversion** — checked and it's pure synchronous in-memory
      state (a `Map`-based crash-loop counter), zero async/Promise anywhere;
      wrapping it in Effect would be pure ceremony, so left as-is. Controller
      lint/typecheck/99 integration tests/4 unit tests/jscpd/depcheck all
      green after.
- [x] **Step 6** (2026-07-01): `process-utilities.ts` needed **no conversion**
      — checked, it's 100% synchronous (`spawnSync`/`process.kill`/plain
      object building), zero `async`/`Promise`/`await` anywhere. In
      `process-manager.ts`, converted the 3 functions with genuine async work
      to `Effect.gen` (same "Effect-native + thin Promise wrapper" pattern as
      steps 5): `killProcess` (signal + two poll-for-death loops + final
      settle delay), `cleanupOrphanedInferenceWorkers` (signal + poll-for-death
      loop), and `evictModel` (pure sequential composition of the two above +
      `findInferenceProcess`). **Deliberately left `launchModel` and
      `findInferenceProcess` as plain async/Promise** — `findInferenceProcess`
      has no actual async operation in its body (nothing to model in Effect);
      `launchModel` mixes a timed wait with long-lived `child.on(...)`/
      `readline` event-listener registration that outlives the wait itself
      (stdout/stderr line capture keeps running after the "did it crash in the
      first 3s" check returns) — forcing that into `Effect.callback` would be
      real behavioral-modeling work, not a mechanical port, and this is the
      actual model-launch path (same risk profile the plan calls out for
      `engine-coordinator.ts` in step 7). Verified `npm run test:integration`
      (all 99, including `runtime-recipe-contracts.test.ts`'s crash-loop/kill
      scenarios) + lint/typecheck/jscpd/depcheck all green before treating
      this done.
- [ ] **Step 7**: Convert `engine-coordinator.ts` LAST — largest state machine,
      most callers, highest risk (abort/lock/lifecycle-intent logic is only
      integration-tested end-to-end, not unit-tested). Diff carefully against
      `runtime-recipe-contracts.test.ts` (1055 lines) + `stream-proxy-contracts
      .test.ts` (507 lines) before/after.

Confirmed: `grep -rn 'from "effect"' controller/src/modules/engines/**` returns
**zero hits** as of 2026-07-01 — the whole module is 100% raw async/Promise
today (routes.ts alone has 81 async/await/Promise occurrences). Steps 5-7
above are the actual Effect-v4 migration for this module.

Files already clean, no action needed: `launch-state.ts`,
`launch-failure-budget.ts`, `model-runtime-defaults.ts`, `install-lock.ts`,
`argument-utilities.ts` (each single-purpose, <100 lines — already exo-cli
sized). `backend-builder.ts` vs `specs/*` and `runtime-target-factory.ts` vs
`specs/*` are NOT duplicated — already correctly split (verified, not just
assumed).

## Part C — repo-wide sweep checklist

Tracked as a living checklist; check off per-file/per-package as done. Re-run
the audit commands below at the start of each iteration to see current counts.

- [x] **Dependency pinning** (no `^`/`~` in any package.json): fixed
      2026-07-01 — `effect` in cli/controller/frontend, `yaml` in frontend.
- [ ] **File size** (no source file > 500 lines, tests exempt): as of 2026-07-01,
      non-test offenders (run
      `find . -name "*.ts" -o -name "*.tsx" -not -path "*/node_modules/*" ... | xargs wc -l | sort -rn`
      to refresh):
  - [x] `frontend/src/features/agent/ui/agent-workspace-shell.tsx` (was 629,
        regressed by the quick-composer-panel feature added same day — fixed
        2026-07-01: now 306 lines, extracted `quick-panel/quick-panel-top-bar.tsx`
        (53 lines), `agent-workspace-navigation.ts` (116 lines),
        `render-workspace-pane.tsx` (175 lines). Each new file is a cohesive,
        independently-testable unit — matches the exo-cli small-file ethos.)
  - [x] `frontend/src/features/agent/ui/timeline/session-pane-block-router.tsx`
        (was 772, fixed 2026-07-01: now 134 lines, extracted `activity-grouping.ts`
        (208, pure logic — types + `groupAssistantBlocks`/`buildActivityItems`/
        `summarizeActivity`/etc., no JSX), `turn-status-divider.tsx` (67),
        `assistant-activity-group.tsx` (181), `user-message-block.tsx` (127),
        `assistant-message-actions.tsx` (61). Updated
        `tests/frontend/e2e/agent-session-runtime-regressions.test.ts`'s import
        of `groupAssistantBlocks` to the new `activity-grouping` module (no
        back-compat re-export kept). 69/70 e2e tests pass — the 1 failure
        (`skill mentions...composer prompt construction`) is pre-existing,
        verified via `git stash` against the unmodified file, unrelated
        subsystem — see "Discovered issues" below.)
  - [x] `frontend/src/features/agent/ui/chat-pane-hooks.tsx` (was 736, fixed
        2026-07-01: deleted the barrel file entirely — it had exactly one
        consumer (`chat-pane.tsx`) — and split its 8 hooks into 6 cohesive
        files: `chat-pane-snapshot.ts` (4, the shared no-op
        `useSyncExternalStore` snapshot getter every other file imports, so
        it isn't duplicated 4x), `chat-pane-derived-state.ts` (35),
        `chat-pane-ui-effects.ts` (140, the 3 small UI-sync hooks:
        stick-to-bottom, mention rows, context-attach), `chat-pane-
        runtime-handle.ts` (58), `chat-pane-session-title.ts` (90), and
        `chat-pane-send-flow.ts` (417, the big one — kept as one file since
        it's a single cohesive send/queue/steer/retry flow and 417 lines is
        still comfortably under 500, not worth fragmenting further). Verified
        via `git stash`/`git stash pop` that the 4 e2e test failures beyond
        the already-known "skill mentions" one are also pre-existing on the
        unmodified tree (215 tests, 210 pass, 5 fail — identical before and
        after) — see "Discovered issues" below, not caused by this split.
        Frontend lint/typecheck/cycles/ui-structure/deadcode/dupes/depcheck/
        build all green.
  - [ ] `frontend/src/features/agent/browser-host/browser-host.ts` (715)
  - [ ] `frontend/src/features/agent/runtime/session-runtime-controller.ts` (709)
  - [ ] `frontend/src/hooks/realtime-status-store.ts` (678)
  - [ ] `frontend/src/features/agent/ui/agent-browser.tsx` (676)
  - [ ] `frontend/src/features/agent/ui/filesystem-panel.tsx` (642)
  - [ ] `frontend/src/features/agent/ui/use-workspace.ts` (623)
  - [ ] `frontend/src/features/agent/tools/context.tsx` (603)
  - [ ] `frontend/src/features/agent/ui/chat-pane-composer.ts` (595)
  - [ ] `controller/src/modules/system/metrics-collector.ts` (565)
  - [ ] `frontend/src/lib/api/core.ts` (558)
  - [ ] `controller/src/modules/proxy/openai-routes.ts` (554)
  - [ ] `frontend/src/app/api/proxy/[...path]/route.ts` (542)
  - [ ] `frontend/src/features/settings/local-agents.ts` (533)
  - [ ] `frontend/src/features/setup/use-setup.ts` (530)
  - [ ] `frontend/src/features/agent/runtime/pi-event-applier.ts` (529)
  - [ ] `frontend/src/features/agent/ui/git-diff-panel.tsx` (525)
  - [ ] `frontend/src/features/recipes/recipes-content/explore-tab-sections.tsx` (518)
  - [ ] `controller/src/modules/engines/runtimes/runtime-targets.ts` (516) — see Part B
  - [ ] `frontend/src/features/shell/left-sidebar.tsx` (511)
  - [ ] `frontend/src/features/agent/ui/agent-browser-panel.tsx` (503)
  - [ ] `frontend/src/features/agent/pi-runtime.ts` (501)
- [ ] **Effect-v4 coverage**: `effect` package already pinned in all 3 workspaces.
      Need to audit raw `async`/`Promise`/`fetch` usage outside of Next.js route
      handlers (which must stay Promise-based per Next's contract) and convert
      internal business logic to `Effect.gen`/`Effect.tryPromise`. Not started —
      needs its own inventory pass (grep `async function\|: Promise<` per
      package, cross-reference against existing Effect usage).
- [ ] **Duplication**: `frontend` `jscpd` (`npm run check:dupes`) reports 0
      clones as of 2026-07-01 — keep re-running after each refactor batch.
      `controller` has no jscpd config yet — add one and baseline it.
- [ ] **React atom/component/container conventions**: not audited yet. Needs a
      pass identifying components mixing data-fetching + presentation that
      should split into container (data) + presentational (view) pairs, and any
      copy-pasted small UI bits (buttons, badges, pickers) that should become
      shared atoms.
- [ ] **Comments**: sweep for narrative/obvious comments (`// increment i`,
      restating the code) vs. legitimate why-comments; delete the former.
- [x] **Unused dependencies**: all three workspaces already have depcheck
      (`frontend`: `npm run depcheck`; `controller`/`cli`: bundled into their
      `check` script alongside knip+jscpd) — all clean as of 2026-07-01.

## Discovered issues (fixed 2026-07-01)

- Controller's own `lint`/`check` gates were already red before this initiative
  touched anything: `unicorn/prevent-abbreviations` on 4 `dataDir` params
  (renamed to `dataDirectory` in `process-utilities.ts` / `vllm-python-path.ts`),
  3 missing explicit return types in `openai-routes.ts`'s SSE keepalive stream,
  1 unused `toBytes` helper in `gpu.ts`. All fixed; `npm run lint` +
  `npm run typecheck` clean in `controller/`.
- `controller/src/modules/proxy/content-normalizer.test.ts` existed but wasn't
  wired into any script (knip flagged it as an "unused file") — added
  `test:unit` script (`bun test src`) and added `src/**/*.test.ts` to knip's
  `entry` config so future co-located tests are tracked. Test passes (4/4).
- **Real duplication found and removed**: `runtime-info.ts` had a full
  superseded sync `getSglangRuntimeInfo` (+ its private helpers
  `getRunningSglangPythonCandidates` + a copy-pasted `SGLANG_IMPORT_PROBE`
  string) that a comment in `sglang-spec.ts` explicitly says was replaced by an
  async version — the old code was just never deleted. Removed 62 lines;
  99/99 controller integration tests still pass.
- `optionalStringArray` in `core/validation.ts` was a genuinely dead validation
  helper (no route uses it) — removed.
- `redactLogContent` (`core/log-redaction.ts`) is a **knip false positive**:
  it's used from `tests/controller/integration/log-redaction.test.ts`, which
  lives outside `controller/` and isn't in knip's scan scope. Tried adding
  `../tests/controller/**/*.ts` to knip's `entry` — didn't resolve it (glob
  likely not honored outside the package root). Left as a known false positive
  rather than fight the tool further or risk deleting live code; revisit if a
  cleaner knip config approach is found.

## Discovered issues (not yet triaged)

- `tests/frontend/e2e/agent-session-runtime-regressions.test.ts`: "skill
  mentions and selected skill context survive composer prompt construction"
  fails on `main` independent of any change made in this initiative (confirmed
  via `git stash` — same failure on the unmodified tree). Expected
  `/Loaded skills:/` in composer-constructed prompt text, got `"open the
  page"`. Unrelated subsystem (composer/skill-mention prompt construction, not
  timeline/activity rendering) — needs its own investigation, not touched here.
- `frontend/scripts/patch-pi-ai-openai-text-boundaries.mjs` (a `postinstall`
  hook patching `@earendil-works/pi-ai`'s compiled output) throws
  `Could not find pi-ai assistant text join` when `npm install` re-runs
  lifecycle scripts — the text pattern it greps for no longer matches the
  installed dist file. Did not investigate further this iteration (unrelated to
  the dependency-pinning task that surfaced it); node_modules was unaffected.
  Needs its own look: either the patch's search pattern is stale vs. the
  currently pinned `@earendil-works/pi-ai` version, or the pinned version
  drifted without the patch being updated.
- 3 more pre-existing e2e failures found 2026-07-01 while verifying the
  `chat-pane-hooks.tsx` split (confirmed via `git stash` — same 3 fail on the
  unmodified tree, so unrelated to that split): `agent-browser-tools-
  regressions.test.ts` — "file tagging turns an @ mention into one durable
  project-file attachment" (`kind: 'file'` vs expected `kind: 'plugin'`) and
  "MCP plugin slash and at-mention context persist selected plugin state";
  `agent-workspace-regressions.test.ts` — "pane state round-trips durable
  session metadata and drops transcripts" (expects `{plugins, skills,
  promptTemplates}` on restored pane state, gets `undefined`). All three look
  like the same underlying plugin/skill-context persistence area as the
  already-known "skill mentions" failure — plausibly one root cause across
  all 4, not yet investigated.

## Iteration log

- **2026-07-01 (iter 1)**: researched exo-cli, wrote this plan, fixed dependency
  pinning (3 package.json files: `effect` in cli/controller/frontend, `yaml` in
  frontend — all lockfiles re-synced, all 3 workspaces still typecheck clean),
  fixed the `agent-workspace-shell.tsx` file-size regression from the same-day
  quick-composer-panel work (629 → 306 lines via 3 new extracted files, full
  frontend gate green after: lint/typecheck/cycles/ui-structure/deadcode/dupes/
  depcheck). Found and fixed controller's pre-existing red lint gate (8 errors)
  plus real dead code (62-line duplicate sglang runtime-info implementation,
  1 dead validation helper) — see "Discovered issues" above; controller
  lint/typecheck/99-integration-tests/unit-test all green. Found the pi-ai
  postinstall patch issue (not yet fixed). Did not yet start Part A/B (new
  feature + engine rewrite) — those are large, higher-risk, multi-file changes
  that need a dedicated iteration with full attention, not a rushed pass.
  Next iteration: pick the next unchecked file-size item above, OR start
  Part B by reading `engine-coordinator.ts` + `runtime-targets.ts` +
  `process-manager.ts` together to map real duplication before touching code.

- **2026-07-01 (iter 2)**: split `session-pane-block-router.tsx` (772 → 134
  lines, 5 new files, see checklist above). Researched Part B in full via a
  dedicated read-only agent — `engine-spec.ts` already is a rich EngineSpec,
  no redesign needed, just consistency + dead-code removal; wrote the ordered
  7-step plan into Part B above. Executed steps 1-3 (all "near-zero risk" per
  the research): deleted a duplicate `runEnvironmentUpgradeCommand` in
  `vllm-runtime.ts`; found and fixed a **live** duplicate (not just dead code
  this time) — `runtime-info.ts`'s sync `getMlxRuntimeInfo` bypassed
  `getEngineSpec("mlx")` from the `/runtime/mlx` route while the aggregate
  `/system` route already used the spec version, so the two disagreed on
  `upgrade_command_available`; verified the frontend doesn't actually consume
  that field from the direct route before repointing it (no user-visible
  regression) and deleted the dead sync implementation + 3 orphaned helpers
  (`splitCommand`/`resolvePythonCandidate`/`looksLikePythonExecutable`, dead
  once their last caller was removed); did the same pattern for llama.cpp
  config-help (deleted `runtimes/llamacpp-runtime.ts` entirely, repointed
  `/runtime/llamacpp/config` to `getEngineSpec("llamacpp").getConfigHelp`,
  after upgrading the spec's version to match the runtime version's more
  robust binary-path resolution so behavior didn't regress). Controller
  lint/typecheck/99 integration tests/4 unit tests/jscpd/depcheck all green
  after each step. Part B steps 4-7 (routes.ts consistency pass, Effect-v4
  conversion) remain — step 4 touches routes.ts broadly and needs its own
  focused iteration; steps 5-7 are the real Effect migration.

- **2026-07-01 (iter 3)**: executed Part B step 5 (Effect-v4 conversion of the
  leaf runtime files) — see Part B above for detail. `install-lock.ts` and
  `managed-venv.ts` now compose `runCommandAsyncEffect`/`delayEffect` via
  `Effect.gen` internally, keeping their existing Promise-returning public
  signatures via thin `Effect.runPromise` wrappers (same house convention as
  `core/command.ts`). Confirmed `launch-failure-budget.ts` has no async work
  and needs no conversion. Controller lint/typecheck/99 integration/4 unit
  tests/jscpd/depcheck all green. Next iteration: step 6
  (`process-manager.ts` 440 lines / `process-utilities.ts` 202 lines →
  Effect) — bigger surface than step 5, read both fully before converting,
  same verify-after-each-file discipline. Step 4 (routes.ts consistency) and
  step 7 (engine-coordinator.ts, highest risk, do last) still untouched.

- **2026-07-01 (iter 4)**: executed Part B step 6 — see Part B above for the
  full breakdown and the risk judgment call (converted the 3 genuinely-async
  `process-manager.ts` functions, left `launchModel`'s event-driven spawn
  logic alone as too risky for a mechanical port). `process-utilities.ts`
  needed no changes (pure sync). Controller lint/typecheck/99 integration
  tests (including the crash-loop/kill contract tests, since this touches the
  actual kill/evict path)/4 unit tests/jscpd/depcheck all green. Remaining in
  Part B: step 4 (routes.ts consistency — 4 inconsistent backend-info access
  patterns, not yet unified) and step 7 (`engine-coordinator.ts`, 252 lines,
  the highest-risk one, saved for last on purpose — read it fully alongside
  `runtime-recipe-contracts.test.ts` and `stream-proxy-contracts.test.ts`
  before touching anything). Part A (`/environments` Docker feature) and the
  ~21 remaining file-size items in Part C are still fully untouched — worth
  picking one of those next if step 7 doesn't feel safe to rush.

- **2026-07-01 (iter 5)**: pivoted to Part A after 4 iterations of Part B/C
  cleanup — the user's headline ask (a new `/environments` page) hadn't been
  touched yet. Before writing any code, discovered the existing
  `docker_image`/`wrapVllmInDocker` mechanism is a narrow vLLM-only escape
  hatch for one custom-forked image, not a generalizable template — so
  researched the real official Docker images for vLLM/SGLang/llama.cpp via
  WebSearch/WebFetch instead of guessing container internals (see Part A
  above for sources and findings). Extracted a safe, verified
  `buildDockerRunArguments` helper from `wrapVllmInDocker` first, then built
  the `environments` module foundation (types + pure image-resolution +
  container-command builders) on top of the *real* image/entrypoint
  contracts, with 9 new passing tests. Deliberately excluded MLX (no GPU
  passthrough for Docker on macOS, no official image exists). Did NOT build
  persistence/routes/frontend yet — those need the same careful pace, and
  rushing a Docker orchestration lifecycle (build/start/stop, container
  reaping, log streaming) without room to verify each piece would risk
  exactly the kind of complexity the user is asking to get away from. Next
  iteration: environments store (mirror `recipe-store.ts`'s shape), then
  routes, then frontend page — in that order, one verified commit each.

- **2026-07-01 (iter 6)**: built the environments persistence layer — see
  Part A above. Corrected a wrong assumption from iter 5's plan (recipe
  storage is SQLite, not JSON-file) by actually reading `recipe-store.ts`
  before building anything, rather than trusting the earlier note. Also used
  this iteration's knip run to catch and delete two types (`EnvironmentImageSpec`,
  `EnvironmentAccelerator`) left over from iter 5 that never got wired up
  once the design settled on something more flexible — exactly the kind of
  self-cleanup this initiative should keep doing every iteration, not just
  on the original codebase. `container-command.ts`/`image-registry.ts` still
  show as "unused files" in knip — expected, routes aren't built yet. Next
  iteration: controller routes (`POST /environments` create, `GET
  /environments` list, `DELETE /environments/:id`) wiring the store +
  image-registry + container-command together, following `models/routes.ts`
  or `engines/routes.ts` for the Hono route-registration convention already
  used elsewhere. Start/stop lifecycle (actually running the docker command)
  can come after — get create/list/delete + the resolved image visible in
  the API first, verify with a route-level integration test before adding
  process lifecycle.

- **2026-07-01 (iter 7)**: built environments CRUD routes (`GET/POST
  /environments`, `GET/DELETE /environments/:id`) — see Part A above. Reused
  the exact recipe-route conventions from `engines/routes.ts` (validation via
  `badRequest`/`notFound`, `parseJsonObjectBody`) rather than inventing a new
  pattern, and put them in a dedicated `environments/routes.ts` file instead
  of appending to the already-oversized `engines/routes.ts` (474 lines,
  itself a flagged Part C file-size item) — no point making that cleanup
  harder later. Added a route-level test using the project's existing shared
  test harness (`fixtures.ts`). Also fixed a small pre-existing raw-Promise
  gap in that shared harness while in the area. 116/116 integration + 4/4
  unit + lint/typecheck/jscpd/depcheck all green. Next iteration: start/stop
  container lifecycle (`POST /environments/:id/start|stop`) — read
  `process-manager.ts`'s docker stop/kill handling again first and reuse it,
  don't re-invent container teardown. After that: the frontend `/environments`
  page itself, which is still fully untouched.

- **2026-07-01 (iter 8)**: built start/stop container lifecycle — see Part A
  above. Caught and fixed a real design bug before it shipped: container
  naming was keyed off `recipe.id`, which breaks the moment one recipe backs
  two environments (e.g. trying both vLLM v0.11.0 and v0.12.0 against the
  same model) — added an explicit `containerName` override. Kept the actual
  process lifecycle intentionally minimal (no log-tail capture, no
  crash-loop budget) rather than porting all of `launchModel`'s complexity,
  since this is a first pass and over-building it now would work against
  "cleanest possible." Also made a deliberate testing-safety call: this dev
  machine actually has Docker installed, so a naive integration test hitting
  `/start` for real would try to pull a multi-gigabyte vLLM/SGLang/llama.cpp
  image with no GPU or model present — tested only the side-effect-free
  paths instead and left a clear note that the real happy path needs manual
  verification. Whole environments module: 399 lines / 7 files, all under
  90 lines each. **Part A backend is now functionally complete** (types,
  persistence, image resolution, container command building, full CRUD +
  start/stop routes). Next iteration: the frontend `/environments` page —
  still the one completely untouched piece of the user's original ask. Look
  at `frontend/src/app/recipes/page.tsx` (or equivalent) and the existing
  `/api/agent/projects`-style Next.js API-route-proxying-to-controller
  pattern before designing it from scratch.

- **2026-07-01 (iter 9)**: built the `/environments` frontend page — the last
  untouched piece of the user's original ask, see Part A above. Studied
  `recipes-content/` (the existing model/view/container split) and
  `usage-page.tsx` (a simpler container+hook page) before choosing the
  latter's shape, since the recipe feature's 3-file split is justified by its
  real complexity (tabs, modal, explore/downloads sub-tabs across ~30 files)
  and forcing that same structure onto a v1 list+create-form page would be
  premature. Full stack: `lib/types.ts` (`Environment`/`EnvironmentWithStatus`
  /`EnvironmentPayload`, careful not to collide with the pre-existing,
  unrelated `EnvironmentInfo` type also in that file), `lib/api/
  environments.ts` (mirrors `createRecipesApi`'s exact shape), `use-
  environments.ts` (state + actions, `useSyncExternalStore` load-on-mount,
  no `useEffect`), `app/environments/page.tsx` (entirely built from existing
  `@/ui` primitives — no new form controls), plus a sidebar nav entry.
  Frontend gate green end to end including a real production build (`
  /environments` shows in the static route list). **This closes out Part A
  end-to-end**: a user can now create an environment (recipe + engine +
  pinned version + optional variant), see its resolved official image and
  running status, and start/stop it, all from one page backed by the
  controller work from iterations 5-8.

  Remaining work for future iterations: Part B step 4 (routes.ts
  backend-info-access consistency) and step 7 (engine-coordinator.ts Effect
  conversion, saved for last as highest-risk); Part C has ~21 file-size
  items still outstanding, the Effect-v4 coverage audit hasn't been done as
  a systematic pass (only fixed opportunistically wherever an iteration
  happened to touch async code), and the react atom/component/container
  audit + comment sweep haven't been started at all. The pi-ai postinstall
  patch script issue and the one knip false positive (`redactLogContent`)
  are still open. A manual end-to-end test of the real `/environments`
  start flow (on a host with Docker + GPU + a real downloaded model) is
  still owed — every iteration so far has only verified the side-effect-free
  paths automatically.

- **2026-07-01 (iter 10)**: with Part A complete, pivoted back to Part C.
  Split `chat-pane-hooks.tsx` (736 → deleted, 6 new files under 420 lines
  each) — see the checklist above for the breakdown. Extracted a shared
  `chat-pane-snapshot.ts` for the trivial no-op `useSyncExternalStore`
  snapshot getter every hook needs, rather than letting 4+ files each define
  their own copy. While verifying the split via `git stash`, discovered 3
  MORE pre-existing e2e failures beyond the one already known from iteration
  2 (all plugin/skill-persistence related, possibly one root cause) —
  documented in "Discovered issues" rather than silently ignored. Frontend
  gate green end to end (lint/typecheck/cycles/ui-structure/deadcode/dupes/
  depcheck/build). Next iteration: continue down the file-size list
  (`browser-host.ts` 715, `session-runtime-controller.ts` 709, or
  `realtime-status-store.ts` 678 are next) — same read-fully-then-split
  discipline, and keep using `git stash` to separate "pre-existing failure"
  from "did I just break this" before assuming a refactor is safe.
