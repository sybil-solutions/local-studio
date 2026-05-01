export interface StateMachineTransitionResult<State, Effect> {
  state: State;
  effects: Effect[];
}

export type StateMachineTransition<State, Event, Context, Effect> = (
  state: State,
  context: Context,
  event: Event,
) => StateMachineTransitionResult<State, Effect>;

export interface StateMachineContainer<State, Event, Context, Effect> {
  readonly state: State;
  dispatch(event: Event, context: Context): StateMachineTransitionResult<State, Effect>;
  setState(nextState: State): void;
  reset(): void;
}

interface CreateStateMachineOptions<State, Event, Context, Effect> {
  initialState: State;
  transition: StateMachineTransition<State, Event, Context, Effect>;
}

export function createStateMachine<State, Event, Context, Effect>(
  options: CreateStateMachineOptions<State, Event, Context, Effect>,
): StateMachineContainer<State, Event, Context, Effect> {
  let currentState = options.initialState;

  return {
    get state() {
      return currentState;
    },
    dispatch(event, context) {
      const transition = options.transition(currentState, context, event);
      currentState = transition.state;
      return transition;
    },
    setState(nextState) {
      currentState = nextState;
    },
    reset() {
      currentState = options.initialState;
    },
  };
}
