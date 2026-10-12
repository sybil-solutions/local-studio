import type { RecipeWithStatus } from "@/lib/types";

export const isRecipeActive = (recipes: RecipeWithStatus[], recipeId: string): boolean =>
  recipes.some(
    (recipe) =>
      recipe.id === recipeId && (recipe.status === "starting" || recipe.status === "running"),
  );
