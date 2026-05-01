"use client";

import { useCallback, useState } from "react";
import type {
  StateMachineContainer,
  StateMachineTransitionResult,
} from "@/lib/state-machine";

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

  return {
    state: machineState,
    dispatch,
  };
}
