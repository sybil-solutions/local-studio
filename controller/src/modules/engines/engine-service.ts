import type { Recipe, ProcessInfo } from "../models/types";

export type { Recipe, ProcessInfo };

export type SetActiveRecipeResult = { ok: true } | { ok: false; error: string };
export type LaunchInstanceResult = { ok: true; pid: number } | { ok: false; error: string };

/** Options for setting the active recipe. */
export interface SetActiveRecipeOptions {
  signal?: AbortSignal;
}

/**
 * The single public contract for the engines module.
 * All consumers (HTTP routes, other modules, tests) use this interface.
 */
export interface EngineService {
  setActiveRecipe(
    recipe: Recipe | null,
    options?: SetActiveRecipeOptions
  ): Promise<SetActiveRecipeResult>;
  resetLaunchFailureBudget(recipeId: string): void;
  getCurrentProcess(): Promise<ProcessInfo | null>;
  waitForHealthy(timeoutMs: number): Promise<boolean>;
  launchSharedInstance(
    recipe: Recipe,
    options: { port: number; signal?: AbortSignal }
  ): Promise<LaunchInstanceResult>;
}
