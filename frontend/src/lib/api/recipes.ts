import type { Recipe, RecipeWithStatus } from "../types";
import type { ApiCore } from "./core";

export function createRecipesApi(core: ApiCore) {
  return {
    getRecipes: async (): Promise<{ recipes: RecipeWithStatus[] }> => {
      const data = await core.rpcJson<RecipeWithStatus[]>(core.rpc.recipes.$get());
      return { recipes: Array.isArray(data) ? data : [] };
    },

    getRecipe: (id: string): Promise<RecipeWithStatus> =>
      core.rpcJson(core.rpc.recipes[":recipeId"].$get({ param: { recipeId: id } })),

    createRecipe: (recipe: Recipe): Promise<{ success: boolean; id: string }> =>
      core.rpcJson(core.rpc.recipes.$post(undefined, { init: { body: JSON.stringify(recipe) } })),

    updateRecipe: (id: string, recipe: Recipe): Promise<{ success: boolean; id: string }> =>
      core.rpcJson(
        core.rpc.recipes[":recipeId"].$put(
          { param: { recipeId: id } },
          { init: { body: JSON.stringify(recipe) } },
        ),
      ),

    launchRecipe: (id: string): Promise<{ success: boolean; message: string }> =>
      core.request(`/launch/${encodeURIComponent(id)}`, {
        method: "POST",
        timeout: 600_000,
        retries: 0,
      }),

    deleteRecipe: (id: string): Promise<void> =>
      core.rpcJson(core.rpc.recipes[":recipeId"].$delete({ param: { recipeId: id } })),
  };
}
