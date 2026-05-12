# Production Refactor Plan

This plan follows the pulled `improve-codebase-architecture` skill vocabulary: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality, and deletion test.

## Current measured baseline

| Metric | Current value |
| --- | ---: |
| Frontend source files | 273 |
| Frontend source LOC | 38,349 |
| Source files over 500 LOC | 12 |
| `useEffect(` calls in frontend source | 66 |
| Unit/integration tests | 201 passing |
| E2E tests | 10 passing after current test alignment |
| Vitest coverage (all `src`) | 25.16% statements / 70.46% branches / 53.87% funcs / 25.16% lines |

The requested 80%+ coverage and 60% frontend LOC reduction are not safe as a single blind rewrite. The safe path is a ratchet: preserve behavior, add coverage around each seam, then delete or deepen modules.

## Deepening opportunities

1. **Agent workspace module**
   - **Files**: `frontend/src/app/agent/_components/agent-workspace-shell.tsx`, `frontend/src/app/agent/_components/use-workspace.ts`, `frontend/src/lib/agent/workspace/*`.
   - **Problem**: the Interface for workspace behavior is spread across UI props, localStorage effects, project state, pane layout, and session updates. The UI module is shallow because callers must understand most of the Implementation.
   - **Solution**: deepen the workspace module around a typed `WorkspaceController` seam. UI renders state and dispatches intents; the controller owns persistence, hydration, pane routing, and project/session selection.
   - **Benefits**: higher Locality for hydration bugs, reusable tests at the Interface, and less UI coupling.

2. **Session runtime module**
   - **Files**: `frontend/src/lib/agent/sessions/engine.ts`, `frontend/src/lib/agent/session/*`, `frontend/src/app/agent/_components/chat-pane.tsx`.
   - **Problem**: stream accumulation, queueing, replay, control messages, composer behavior, and status polling are still coupled. The deletion test says deleting the session engine would scatter SSE and replay logic back into the UI.
   - **Solution**: split typed adapters for `RuntimeStatusAdapter`, `RuntimeEventAdapter`, and `SessionReplayAdapter`; keep one deep session engine Interface for UI.
   - **Benefits**: focused replay/reattach tests, smaller functions, and safer Pi/runtime changes.

3. **Tool catalogue module**
   - **Files**: `frontend/src/lib/agent/tools/context.tsx`, `frontend/src/lib/agent/composer-context.ts`, `frontend/src/lib/agent/plugin-*`, `frontend/desktop/resources/pi-extensions/mcp-plugin.ts`.
   - **Problem**: plugin/skill discovery, composer mention rendering, and runtime loading are coupled through UI timing and mixed source shapes.
   - **Solution**: normalize all plugin/skill records at a catalogue seam and inject catalogue adapters into composer/session tests.
   - **Benefits**: no fragile plugin labels in e2e, better typed contracts, and easier Computer Use verification.

4. **Shared page state module**
   - **Files**: `frontend/src/components/ui-kit/page-state.tsx`, `frontend/src/components/ui-kit/refresh-button.tsx`, `frontend/src/app/usage/page.tsx`, `frontend/src/app/discover/_components/discover/discover-header.tsx`.
   - **Problem**: loading/error/refresh affordances were duplicated and two imports pointed at an ignored `src/ui` seam.
   - **Solution**: use a tracked UI-kit seam for shared page state and refresh controls.
   - **Benefits**: fewer missing-module failures, stable tests, and a single Interface for data-page chrome.

5. **Architecture-rule ratchet**
   - **Files**: `frontend/eslint.config.mjs`, `frontend/vitest.config.ts`, `frontend/tests/app-surfaces.spec.ts`.
   - **Problem**: strict rules existed but did not provide measurable coverage reporting, complexity visibility, or current e2e alignment.
   - **Solution**: add coverage reporting, complexity/max-depth/max-params/max-function-size warnings, and keep legacy offenders visible until refactored.
   - **Benefits**: new regressions are obvious without pretending the legacy code is already clean.

## Next ratchet order

1. Split `chat-pane.tsx` and `sessions/engine.ts` behind tests until both functions are under 500 lines.
2. Move `pane-layout` types out of `_components` into `lib/agent/workspace` to remove lib-to-app coupling.
3. Convert project/tool providers to injected adapters with tests for load, failure, and reattach behavior.
4. Raise coverage by seam, not by snapshots: session replay, workspace reducer/effects, project persistence, plugin catalogue, and API routes first.
5. Promote duplicate-import and complexity warnings to errors once the tracked warning list is empty.

## Ratchets landed

- Shared data-page states now live in `src/components/ui-kit/` with unit tests, replacing ignored `src/ui` imports.
- Pane layout is now a workspace Module at `src/lib/agent/workspace/layout.ts`; app components import the seam instead of owning shared layout types.
- `src/lib/**` now rejects imports from `@/app/*`, preventing lower-level modules from depending on UI modules again.
- Browser command execution is now a typed `src/lib/agent/browser/command.ts` Module, breaking the browser panel/use-workspace UI cycle and giving desktop/iframe behavior a direct unit-test seam.
