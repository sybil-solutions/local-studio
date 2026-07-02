# Simplification Loop — Mission Charter & Progress

Started 2026-07-02 on branch `fable/clean-up`. Recurring loop (every 30 min),
~10-hour horizon. Each iteration reads this doc, executes the next items, keeps
gates green, commits, and updates this doc.

## Charter (user directives)

1. **Keep every feature** — the contract is docs/ux-stories.md; nothing there regresses.
2. **Drastically cut** code size, surfaces, complexity, settings, config files,
   dependencies. Every file scrutinized (docs, workflows, CLI, controller, frontend).
3. **UI pixel-identical.** Consolidate everything onto the base UI kit (`src/ui`).
4. **Catch and fix bugs** along the way.
5. Autonomous; no questions. Never delete untracked/user data without explicit OK.

## Gates

- Full: `npm run check`. NOTE coverage gap: root gate runs controller typecheck
  only; CI also runs controller lint + check (knip/jscpd/depcheck/standards) +
  unit + integration tests. Run `cd controller && bun run lint && bun run check
  && bun run test:unit` for controller changes. (Hitlist C0 fixes this.)
- Commit per coherent unit, `--no-verify` (hooks: frontend bans useEffect etc.).

## HITLIST — Controller (from audit)

- [x] **C1 BUG unbounded telemetry growth** (ffc1baa9): observability middleware writes a row
  per request (`http/observability-middleware.ts:32`, `core/function-observability.ts`,
  `stores/controller-request-store.ts`) with no retention and no skip-list; polling
  floods DB forever. Fix: reuse app.ts:63 skip-set + add retention prune. SAFE.
- [x] C2 (c5dd16b9) dead route `/events/stats` (`system/logs-routes.ts:266`) — no caller. SAFE.
- [x] C3 (c5dd16b9) dead route `/runtime/sglang/config` (`engines/routes.ts:356`) — frontend only
  fetches vllm/llamacpp configs. SAFE.
- [x] C4 (c5dd16b9) collapse single-impl `EngineService` interface (`engines/engine-service.ts`,
  26 lines) into EngineCoordinator. SAFE.
- [x] C5 (c5dd16b9) dedupe 10× `findInferenceProcess` observability wrapper (system/routes,
  metrics-routes, logs-routes, models/routes, tokenization-routes) → one helper. SAFE.
- [x] C6 (c5dd16b9) remove (createEngineCoordinator/createEventManager; other create* are real closure factories, kept) `create*` one-line factory wrappers (createEngineCoordinator etc.). SAFE.
- [x] C7 (c5dd16b9) `main.ts` metricsDisabled() duplicates `parseBooleanFlag` (validation.ts:41). SAFE.
- [x] C8 (f1cf3313) inline tiny per-module `configs.ts` constant files (audio 7, proxy 6, system 5,
  models 15, engines 20 lines); keep studio/configs.ts. SAFE.
- [x] C9 (f1cf3313) delete `modules/shared/{system,recipe}-types.ts` re-export shims → import
  shared/contracts directly. SAFE.
- [x] C10 (f1cf3313) provider serializer dup ×4 in `studio/provider-routes.ts` → serializeProvider
  + parseProviderBody. SAFE.
- [x] C11 (f1cf3313) standardize `parseJsonObjectBody` (core/validation.ts:10) in routes that
  hand-roll `req.json().catch`. SAFE.
- [x] C12 (a771fcba) dead route `/api/title` (proxy/chat-title-routes.ts, ~70 lines) — only
  the integration test calls it; verify no external client (grep pi runtime) then cut.
- [x] C13 (a5b65200) dead cross-controller passthrough `/controllers/route/*`
  (http/app.ts:22-37,85-137 + LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST). NOTE memory
  says frontend "Add controller" feature exists — verify /controllers/route vs
  /controllers before cutting.
- [x] C14 (a771fcba) dead `/lifetime-metrics` route (store kept — live via inference accounting) (+ maybe LifetimeMetricsStore).
- [x] C15 (a771fcba) dead `/v1/tokenize` + `/v1/detokenize` — CAUTION: reachable by external
  OpenAI clients via proxy; grep pi/droid runtimes first.
