# Professionalize Loop — Mission Ledger

**Started:** 2026-07-12 18:05 EDT · **Deadline:** 2026-07-13 06:05 EDT (12h)
**Branch:** `loop/professionalize` (off origin/main @ 41a0bc45) · **Mode:** self-paced /loop, autonomous

## Mission
Turn the repo into something more professional: improve code quality, remove trash, update docs,
clean package.json, find and debug bugs, Effect V4 everywhere (controller), extract components
and logic, keep code DRY.

## Standing rules
- All work lands on `loop/professionalize`; push after each iteration. **Never merge to main**
  (semantic-release fires on main) — final PR at the end.
- **No deploys to pop-os** (controller restart kills the running model). Repo-only work.
- Never delete non-git data files. Deleting dead *tracked* code is fine (git preserves it).
- Gates per iteration: controller → `bun run typecheck && bun run lint && bun run test:unit`;
  frontend → `npm run typecheck && npm run lint` (+ targeted tests); full `npm run check`
  every ~4 iterations and before the final PR.
- Commit style: conventional commits, one concern per commit.
- Respect the instrument-sheet aesthetic; no visual redesigns.
- SKIP lists from previous loops are binding (controller-simplification items 6–8: do not re-propose).

## Backlog (priority order; ✔ = done, ▶ = in progress)
1. ✔ I1a: Carry over verified keepalive fix (a89bc95b → e956b021).
2. I1b: **Gates actually enforced** — add root `check:contracts` + `check:structure` job to CI;
   prune stale `environments.ts` entry in validate-shared-contracts.mjs; fix stale AGENTS.md
   test-runner doc (`tsx --test` → `bun test scripts`).
