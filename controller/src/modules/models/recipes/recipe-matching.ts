import { basename } from "node:path";
import type { ProcessInfo, Recipe } from "../types";

export interface RecipeMatchOptions {
  allowCurrentContainsRecipePath?: boolean;
  allowEitherPathContains?: boolean;
}

const normalizeModelPath = (path: string): string => path.replace(/\/+$/, "");

// True when `ancestor` equals `descendant` or is a parent directory of it, using
// path-segment boundaries. A plain substring check would treat `/models/llama`
// as matching `/models/llama-3.1-8b` — a different model — so use a "/" boundary.
const isPathPrefix = (ancestor: string, descendant: string): boolean =>
  descendant === ancestor || descendant.startsWith(`${ancestor}/`);

/**
 * Rank how well a running process matches a recipe. 0 = no match; higher is
 * a more specific match:
 * 4) served_model_name equality (case-insensitive)
 * 3) normalized exact model path equality
 * 2) optional contains-style path match (route-specific)
 * 1) model path basename fallback
 * Shared by isRecipeRunning (rank > 0) and selectRunningRecipe (best rank
 * wins) so the boolean and the exclusive selection can never drift apart.
 */
const recipeMatchRank = (
  recipe: Recipe,
  current: ProcessInfo,
  options: RecipeMatchOptions = {},
): number => {
  const canonicalName = (recipe.served_model_name ?? "").toLowerCase();
  if (
    canonicalName &&
    current.served_model_name &&
    current.served_model_name.toLowerCase() === canonicalName
  ) {
    return 4;
  }

  if (!current.model_path) {
    return 0;
  }

  const recipePath = normalizeModelPath(recipe.model_path);
  const currentPath = normalizeModelPath(current.model_path);

  if (recipePath === currentPath) {
    return 3;
  }

  if (options.allowEitherPathContains) {
    if (isPathPrefix(currentPath, recipePath) || isPathPrefix(recipePath, currentPath)) {
      return 2;
    }
  } else if (options.allowCurrentContainsRecipePath) {
    if (isPathPrefix(recipePath, currentPath)) {
      return 2;
    }
  }

  // Basename fallback ONLY when one side lacks directory context (e.g. the
  // running process reports just a filename). Comparing basenames of two full
  // paths with different parents would falsely match distinct models that
  // happen to share a filename (/a/model.gguf vs /b/model.gguf), reporting a
  // launch as already-running and silently serving the wrong model.
  if (!recipePath.includes("/") || !currentPath.includes("/")) {
    return basename(recipePath) === basename(currentPath) ? 1 : 0;
  }
  return 0;
};

/**
 * Determine whether a running process matches a given recipe.
 * Matching order:
 * 1) served_model_name (case-insensitive)
 * 2) normalized exact model path
 * 3) optional contains-style path match (route-specific)
 * 4) model path basename
 * @param recipe - Recipe to match against.
 * @param current - Current process info.
 * @param options - Matching options.
 * @returns True if the process matches the recipe.
 */
export const isRecipeRunning = (
  recipe: Recipe,
  current: ProcessInfo,
  options: RecipeMatchOptions = {},
): boolean => recipeMatchRank(recipe, current, options) > 0;

/**
 * Pick the single recipe that best explains the running process. Several
 * recipes can share a model path (e.g. three glm-5.2 recipes over one weights
 * directory), and with the contains-style fallback every one of them "runs"
 * whenever the shared path is loaded — so a boolean per recipe marks them all
 * active. This ranks the candidates (served_model_name equality, then exact
 * path equality, then the path-contains fallback, then basename) and returns
 * only the best; on a rank tie the first recipe in list order wins.
 * @returns The best-matching recipe, or null when nothing matches.
 */
export const selectRunningRecipe = <R extends Recipe>(
  recipes: readonly R[],
  current: ProcessInfo,
  options: RecipeMatchOptions = {},
): R | null => {
  let best: R | null = null;
  let bestRank = 0;
  for (const recipe of recipes) {
    const rank = recipeMatchRank(recipe, current, options);
    if (rank > bestRank) {
      best = recipe;
      bestRank = rank;
    }
  }
  return best;
};
