import type { StateMachineContainer } from "../../shared/state-machine";
import { createStateMachine } from "../../shared/state-machine";

export type LaunchPhase = "idle" | "launching" | "preempting";

export interface LaunchStateSnapshot {
  phase: LaunchPhase;
  recipeId: string | null;
}

export type LaunchStateEvent =
  | {
      type: "set";
      recipeId: string | null;
    }
  | {
      type: "start";
      recipeId: string;
    }
  | {
      type: "preempt";
      recipeId: string;
    }
  | {
      type: "clear";
    };

export interface LaunchState {
  getLaunchingRecipeId: () => string | null;

  setLaunchingRecipeId: (recipeId: string | null) => void;

  getState: () => LaunchStateSnapshot;

  transition: (event: LaunchStateEvent) => void;

  markLaunching: (recipeId: string) => void;
  markPreempting: (recipeId: string) => void;
  markIdle: () => void;
}

const reducer = (state: LaunchStateSnapshot, event: LaunchStateEvent): LaunchStateSnapshot => {
  switch (event.type) {
    case "set": {
      if (event.recipeId === null) {
        return { ...state, phase: "idle", recipeId: null };
      }
      return {
        ...state,
        phase: state.phase === "idle" ? "launching" : "preempting",
        recipeId: event.recipeId,
      };
    }
    case "start":
      return { phase: "launching", recipeId: event.recipeId };
    case "preempt":
      return { phase: "preempting", recipeId: event.recipeId };
    case "clear":
      return { phase: "idle", recipeId: null };
    default:
      return state;
  }
};

export const createLaunchState = (): LaunchState => {
  const machine: StateMachineContainer<LaunchStateSnapshot, LaunchStateEvent, undefined, never> =
    createStateMachine<LaunchStateSnapshot, LaunchStateEvent, undefined, never>({
      initialState: {
        phase: "idle",
        recipeId: null,
      } as LaunchStateSnapshot,
      transition: (state, _, event) => ({
        state: reducer(state, event),
        effects: [],
      }),
    });

  return {
    getLaunchingRecipeId: (): string | null => machine.state.recipeId,
    setLaunchingRecipeId: (recipeId: string | null): void => {
      machine.dispatch({ type: "set", recipeId }, undefined);
    },
    getState: (): LaunchStateSnapshot => machine.state,
    transition: (event: LaunchStateEvent): void => {
      machine.dispatch(event, undefined);
    },
    markLaunching: (recipeId: string): void => {
      machine.dispatch({ type: "start", recipeId }, undefined);
    },
    markPreempting: (recipeId: string): void => {
      machine.dispatch({ type: "preempt", recipeId }, undefined);
    },
    markIdle: (): void => {
      machine.dispatch({ type: "clear" }, undefined);
    },
  };
};
