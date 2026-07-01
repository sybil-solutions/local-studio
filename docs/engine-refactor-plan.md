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

- [ ] chat-pane satellite re-fold: `chat-pane-derived-state.ts` (35),
      `chat-pane-runtime-handle.ts` (58), `chat-pane-ui-effects.ts` (140) are
      single-consumer fragments of `chat-pane.tsx` — fold back or justify.
- [ ] `recipe-modal/tabs/tab-content.tsx` is a 24-prop forwarding switch;
      `recipes-content.tsx` forwards 25 props — pass model objects instead.
- [ ] vLLM/SGLang recipe tabs hand-write JSX per field with parser catalogs
      trapped in JSX (`tab-features.tsx`) — move onto the data-driven
      `LlamacppOption`-style table + `EngineOptionsSection` renderer.
- [ ] `shared/contracts/engine-args.ts` `VLLM_ONLY_FLAG_KEYS` hand-mirrors
      frontend `EXTRA_ARG_FIELDS`; `recipe-command.ts` re-implements flag
      emission — single-source in the shared contract.
- [ ] GPU contract dual units (`memory_total`+`memory_total_mb`, …) in
      `shared/contracts/observability.ts` — pick one canonical set, update
      controller emitters + frontend widgets + cli, drop the unit-guessing
      heuristic in `controller/src/modules/system/metrics.ts`.
- [ ] `canvas-store.ts`/`plan-store.ts` twins → one
      `createSessionScopedJsonStore` factory; `comments-store.ts` uses sync
      fs — align when the factory lands.
- [ ] `skill-discovery.ts`/`prompt-templates-store.ts` parallel scan/contain/
      cap frameworks → shared core.
- [ ] Vision heuristics duplicated: `models.ts` `inferVisionSupport` vs
      `browser/context.ts` `modelLikelySupportsVision` — thread the resolved
      `AgentModel.vision` flag into `browserContextPrompt` and delete the
      second heuristic.
- [ ] `session-contracts.ts` `ActiveSession` hand-mirrors
      `active-sessions.ts` `ActiveAgentSessionSnapshot` — derive with Pick.
- [ ] `runtime/api.ts`: schema half-migration — kill the
      `as unknown as RuntimeEventPayload` double cast, decode
      `/runtime/status` + `/runtime/sessions` through the existing schemas.
- [ ] `isRecord` inlined 7+ times beside `guards.ts` — import it everywhere
      (or move to `src/lib`).
- [ ] `projects-nav-section.tsx` accidental barrel (re-exports helpers other
      files import through the component) + `useSessionPrefs` alias —
      repoint the 2 consumers, drop the re-exports.
- [ ] Move single-consumer ui-kit components into their features:
      `metric-visuals` → usage, `model-stop-confirm` → dashboard,
      `fact-grid` → setup, `copyable-path-chip` → agent;
      `huggingface-model-card` fetches data inside `src/ui` — extract the
      fetch hook to `src/hooks`.
- [ ] `app/environments/page.tsx` (186 lines) violates the thin-route-shell
      rule — move JSX into `features/environments/`.
- [ ] `use-realtime-status.ts` is a zero-value rename wrapper; dead
      `pollFiber` in `realtime-status-store.ts`; hand-rolled fibers where
      `lib/effect-timers.ts` exists.
- [ ] Dead test-seam exports in `hooks/use-controller-events.ts`
      (`resolveControllerEventChannel`, `dispatchControllerDomainEvent`,
      `logUnknownControllerEvent`, `isKnownControllerEvent`).
- [ ] `engine-capabilities.ts` VLLM/SGLANG blocks field-identical — spread.
- [ ] `store.ts` module-level window listeners on import — move into an
      explicit init called from providers; delete dead `lastWasMobile`.
- [x] `proxy-target.ts` desktop-mode flag — now `LOCAL_STUDIO_DESKTOP=1`,
      set by the Electron main process (2026-07-01).
- [ ] `shared/contracts/usage.ts`: controller never imports it — type the
      `/usage` handlers, shrink the frontend re-normalizer, move
      `SortField`/`SortDirection` into the usage feature.
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
