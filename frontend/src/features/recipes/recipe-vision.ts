import type { RecipeEditor } from "./recipe-editor";

export type VisionMode = "auto" | "enabled" | "text";

type RecipeVision = Pick<RecipeEditor, "vision">;

export const visionModeForRecipe = (recipe: RecipeVision): VisionMode =>
  recipe.vision === true ? "enabled" : recipe.vision === false ? "text" : "auto";

export const visionForMode = (mode: VisionMode): boolean | null =>
  mode === "enabled" ? true : mode === "text" ? false : null;

export const visionModeLabel = (recipe: RecipeVision): string => {
  const mode = visionModeForRecipe(recipe);
  return mode === "enabled" ? "images enabled" : mode === "text" ? "text only" : "image auto";
};

export const visionModeOverrideLabel = (recipe: RecipeVision): string | null =>
  visionModeForRecipe(recipe) === "auto" ? null : visionModeLabel(recipe);
