"use client";

import { Plus, Search, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelLogo } from "@/ui/model-logo";
import { ModelButton, ModelInput } from "@/ui";
import {
  ModelActiveSummary,
  ModelRow,
  ModelSection,
  ModelStatus,
  type ModelSummaryItem,
} from "./model-page";
import { modelIdFromPath } from "@/lib/huggingface";
import { visionModeOverrideLabel } from "@/features/recipes/recipe-vision";
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
      { label: "serves", value: recipeCount || "defaults" },
    ];
  }
  const inputMode = visionModeOverrideLabel(recipe);
  return [
    { label: "backend", value: recipe.backend },
    { label: "runtime", value: recipe.runtime?.label ?? recipe.runtime?.kind ?? "legacy" },
    { label: "context", value: contextLabel(recipe) },
    { label: "parallel", value: parallelismLabel(recipe) },
    ...(inputMode ? [{ label: "input", value: inputMode }] : []),
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
  const activeTitle = runningRecipeName ?? activeRecipe?.name ?? "No active Serve";
  const activeSubtitle = activeRecipe?.model_path ?? "This controller is ready for a Serve.";
  const activeDetails = activeDetailsFor(activeRecipe, loading, sortedRecipes.length);

  return (
    <div className="space-y-6">
      <ModelSection
        title="Serves"
        description="Each Serve binds model weights, a real runtime, and launch configuration."
        actions={
          <ModelStatus tone={runningRecipeId ? "good" : loading ? "info" : "default"}>
            {runningRecipeId ? "running" : loading ? "syncing" : "ready"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search Serves"
          description="Name, model path, runtime, or API model name."
          control={
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--dim)" />
              <ModelInput
                value={filter}
                onChange={setFilter}
                placeholder="Search Serves, weights, runtimes"
                className="pl-7"
              />
            </div>
          }
          status={<ModelStatus>{sortedRecipes.length || "defaults"}</ModelStatus>}
          actions={
            <ModelButton onClick={onNewRecipe} tone="primary">
              <Plus className="h-3 w-3" />
              New Serve
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
