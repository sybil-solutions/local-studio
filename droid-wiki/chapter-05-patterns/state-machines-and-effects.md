# Pattern 1 — Pure state machines + effects

The PR commits to a single state-machine idiom, used identically on both the
controller and the frontend. A machine is a **pure transition function**

```ts
type Transition<State, Event, Context, Effect> =
  (state: State, context: Context, event: Event) =>
    { state: State; effects: Effect[] };
```

wrapped in a thin container (`createStateMachine`) that holds the latest
state and offers `dispatch(event, context) → { state, effects }`,
`setState(next)`, and `reset()`. The transition function is **never allowed
to perform IO**; it returns an array of effect descriptors that the caller
executes at the edge.

The shared definition lives in two places that are byte-for-byte identical
(the type duplication is the cost of dissolving the `shared/` workspace
package — see Chapter 4 — `shared-package-dissolution.md`):

- `controller/src/modules/shared/state-machine.ts`
- `frontend/src/lib/state-machine.ts`

## Where it appears

| File | What the machine models |
|------|-------------------------|
| `controller/src/modules/engines/layers/download-machine.ts` | HuggingFace download lifecycle: `idle → queued → downloading → verifying → ready/error/canceled/paused`. Effects: `EMIT_EVENT`, `STORE_PROGRESS`, `LOG`, `DOWNLOAD_FILE`, `VERIFY_CHECKSUM`, `FETCH_FILE_LIST`. |
| `controller/src/modules/engines/layers/engine-coordinator.ts` | The lifecycle orchestrator (`EngineCoordinator`). Not built on top of `createStateMachine` directly, but encodes the same pattern: explicit "active recipe" state, explicit transitions, side-effects (spawn / kill / publish event) at the edge. |
| `frontend/src/hooks/use-model-lifecycle.ts` | Renderer-side derivation of model lifecycle status (`idle | starting | ready | error`) from `useRealtimeStatus().launchProgress.stage`. |
| `frontend/src/app/recipes/_components/vllm-runtime-panel-machine.ts` | Runtime panel UI state for vLLM/SGLang/llama.cpp/CUDA/ROCm — load + upgrade workflow with explicit `runtime/load/{request,success,failure}` and `upgrade/{request,success,failure}` events. |
| `frontend/src/hooks/use-machine.ts` | The React adapter for any `StateMachineContainer`. |

## Anatomy of a transition (download machine)

```ts
const transition: TransitionFn = (current, event) => {
  switch (current.state) {
    case "downloading": {
      if (event.type === "PROGRESS") {
        return {
          state: { ...current,
            downloadedBytes: event.bytes,
            totalBytes: event.total,
            currentFile: event.currentFile },
          effects: [
            { type: "EMIT_EVENT", event: "download_progress",
              payload: { id: current.downloadId, ... } },
            { type: "STORE_PROGRESS",
              downloadedBytes: event.bytes, totalBytes: event.total },
          ],
        };
      }
      ...
```

Notes:

- The function never calls `eventManager.publish(...)` directly. It returns
  `{ type: "EMIT_EVENT", ... }` and the caller does the publish.
- All transitions are total: any state/event pair returns either a real
  transition or `{ state: current, effects: [] }` (the trailing
  `return { state: current, effects };` in the catch-all).
- Terminal states (`ready`, `canceled`) accept no events.

## Why this pattern

- **Testability.** The transition function is a pure data-in/data-out
  reducer. Asserting `transition(state, event).state === expected` is a
  one-liner; no mocks, no fakes, no scheduler.
- **Auditability.** All state transitions are visible in one switch
  statement. New states require touching the union and at least one case.
- **Effect isolation.** The runtime can decide *how* to execute an effect
  (queue it, batch it, drop duplicates, log it) without touching the
  transition. The same transition runs on Bun (controller) and on Node
  (Next API routes) and conceptually in the browser, with three different
  effect runners.
- **No hidden orderings.** Effects come back in a deterministic array. The
  caller chooses ordering and parallelism.

## Trade-offs

- **Boilerplate.** Tagged-union events + tagged-union effects + explicit
  state union are wordy. The `download-machine.ts` file is 277 LoC, and a
  meaningful slice of that is event/effect type declarations.
- **Effects drift.** Because effects are interpreted by the caller, it is
  possible for a new effect type to be added to the machine but not yet
  handled by the runtime — the compiler will catch the union-exhaustiveness
  case but only if the runtime uses a `switch (effect.type)` with no
  default. The download manager's runner currently does this; the
  vllm-runtime-panel-machine has `RuntimePanelEffect = never` and dodges
  the problem entirely.
- **Reset semantics are crude.** `reset()` snaps to `initialState` without
  emitting effects. Anything that needs to "tear down" a state on reset has
  to do so manually before calling `reset()`. The download machine works
  around this because terminal states (`ready`, `canceled`) are inert.
- **No history / no nesting.** This is a flat machine, not a Statechart.
  Hierarchical states or guards have to be inlined.

## Cross-references

- [Chapter 1 — `stores-and-state.md`](../chapter-01-frontend/stores-and-state.md) — how `useMachine` wires this into the agent surface.
- [Chapter 2 — `engines-module.md`](../chapter-02-controller/engines-module.md) — the download machine in context of the engine coordinator.
- [Chapter 4 — `shared-package-dissolution.md`](../chapter-04-anything-else/shared-package-dissolution.md) — why the same `state-machine.ts` exists twice.
- [Pattern 11 — State-machine UI hook](./state-machine-ui-hook.md) — the React adapter.