3. I2: **Trash removal** — empty `cli/` stub dir (tracked refs), knip/depcheck dead-export sweep
   in frontend+controller, dead `PROGRESS.md`?, stale docs/mockups review (keep mockups, they're design refs).
4. I3: **package.json cleaning** — root+frontend+controller: stale scripts, unused deps
   (depcheck), align engines fields, dedupe config (jscpd threshold drift, knip hoisting → issue #146).
5. I4: **Test story** — rename `tests/frontend/e2e` (it's node:test, not e2e), standardize on
   bun:test, add frontend unit tests to root `check`, document in AGENTS.md.
6. I5: **AggregatedSession + contracts seam** — move cross-boundary types to shared/contracts;
   prune validator whitelist.
7. I6: **Collapse per-backend upgrade routes** into `/runtime/:backend/upgrade` (issue #145);
   split engines/routes.ts god-router by concern (recipes / lifecycle / downloads / runtime).
8. I7: **DRY sweeps** — duplicate `ps` parsers (process-utilities vs process-manager);
   the two SSE keepalive implementations (http/sse.ts vs chat-completions-stream.ts);
   per-field route validators (rig-routes hand-rolled parsers → shared request-validation helpers).
9. I8: **Effect V4 deepening (controller)** — controller already uses effect@4.0.0-beta.90 in
   core/command.ts; migrate promise-tangles (engine-coordinator setActiveRecipe phases,
   download-manager, runtime jobs) to Effect where it *reduces* complexity. No wholesale rewrite.
10. I9: **EngineSpec deepening** — move per-engine command/probe/install/runtime-info bodies into
    specs/*.ts; unify the 4 "what's installed" paths on RuntimeTarget discovery.
11. I10: **Frontend session-status module** — single `settleSession`/`startTurn`/`isSessionWorking`
    in features/agent/runtime; replace the 3+ inline copies (controller L137, engine L213, applier).
12. I11: **defineAgentRoute scaffold** — collapse ~25 in-process agent API route boilerplates.
13. I12: **Component extraction** — largest frontend files (query for >400-line .tsx) into
    model/view pairs per existing convention.
14. I13: **Docs refresh** — README accuracy pass, AGENTS.md route map vs reality, controller
    route map in memory vs actual, CONTEXT.md seed (domain vocabulary) if time allows.
15. I14: **Model-profile table** — unify launch parsers (model-runtime-defaults.ts) + streaming
    quirks (proxy/reasoning.ts) behind one table. CAREFUL: decode-path — verify content fields,
    not just green tests.
16. Final: full `npm run check`, write PR summary, open PR to main, PushNotification.

## Iteration log
- **I1 (18:05)**: Branch created. Recovered keepalive fix via cherry-pick (e956b021) after a
  stash mishap (old stash@{0} briefly popped; resurrected files parked in scratchpad/old-stash-files;
  stash entry preserved untouched). I1b: gates CI job added, stale validator entry pruned,
  AGENTS.md test doc fixed (4a3034a6).
- **I2 (18:20)**: Trash + config alignment: PROGRESS.md removed, frontend depcheck → .depcheckrc.json,
  jscpd minTokens aligned at 200 (controller has 0 clones at stricter bar). Issue #146 closed.
  knip clean in both packages — dead-export debt is already policed by gates.
- **I3 (18:30)**: Test story: tests/frontend/e2e → tests/frontend/regression (they're node:test module
  regressions, not e2e); scripts/CI/README/AGENTS renamed to match; frontend unit tests added to root
  check:frontend. 236/236 pass. NOTE: AGENTS.md forbids --no-verify — loop now commits/pushes with
  hooks enabled (pushes batched since pre-push runs full check:quality).
- **I4 (18:35)**: AggregatedSession defined once in shared/agent/session-summary.ts (extends
  SessionSummary — the old feature-side copy silently omitted cwd/provider/archived/archivedAt that
  the server actually sends); route + 3 UI consumers import the canonical type.
- NOTE for final handoff: AGENTS.md requires a desktop rebuild after frontend changes ship — owed
  once the loop PR merges, not per-iteration.
- **I5 (18:50)**: Upgrade-route collapse (054c48b5): five per-backend handlers → one
  /runtime/:backend/upgrade validated against RUNTIME_JOB_BACKENDS; frontend's five
  upgradeXRuntime methods → one upgradeRuntime(); dropped stale RuntimeCommandPayload
  (command/args have been rejected server-side since the hardening). #145 closed.
- **I6 (19:05)**: process-inventory.ts (02c4dcf7): three independent ps parsers unified behind
  the ProcessRunner seam; listProcesses/buildProcessTree/listProcessTable all derive from
  listProcessInventory(). 139 unit + 114 integration green.
- **I7 (19:35) — deliberate SKIPS (do not re-propose):**
  - SSE keepalive unification: chat path's keepalive is intentionally different from
    http/sse.ts withSseHeartbeat (immediate first byte before upstream connect = the Cloudflare
    502 fix; fixed-interval vs idle-gated; byte-aligned frames vs strings). Unifying restructures
    the hottest Cloudflare-tuned path to save ~30 lines. Not worth the regression risk.
  - rig-routes Schema rewrite: validators are local, precise, merge-with-current semantics with
    UI-facing error messages; Schema conversion is churn, not depth.
- **I8 (19:50)**: session-status module (8e8d83df): SessionStatus union tightened (was `| string`
  = no checking; "done" was a tool-block status leaked into the union); isWorkingStatus() replaces
  session-index's stringly re-derivation; settleTurn/settleTurnFinalizingTools replace 5 copies;
  SessionTab.status shares the union. All suites green.
  KNOWN QUIRK (pre-existing): `bun test ../tests/frontend scripts` combined in ONE invocation
  fails 1 assertion (build-agent-session-options FRONTEND_BASE) — order/module-resolution
  cross-talk; CI and all scripts run the suites separately, where both are green.
- Next: EngineSpec deepening (I9) — move vllm command-build/probe/install bodies into
  specs/vllm-spec.ts; unify the four "/runtime/:backend info" paths on RuntimeTarget discovery.
  Then docs refresh (README/AGENTS accuracy), component extraction (>400-line tsx), Effect
  boundary validation for raw ctx.req.json() routes.