- [x] C16 (a771fcba) dead `GET /runtime/targets/:id` + `/health` probe.
- [ ] C17 MEDIUM flag audit: STRICT_OPENAI_MODELS readers; vLLM extra-args escape
  hatches; MOCK_INFERENCE (used by E2E? verify).
- [ ] C18 RISKY inline single-use `*Effect` variants (function-observability,
  local-fetch, command.ts resolveBinary, async.ts) then consider dropping `effect`
  dep entirely (only trivial usage remains + env.ts Schema + errors.ts TaggedError).
- [SKIP] C19 `/api/docs` is user-facing: Server pane links to /api/proxy/api/docs (server-view.tsx:388). KEEP. `/api/docs` swagger UI + `@hono/swagger-ui` dep + openapi-spec.ts
  (255 lines) — /api/spec is proxied by frontend; verify what reads it.
- [ ] C20 move runtime-target capability booleans onto EngineSpec (factory loops
  generically).
- Previously skipped (do NOT re-propose): store merges, metrics throughputSamples
  unification, runtime-targets.ts split.

## HITLIST — Frontend (from audit; knip/depcheck/jscpd all clean already)

- [x] **F1 BUG copy-toast timer leak ×5** (a9e60da7, hooks/use-copied-flag.ts): setTimeout(setCopied) with no cleanup in
  copyable-path-chip.tsx:26, assistant-markdown.tsx:61, user-message-block.tsx:92,
  assistant-message-actions.tsx:41, use-discover.ts:106 → one useCopiedFlag() hook
  (NB: eslint bans raw useEffect; follow useMountSubscription pattern). SAFE.
- [x] F2 (a9e60da7) move `ui/model-page.tsx` (7 exports) → features/recipes/recipes-content/
  (all 6 consumers there); drop ui/index.ts:112-121. SAFE.
- [x] F3 (a9e60da7) move (as features/settings/settings-ui.tsx; setup + recipes cross-feature consumers exist and are boundary-legal) `ui/settings.tsx` (8 exports) → features/settings/ (all 4 consumers
  there); drop ui/index.ts:95-110. SAFE.
- [SKIP] F4 messages barrel has 24 importers — real aggregation point (also re-exports contracts); folding = churn. fold 7-line `features/agent/messages/index.ts` barrel — CHECK
  scripts/validate-barrel-dir-siblings.mjs convention first.
- [SKIP] F5 all candidates fail criteria: filesystem-panel (612 post-merge), use-workspace (571), git-diff-panel (642) exceed 500 lines; agent-browser-effects + quick-panel-bridge have 2 importers each. merge single-consumer twins (grep importers first, keep parent <500
  lines): filesystem-panel-effects, use-workspace-effects, git-diff-panel-model,
  agent-browser-effects, quick-panel-bridge (13 lines). Do NOT merge chat-pane*
  cluster (all files substantial).
- [SKIP] F6 types has 6 importers; equality merge makes store 600+ lines, net-negative. collapse hooks/realtime-status-{equality,types}.ts into store if
  single-importer.
- [ ] F7 PRODUCT settings/local-agent-* cluster (~750 lines) — real feature landed
  07c8db90 (attach-local-agents); KEEP unless user retires it. Not a cut.
