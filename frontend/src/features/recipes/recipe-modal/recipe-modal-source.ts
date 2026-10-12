import type { Backend, Recipe } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { filterExtraArgsForEditor } from "@/features/recipes/editor-extra-args";
import { normalizeRecipeForEditor } from "@/features/recipes/normalize-recipe";
import { prepareRecipeForSave } from "@/features/recipes/prepare-recipe";

const BACKENDS = new Set<Backend>(["vllm", "sglang", "exllamav3"]);

export function getCommandOverride(recipe: RecipeEditor): string | null {
  const launchCommand = recipe.extra_args?.["launch_command"];
  if (typeof launchCommand === "string" && launchCommand.trim()) return launchCommand;
  const customCommand = recipe.extra_args?.["custom_command"];
  if (typeof customCommand === "string" && customCommand.trim()) return customCommand;
  return null;
}

export function formatRecipeSource(recipe: RecipeEditor): string {
  return JSON.stringify(prepareRecipeForSave(recipe), null, 2);
}

export function formatEditableExtraArgs(recipe: RecipeEditor): string {
  return JSON.stringify(filterExtraArgsForEditor(recipe.extra_args ?? {}), null, 2);
}

export function envVarEntriesFromRecipe(
  recipe: RecipeEditor,
): Array<{ key: string; value: string }> {
  const entries = Object.entries(recipe.env_vars ?? {}).map(([key, value]) => ({
    key,
    value: String(value),
  }));
  return entries.length ? entries : [{ key: "", value: "" }];
}

export function parseRecipeSource(
  value: string,
): { recipe: RecipeEditor; error: null } | { error: string } {
  if (!value.trim()) {
    return { error: "Recipe JSON is required." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "Recipe source must be valid JSON." };
  }

  if (!isPlainObject(parsed)) {
    return { error: "Recipe source must be a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  const requiredStringFields = ["id", "name", "model_path"].filter(
    (field) => typeof record[field] !== "string",
  );
  if (requiredStringFields.length) {
    return { error: `Recipe needs string field(s): ${requiredStringFields.join(", ")}.` };
  }

  if (record.backend !== undefined && !BACKENDS.has(record.backend as Backend)) {
    return { error: "Recipe backend is not supported." };
  }

  if (
    record.extra_args !== undefined &&
    record.extra_args !== null &&
    !isPlainObject(record.extra_args)
  ) {
    return { error: "extra_args must be a JSON object." };
  }

  if (
    record.env_vars !== undefined &&
    record.env_vars !== null &&
    !isPlainObject(record.env_vars)
  ) {
    return { error: "env_vars must be a JSON object or null." };
  }

  return { recipe: normalizeRecipeForEditor(record as unknown as Recipe), error: null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
