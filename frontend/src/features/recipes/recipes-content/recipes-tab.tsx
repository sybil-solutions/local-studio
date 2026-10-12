"use client";

import { Plus, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelButton, SearchInput } from "@/ui";
import { visionModeOverrideLabel } from "@/features/recipes/recipe-vision";
import type { RecipesTableProps } from "./types";
import { CatalogContextLine } from "./catalog-context-line";
import { RecipesTable } from "./recipes-table";

type Props = {
  loading: boolean;
  filter: string;
  setFilter: (value: string) => void;
  recipes: RecipeWithStatus[];
  sortedRecipes: RecipeWithStatus[];
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  onEvictModel: () => void;
  onNewRecipe: () => void;
  table: RecipesTableProps;
};

const activeRecipeFor = (recipes: RecipeWithStatus[], runningRecipeId: string | null) =>
  recipes.find((recipe) => recipe.id === runningRecipeId) ??
  recipes.find((recipe) => recipe.status === "running") ??
  null;

const activeFactsFor = (recipe: RecipeWithStatus): string[] => {
  const tp = recipe.tp || recipe.tensor_parallel_size || 1;
  const pp = recipe.pp || recipe.pipeline_parallel_size || 1;
  const inputMode = visionModeOverrideLabel(recipe);
  return [
    recipe.backend,
    recipe.max_model_len ? `${recipe.max_model_len.toLocaleString()} ctx` : "ctx auto",
    `tp/pp ${tp}/${pp}`,
    ...(inputMode ? [inputMode] : []),
    `served as ${recipe.served_model_name ?? recipe.name}`,
  ];
};

export function RecipesTab({
  loading,
  filter,
  setFilter,
  recipes,
  sortedRecipes,
  runningRecipeId,
  runningRecipeName,
  launchProgressMessage,
  onEvictModel,
  onNewRecipe,
  table,
}: Props) {
  const activeRecipe = activeRecipeFor(recipes, runningRecipeId);
  const live = Boolean(runningRecipeId || activeRecipe);

  return (
    <div className="space-y-4">
      <CatalogContextLine
        primary={runningRecipeName ?? activeRecipe?.name ?? "No server running"}
        secondary={
          activeRecipe
            ? activeFactsFor(activeRecipe).join(" · ")
            : loading
              ? "Syncing with the controller…"
              : "Idle — launch one of the servers below."
        }
        meta={launchProgressMessage ?? undefined}
        actions={
          live ? (
            <ModelButton onClick={onEvictModel} tone="danger">
              <Square className="h-3 w-3" />
              Stop
            </ModelButton>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="Search servers…"
          className="min-w-56 flex-1"
        />
        <ModelButton onClick={onNewRecipe} tone="primary">
          <Plus className="h-3 w-3" />
          New server
        </ModelButton>
      </div>

      <RecipesTable
        {...table}
        recipes={sortedRecipes}
        loading={loading}
        filter={filter}
        onNewRecipe={onNewRecipe}
      />
    </div>
  );
}
