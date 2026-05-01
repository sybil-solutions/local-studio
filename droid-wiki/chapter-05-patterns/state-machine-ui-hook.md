# Pattern 11 — State-machine UI hook

The `useMachine(machine, context)` hook is the React adapter for any
`StateMachineContainer<State, Event, Context, Effect>`. It mirrors
`useReducer` but defers the reducer to the underlying machine and returns
the raw `dispatch` result (state + effects) so that the caller can run
effects.

## The implementation

`frontend/src/hooks/use-machine.ts` (29 LoC, the entire file):

```ts
"use client";
import { useCallback, useState } from "react";
import type { StateMachineContainer, StateMachineTransitionResult } from "@/lib/state-machine";

export interface UseMachineResult<State, Event, Effect> {
  state: State;
  dispatch: (event: Event) => StateMachineTransitionResult<State, Effect>;
}

export function useMachine<State, Event, Context, Effect>(
  machine: StateMachineContainer<State, Event, Context, Effect>,
  context: Context,
): UseMachineResult<State, Event, Effect> {
  const [machineState, setMachineState] = useState<State>(() => machine.state);

  const dispatch = useCallback(
    (event: Event) => {
      const result = machine.dispatch(event, context);
      setMachineState(result.state);
      return result;
    },
    [context, machine],
  );

  return { state: machineState, dispatch };
}
```

The hook is intentionally minimal:

- It does **not** auto-run effects. The caller decides when and how to
  execute the returned `result.effects`.
- It returns the latest state via `useState`, but the *machine* still owns
  authoritative state. The hook is a renderer-side projection.
- Re-mounting the hook with a fresh `machine` instance (e.g., from
  `useMemo`) resets the snapshot to that machine's `initialState`.

## Where it appears

| Consumer | Machine | Notes |
|----------|---------|-------|
| `frontend/src/app/recipes/_components/vllm-runtime-panel-machine.ts` (created via `createStateMachine`) | Runtime panel UI | The recipes page uses a long-running `useMachine(...)` to drive the load + upgrade workflow with explicit `runtime/load/{request,success,failure}` events. |
| `frontend/src/hooks/use-model-lifecycle.ts` | Model lifecycle status | Doesn't use `useMachine` directly — it derives `idle | starting | ready | error` from `useRealtimeStatus().launchProgress.stage` via a `useMemo`. Still expresses the same machine-as-derived-state pattern. |
| (other UI panels) | various | Anywhere a multi-step workflow needs explicit state, the convention is to author a `*-machine.ts` and consume it via `useMachine`. |

## Why this pattern

- **Same machine, two runtimes.** A machine compiled for the controller
  (Bun) and the renderer (browser/Node) shares the same transition
  function. Tests run identically on both.
- **Effects under caller control.** The renderer can render before
  running effects (good for snappy UI), batch them, or filter them based
  on UI mode.
- **Cheap snapshot semantics.** `useState` with `machine.state` as the
  initializer means "the snapshot at hook-mount time". The machine
  itself can survive across renders if held in `useRef`/module scope.
- **Composable with `useEffect`.** Because `dispatch` returns the
  effects array, a calling component can do something like:

  ```ts
  const onClick = () => {
    const { effects } = dispatch({ type: "upgrade/request", backend: "vllm" });
    runEffects(effects);
  };
  ```

## Trade-offs

- **Two sources of truth.** The hook's `useState` and the machine's
  internal `currentState` can drift if `machine.setState()` or
  `machine.reset()` is called outside the hook. There is no
  re-subscription mechanism.
- **No batched dispatch.** Each `dispatch` triggers a `setState`. Two
  events fired synchronously cause two re-renders unless the caller
  batches manually.
- **Re-binding on context change.** `useCallback` depends on `context`;
  if `context` is re-created every render (e.g., a freshly-allocated
  object), `dispatch`'s identity changes every render too. Most
  consumers pass `undefined` or a stable reference.
- **No selector / memoization.** Every state change re-renders the
  component; there is no "subscribe to a slice" optimization.

## Cross-references

- [Pattern 1 — State machines + effects](./state-machines-and-effects.md) — what the hook adapts.
- [Chapter 1 — `stores-and-state.md`](../chapter-01-frontend/stores-and-state.md) — broader picture of frontend state.
