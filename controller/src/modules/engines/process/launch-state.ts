import { randomUUID } from "node:crypto";

export interface LaunchAttempt {
  readonly attemptId: string;
  readonly recipeId: string;
}

export interface LaunchStateSnapshot {
  readonly phase: "idle" | "launching";
  readonly recipeId: string | null;
}

export type LaunchAcquisition =
  | { readonly acquired: true; readonly attempt: LaunchAttempt }
  | { readonly acquired: false; readonly activeAttempt: LaunchAttempt };

export interface LaunchState {
  getActiveAttempt: () => LaunchAttempt | null;
  getLaunchingRecipeId: () => string | null;
  getState: () => LaunchStateSnapshot;
  release: (attemptId: string) => boolean;
  tryAcquire: (recipeId: string) => LaunchAcquisition;
}

export const createLaunchState = (): LaunchState => {
  let activeAttempt: LaunchAttempt | null = null;
  return {
    getActiveAttempt: (): LaunchAttempt | null => activeAttempt,
    getLaunchingRecipeId: (): string | null => activeAttempt?.recipeId ?? null,
    getState: (): LaunchStateSnapshot => ({
      phase: activeAttempt ? "launching" : "idle",
      recipeId: activeAttempt?.recipeId ?? null,
    }),
    release: (attemptId: string): boolean => {
      if (activeAttempt?.attemptId !== attemptId) return false;
      activeAttempt = null;
      return true;
    },
    tryAcquire: (recipeId: string): LaunchAcquisition => {
      if (activeAttempt) return { acquired: false, activeAttempt };
      const attempt = Object.freeze({ attemptId: randomUUID(), recipeId });
      activeAttempt = attempt;
      return { acquired: true, attempt };
    },
  };
};
