/**
 * Launch state tracker.
 */
export interface LaunchState {
  getLaunchingRecipeId: () => string | null;
  setLaunchingRecipeId: (recipeId: string | null) => void;
}

/**
 * Create a launch state tracker.
 * @returns LaunchState instance.
 */
export const createLaunchState = (): LaunchState => {
  let launchingRecipeId: string | null = null;
  return {
    getLaunchingRecipeId: (): string | null => launchingRecipeId,
    setLaunchingRecipeId: (recipeId: string | null): void => {
      launchingRecipeId = recipeId;
    },
  };
};
