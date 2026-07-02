import type { RecipeWithStatus } from "@/lib/types";

export interface ReadinessRow {
  recipe: RecipeWithStatus;
  configured: boolean;
  processState: "stopped" | "starting" | "running" | "error";
  served: boolean;
  selected: boolean;
  mismatch: boolean;
}

export function buildReadinessMatrixRows(
  recipes: RecipeWithStatus[],
  currentRecipe: RecipeWithStatus | null,
  servedModelId: string | null,
  lifecycleStatus: "idle" | "starting" | "ready" | "error" = "idle",
): ReadinessRow[] {
  return recipes.map((recipe) => {
    const selected = currentRecipe?.id === recipe.id;
    const configured = true;

    let processState = recipe.status;
    if (selected && lifecycleStatus === "starting" && processState !== "running") {
      processState = "starting";
    } else if (selected && lifecycleStatus === "error") {
      processState = "error";
    }

    const modelId = recipe.served_model_name ?? recipe.id;
    const served = servedModelId !== null && servedModelId === modelId;
    const mismatch = selected && !served && processState === "running";

    return {
      recipe,
      configured,
      processState,
      served,
      selected,
      mismatch,
    };
  });
}
