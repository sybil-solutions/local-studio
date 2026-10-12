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
        recipe.model_path.toLowerCase().includes(filterLower) ||
        (recipe.served_model_name?.toLowerCase().includes(filterLower) ?? false) ||
        recipe.backend.toLowerCase().includes(filterLower) ||
        (recipe.runtime?.kind.toLowerCase().includes(filterLower) ?? false) ||
        (recipe.runtime?.ref.toLowerCase().includes(filterLower) ?? false)
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

  return { runningRecipe, deleteRecipe, sortedRecipes };
}
