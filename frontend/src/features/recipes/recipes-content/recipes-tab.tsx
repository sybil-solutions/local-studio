"use client";

import { Plus, Search, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import {
  ModelActiveSummary,
  ModelButton,
  ModelInput,
  ModelLogo,
  ModelRow,
  ModelSection,
  ModelStatus,
  type ModelSummaryItem,
} from "@/ui";
import { modelIdFromPath } from "@/lib/huggingface";
import type { RecipesTableProps } from "./types";
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

const parallelismLabel = (recipe: RecipeWithStatus) =>
  `tp/pp ${recipe.tp || recipe.tensor_parallel_size || 1}/${recipe.pp || recipe.pipeline_parallel_size || 1}`;

const contextLabel = (recipe: RecipeWithStatus) =>
  recipe.max_model_len ? `${recipe.max_model_len.toLocaleString()} ctx` : "auto";

const activeDetailsFor = (
  recipe: RecipeWithStatus | null,
  loading: boolean,
  recipeCount: number,
): ModelSummaryItem[] => {
  if (!recipe) {
    return [
      { label: "state", value: loading ? "syncing" : "idle" },
      { label: "recipes", value: recipeCount || "defaults" },
    ];
  }
  return [
    { label: "backend", value: recipe.backend },
    { label: "context", value: contextLabel(recipe) },
    { label: "parallel", value: parallelismLabel(recipe) },
    { label: "served", value: recipe.served_model_name ?? recipe.name },
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
  const activeTitle = runningRecipeName ?? activeRecipe?.name ?? "No active model";
  const activeSubtitle = activeRecipe?.model_path ?? "Controller has no loaded recipe.";
  const activeDetails = activeDetailsFor(activeRecipe, loading, sortedRecipes.length);

  return (
    <div className="space-y-6">
      <ModelSection
        title="Models"
        description="Search, launch, and stop controller recipes."
        actions={
          <ModelStatus tone={runningRecipeId ? "good" : loading ? "info" : "default"}>
            {runningRecipeId ? "running" : loading ? "syncing" : "ready"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search recipes"
          description="Name, path, or served model."
          control={
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--dim)" />
              <ModelInput
                value={filter}
                onChange={setFilter}
                placeholder="Search recipes, paths, served names"
                className="pl-7"
              />
            </div>
          }
          status={<ModelStatus>{sortedRecipes.length || "defaults"}</ModelStatus>}
          actions={
            <ModelButton onClick={onNewRecipe} tone="primary">
              <Plus className="h-3 w-3" />
              New
            </ModelButton>
          }
        />
        <ModelActiveSummary
          title={activeTitle}
          subtitle={activeSubtitle}
          leading={
            activeRecipe ? <ModelLogo modelId={modelIdFromPath(activeRecipe.model_path)} /> : null
          }
          status={
            <ModelStatus tone={runningRecipeId ? "good" : loading ? "info" : "default"}>
              {runningRecipeId ? "live" : loading ? "syncing" : "idle"}
            </ModelStatus>
          }
          details={activeDetails}
          progress={launchProgressMessage}
          actions={
            runningRecipeId ? (
              <ModelButton onClick={onEvictModel} tone="danger">
                <Square className="h-3 w-3" />
                Stop
              </ModelButton>
            ) : null
          }
        />
      </ModelSection>

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