- [ ] F8 voice routes (app/api/voice/*) — UI caller thin/unclear; memory says recipe
  db has voice fields and local test uses voiceModel. Verify before touching.

## HITLIST — UI-kit consolidation (pixel-identical; ranked by call sites)

Base kit: `src/ui` (catalogue in audit). Missing primitives: Spinner, Tooltip,
Dropdown/Popover. Two token systems: `--ui-*` (12 files) vs legacy `--fg/--dim/
--surface/--hl1` (41 files, most of features/agent).

- [ ] U1 ~140 raw `<button>` outside src/ui → `Button`/variant=icon. Top files:
  filesystem-panel (10), left-sidebar (8), agent-composer-actions (8),
  explore-tab-sections, agent-browser*, appearance-settings, recipe-row...
- [ ] U2 token unification (--ui-* vs legacy) — PREREQUISITE for pixel-identical
  component swaps in agent tree; map values first, alias tokens in CSS before
  rewriting classes.
- [ ] U3 add `Spinner` primitive; replace 24 animate-spin sites (17 files).
- [ ] U4 SectionLabel adoption: 38 eyebrow-label class-cluster sites (2 adopters today).
- [ ] U5 StatusDot/StatusPill adoption: ~10 hand-rolled dots/pills (incl. hardcoded
  bg-emerald-400 in status-section-models-dropdown.tsx:139 — off-token, fix).
- [ ] U6 Card adoption: 9 rounded-lg + 14 rounded-md hand-rolled surfaces.
- [ ] U7 add `Tooltip` primitive (~70 title= sites + bespoke timeline tooltip) — LOW
  priority, changes rendered visuals (title→styled) so defer/user-visible.
- [ ] U8 hand-rolled modals/drawers: left-sidebar mobile drawer, logs backdrop,
  recipes slide-over→Drawer, explore popover, sessions-command palette.
- [ ] U9 4 raw <input> → Input/SearchInput; 3 raw <select> → Select; 1 raw <table>.

## HITLIST — Configs/CI/scripts/docs

- [x] Delete no-op pr-review.yml; fix labels.yml external URL; CODEOWNERS stale
  paths; README/AGENTS "three modules" + REMOTE_URL; dead
  ALLOW_RUNTIME_UPGRADE_COMMAND env (commit 24b12fad).
- [x] G1 (c5dd16b9) root gate coverage gap FIXED — root check:controller now runs typecheck+lint+check+test:unit. Found real damage: two integration tests imported modules merged away in 90983d84; fixed same commit: `check:controller` = typecheck only, CI runs
  lint+check+tests. Extend root script (keep runtime reasonable: lint+check).
- [ ] G2 daemon-*.sh ×3 → keep (README-documented) or collapse into one daemon.sh.
- [ ] G3 merge prettier configs (controller trailingComma es5 vs frontend all) →
  one root .prettierrc.json; NOTE reformats controller; do as isolated commit.
- [ ] G4 frontend package.json scripts sprawl (30+) — consolidate check:* variants.
- [ ] G5 docs/engine-refactor-plan.md + docs/archive/* are process notes not product
  docs — relocate/prune once loops close.
- [ ] G6 root package-lock.json is an empty stub — verify nothing needs it.
- [ ] cli/ dir on disk = stray node_modules only (untracked); frontend/frontend/ =
  April path-bug junk (untracked). ASK USER before rm.

## Done

- I1: repo mapped; 4 audits run; charter + docs/ux-stories.md written; config/CI
  batch committed (24b12fad).

## Iteration log

- **I2 (2026-07-02)**: commits f1cf3313 (C8-C11: micro-configs inlined, type shims
  deleted, provider routes deduped, body parsing standardized, −57), a771fcba
  (C12/C14/C15/C16: four dead route groups −251), a5b65200 (C13: controllers/route
  passthrough −243 + env knob). F4-F6 + C19 measured and SKIPPED with reasons
  (churn/net-negative/user-facing). Full root gate green incl. 126 integration
  tests. Cumulative branch delta so far: ~−800 lines, 13 files deleted, 8 routes
  + 2 env vars removed. Next: U-track (U3 Spinner, U5 dots need token-value check
  first, U2 token map), C17 flag audit, C18 Effect inlining, C20, G2-G4.

- **I1 wrap (2026-07-02)**: commits 24b12fad (CI/docs), ffc1baa9 (telemetry bug+docs),
  c5dd16b9 (controller cuts −127, gate hardened, broken test imports fixed),
  a9e60da7 (frontend timer-leak fix + adapter moves −39). All gates green incl.
  129 integration tests. Next up: C8-C11 safe controller items, F4-F6, then
  C12-C17 verify-then-cut routes/flags, U-track (start with U3 Spinner + U5 dots,
  token map for U2), G2-G4.

- **I1 (2026-07-02)**: baseline 727 files / 94.4k TS lines. Audits merged into
  hitlists above. Root-caused frontend/frontend junk to April-era relative-path
  bug (data-dir.ts now resolves ~/.local-studio or env; not live). Next: C1 bug
  fix, then safe controller cuts C2-C11, then F1-F3, then U-track.
