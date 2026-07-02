# Engine system refactor + repo cleanup — live checklist

Autonomous, multi-session initiative (30-min cron loop, unattended). Read this
file first at the start of every iteration; update it before ending each
iteration. Never leave the repo broken — all local gates (`npm run
check:quality` in `frontend/`, `bun run typecheck` + `bun run
test:integration` in `controller/`) must pass before an iteration ends.

Completed work: the full iteration log (iters 1-23) is archived at
`docs/archive/engine-refactor-iterations.md`. Part A (`/environments` page) is
complete end-to-end. Part B steps 1-3, 5, 6 done. Everything below is what
remains.

## Part B — engine system simplification (remaining)

- [ ] **Step 4**: Unify `routes.ts`'s backend-info access patterns (vllm goes
      direct to runtime files, sglang/llamacpp go through
      `runtime-targets.ts`, mlx uses `getEngineSpec`) onto one consistent
      `getEngineSpec(backend).X` pattern. Keep `runtime-targets.ts` only for
      the multi-source discovery UI (`/runtime/targets*`). Also fold the five
      near-identical `/runtime/*/upgrade` handlers into one parameterized
      registration. Blast radius: frontend `lib/api/studio.ts` types
      `vllm_bin`/`bundled_wheel` from `/runtime/vllm` — unifying the shape
      needs that one frontend consumer updated too.
- [ ] **Step 7**: Convert `engine-coordinator.ts` to Effect v4 LAST — largest
      state machine, most callers, highest risk (abort/lock/lifecycle-intent
      logic is only integration-tested end-to-end). Diff carefully against
      `runtime-recipe-contracts.test.ts` + `stream-proxy-contracts.test.ts`
      before/after. Note: the dead `ensureActive`/`searchHuggingFace` layer
      and the line-packed formatting were already removed (2026-07-01); the
      file is now 304 formatted lines.

## Part C — repo-wide sweep checklist (remaining)

- [ ] **File size** (no source file > 500 lines, tests exempt):
  - [ ] `frontend/src/features/agent/runtime/session-runtime-controller.ts`
        (709) — deferred: one cohesive closure, THE ordering authority,
        pinned by regression tests. Only touch in a dedicated pass.
  - [ ] `frontend/src/features/agent/runtime/pi-event-applier.ts` (529)
  - [ ] `frontend/src/features/agent/ui/git-diff-panel.tsx` (525)
  - [ ] `frontend/src/features/recipes/recipes-content/explore-tab-sections.tsx` (518)
  - [ ] `controller/src/modules/engines/runtimes/runtime-targets.ts` (516) — see Part B step 4
  - [ ] `frontend/src/features/shell/left-sidebar.tsx` (511)
  - [ ] `frontend/src/features/agent/ui/agent-browser-panel.tsx` (503)
  - [ ] `frontend/src/features/agent/pi-runtime.ts` (501)
- [ ] **Effect-v4 coverage**: audit raw `async`/`Promise`/`fetch` outside
      Next.js route handlers (those stay Promise-based per Next's contract);
      convert internal business logic to `Effect.gen`/`Effect.tryPromise`.
      Needs its own inventory pass.
- [ ] **React container/presentational conventions**: not audited yet.
- [ ] **Comments**: sweep narrative/restating comments; keep regression
      why-comments.

## Part D — cleanup backlog (from the 2026-07-01 full-repo audit)

Completed 2026-07-01 (waves 1-2): chat-pane satellite re-fold;
recipe-modal tab-content prop grouping + recipes-content model props;
engine-args single-sourcing (VLLM_ONLY_FLAG_KEYS / KNOWN_VLLM_EXTRA_ARG_KEYS /
EXTRA_ARG_FIELDS derived from one shared table); GPU contract unified on
`*_mb`/`utilization_pct`/`temp_c` with one `normalizeGpuAliases` frontend
shim; canvas/plan stores on `createSessionScopedJsonStore`;
skill-discovery/prompt-templates on `discovery-core`; vision flag threaded
into `browserContextPrompt`; `ActiveSession` derived via Pick;
runtime wire types schema-derived (no casts); `isRecord` single-sourced in
`src/lib/guards`; projects-nav barrel dropped; ui-kit single-consumer
components moved into features + model-card fetch hook extracted;
environments page in the feature layer; `use-realtime-status` wrapper and
dead test-seam exports deleted; engine-capabilities spread; store.ts
listeners behind `initAppStoreListeners()`; usage payloads typed end-to-end
and SortField/SortDirection moved into the usage feature.

Remaining:

- [ ] vLLM/SGLang recipe tabs hand-write JSX per field with parser catalogs
      trapped in JSX (`tab-features.tsx`) — move onto the data-driven
      `LlamacppOption`-style table + `EngineOptionsSection` renderer.
- [x] `cli/CLI_REFERENCE.md` controller-API snapshot cut; points at the live
      `/docs` swagger (2026-07-01).
- [ ] `docker-compose.yml` provisions a foreign postgres for litellm — left
      in place deliberately: `deploy-remote.sh` rsyncs it by path and the
      remote host runs it live; move only with a coordinated deploy change.
- [ ] Desktop artifact versioning: electron-builder stamps artifacts and the
      self-hosted update feed (`LOCAL_STUDIO_UPDATE_URL` + latest.yml) from
      `frontend/package.json` (0.2.9), while semantic-release tags an
      unrelated v1.57.x stream from commits. Two version streams that never
      meet — align them (bump frontend version in the desktop:dist flow from
      the latest tag, or add a release step that PRs the version bump).
      Until then the package.json versions must NOT be hand-edited: the
      update feed compares against them.

## Open issues

- `engine-spec.ts` → `specs/*` → `backend-builder.ts` → `engine-spec.ts`
  module cycle survives only because lookup defers to call time — move the
  arg/docker helpers the specs need into a leaf module.
- `DEFAULT_CANONICAL_PYTHON_PATH` (`configs.ts`) ranks a machine-specific
  `/opt/venvs` path above the managed venv — demote it.
- `createEngineJob` remaps cuda/rocm jobs to `backend: "vllm"` — add
  "cuda"/"rocm" to `EngineJob["backend"]` instead.
