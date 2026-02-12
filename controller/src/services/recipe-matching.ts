// CRITICAL
import { basename } from "node:path";
import type { ProcessInfo, Recipe } from "../types/models";

export interface RecipeMatchOptions {
  allowCurrentContainsRecipePath?: boolean;
  allowEitherPathContains?: boolean;
}

const normalizeModelPath = (path: string): string => path.replace(/\/+$/, "");

/**
 * Determine whether a running process matches a given recipe.
 * Matching order:
 * 1) served_model_name (case-insensitive)
 * 2) normalized exact model path
 * 3) optional contains-style path match (route-specific)
 * 4) model path basename
 */
export const isRecipeRunning = (
  recipe: Recipe,
  current: ProcessInfo,
  options: RecipeMatchOptions = {},
): boolean => {
  const canonicalName = (recipe.served_model_name ?? "").toLowerCase();
  if (
    canonicalName
    && current.served_model_name
    && current.served_model_name.toLowerCase() === canonicalName
  ) {
    return true;
  }

  if (!current.model_path) {
    return false;
  }

  const recipePath = normalizeModelPath(recipe.model_path);
  const currentPath = normalizeModelPath(current.model_path);

  if (recipePath === currentPath) {
    return true;
  }

  if (options.allowEitherPathContains) {
    if (recipePath.includes(currentPath) || currentPath.includes(recipePath)) {
      return true;
    }
  } else if (options.allowCurrentContainsRecipePath) {
    if (currentPath.includes(recipePath)) {
      return true;
    }
  }

  return basename(recipePath) === basename(currentPath);
};

