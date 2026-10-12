export interface LaunchFailureBudgetSnapshot {
  recipe_id: string;
  failure_count: number;
  limit: number;
  window_ms: number;
  reset_at: string;
  blocked: boolean;
}

export interface LaunchFailureBudget {
  get(recipeId: string): LaunchFailureBudgetSnapshot | null;
  isBlocked(recipeId: string): LaunchFailureBudgetSnapshot | null;
  listActive(): LaunchFailureBudgetSnapshot[];
  recordFailure(recipeId: string): LaunchFailureBudgetSnapshot;
  reset(recipeId: string): void;
}

export const LAUNCH_FAILURE_LIMIT = 3;
export const LAUNCH_FAILURE_WINDOW_MS = 10 * 60 * 1000;

export const formatLaunchFailureBudgetMessage = (snapshot: LaunchFailureBudgetSnapshot): string => {
  return `Launch crash-loop budget exhausted for ${snapshot.recipe_id}: ${snapshot.failure_count}/${snapshot.limit} failed attempts in ${Math.round(snapshot.window_ms / 60_000)} minutes. Edit the recipe or retry after ${snapshot.reset_at}.`;
};

export const createLaunchFailureBudget = (
  limit = LAUNCH_FAILURE_LIMIT,
  windowMs = LAUNCH_FAILURE_WINDOW_MS,
): LaunchFailureBudget => {
  const failuresByRecipe = new Map<string, number[]>();

  const prune = (recipeId: string, now = Date.now()): number[] => {
    const cutoff = now - windowMs;
    const kept = (failuresByRecipe.get(recipeId) ?? []).filter((timestamp) => timestamp > cutoff);
    if (kept.length > 0) {
      failuresByRecipe.set(recipeId, kept);
    } else {
      failuresByRecipe.delete(recipeId);
    }
    return kept;
  };

  const snapshot = (recipeId: string, failures: number[]): LaunchFailureBudgetSnapshot | null => {
    if (failures.length === 0) return null;
    const oldest = Math.min(...failures);
    return {
      recipe_id: recipeId,
      failure_count: failures.length,
      limit,
      window_ms: windowMs,
      reset_at: new Date(oldest + windowMs).toISOString(),
      blocked: failures.length >= limit,
    };
  };

  return {
    get(recipeId): LaunchFailureBudgetSnapshot | null {
      return snapshot(recipeId, prune(recipeId));
    },
    isBlocked(recipeId): LaunchFailureBudgetSnapshot | null {
      const current = snapshot(recipeId, prune(recipeId));
      return current?.blocked ? current : null;
    },
    listActive(): LaunchFailureBudgetSnapshot[] {
      const now = Date.now();
      return [...failuresByRecipe.keys()]
        .map((recipeId) => snapshot(recipeId, prune(recipeId, now)))
        .filter((entry): entry is LaunchFailureBudgetSnapshot => entry !== null);
    },
    recordFailure(recipeId): LaunchFailureBudgetSnapshot {
      const failures = prune(recipeId);
      failures.push(Date.now());
      failuresByRecipe.set(recipeId, failures);
      return snapshot(recipeId, failures)!;
    },
    reset(recipeId): void {
      failuresByRecipe.delete(recipeId);
    },
  };
};
