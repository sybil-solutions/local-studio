import type { Recipe, RecipeEditor } from "@/lib/types";
import { coerceValue } from "./coercion";
import { EXTRA_ARG_FIELDS } from "./extra-arg-fields";
import { extractThinkingBudget, getExtraArgValue } from "./extra-args";

export const normalizeRecipeForEditor = (recipe: Recipe): RecipeEditor => {
  const extraArgs = { ...(recipe.extra_args ?? {}) } as Record<string, unknown>;
  const normalized: RecipeEditor = {
    ...recipe,
    extra_args: extraArgs,
  };

  if (normalized.tp === undefined && normalized.tensor_parallel_size !== undefined) {
    normalized.tp = normalized.tensor_parallel_size;
  }
  if (normalized.pp === undefined && normalized.pipeline_parallel_size !== undefined) {
    normalized.pp = normalized.pipeline_parallel_size;
  }

  if (!normalized.env_vars) {
    const envVars = getExtraArgValue(extraArgs, {
      key: "env_vars",
      aliases: ["env-vars", "envVars"],
    });
    if (envVars && typeof envVars === "object" && !Array.isArray(envVars)) {
      normalized.env_vars = Object.fromEntries(
        Object.entries(envVars as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value),
        ]),
      );
    }
  }

  for (const field of EXTRA_ARG_FIELDS) {
    if (normalized[field.field] !== undefined) {
      continue;
    }
    const value = getExtraArgValue(extraArgs, field);
    const coerced = coerceValue(value, field.type);
    if (coerced !== undefined) {
      normalized[field.field] = coerced as never;
    }
  }

  if (normalized.thinking_budget === undefined) {
    const budget = extractThinkingBudget(extraArgs);
    if (budget !== undefined) {
      normalized.thinking_budget = budget;
    }
  }

  return normalized;
};
