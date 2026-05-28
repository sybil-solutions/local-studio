"use client";

import { useMemo } from "react";
import type { RecipeWithStatus } from "@/lib/types";

type Args = {
  recipes: RecipeWithStatus[];
  filter: string;
  pinnedRecipes: Set<string>;
  runningRecipeId: string | null;
  deleteConfirm: string | null;
};

export function useRecipesDerived({
  recipes,
  filter,
  pinnedRecipes,
  runningRecipeId,
  deleteConfirm,
}: Args) {
  const modelServedNames = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const r of recipes) {
      if (r.model_path && r.served_model_name && !lookup[r.model_path]) {
        lookup[r.model_path] = r.served_model_name;
      }
    }
    return lookup;
  }, [recipes]);

  const runningRecipe = useMemo(() => {
    if (!runningRecipeId) return null;
    return recipes.find((recipe) => recipe.id === runningRecipeId) ?? null;
  }, [recipes, runningRecipeId]);

  const deleteRecipe = useMemo(() => {
    if (!deleteConfirm) return null;
    return recipes.find((recipe) => recipe.id === deleteConfirm) ?? null;
  }, [deleteConfirm, recipes]);

  const filterLower = useMemo(() => filter.trim().toLowerCase(), [filter]);
  const filteredRecipes = useMemo(() => {
    if (!filterLower) return recipes;
    return recipes.filter((recipe) => {
      return (
        recipe.name.toLowerCase().includes(filterLower) ||
        recipe.model_path.toLowerCase().includes(filterLower)
      );
    });
  }, [filterLower, recipes]);

  const sortedRecipes = useMemo(() => {
    return [...filteredRecipes].sort((a, b) => {
      const aPinned = pinnedRecipes.has(a.id);
      const bPinned = pinnedRecipes.has(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredRecipes, pinnedRecipes]);

  return { modelServedNames, runningRecipe, deleteRecipe, sortedRecipes };
}
