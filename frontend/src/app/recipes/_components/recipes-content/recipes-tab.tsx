"use client";

import { Plus, Search, Square } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import {
  ModelButton,
  ModelInput,
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "./model-page-primitives";
import type { RecipesTableProps } from "./types";
import { RecipesTable } from "./recipes-table";

type Props = {
  loading: boolean;
  filter: string;
  setFilter: (value: string) => void;
  sortedRecipes: RecipeWithStatus[];
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  onEvictModel: () => void;
  onNewRecipe: () => void;
  table: RecipesTableProps;
};

export function RecipesTab({
  loading,
  filter,
  setFilter,
  sortedRecipes,
  runningRecipeId,
  runningRecipeName,
  launchProgressMessage,
  onEvictModel,
  onNewRecipe,
  table,
}: Props) {
  return (
    <div className="space-y-6">
      <ModelSection
        title="Current Running Models"
        description="Search configured launch rows and stop the active controller-owned model."
        actions={
          <ModelStatus tone={runningRecipeId ? "good" : loading ? "info" : "default"}>
            {runningRecipeId ? "running" : loading ? "syncing" : "ready"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search recipes"
          description="Recipe name, model path, or served name."
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
        <ModelRow
          label="Active model"
          description="The currently loaded recipe, if the controller reports one."
          value={
            <ModelValue mono dim={!runningRecipeName}>
              {runningRecipeName ?? "No active launch"}
            </ModelValue>
          }
          status={
            <ModelStatus tone={runningRecipeId ? "good" : "default"}>
              {runningRecipeId ? "live" : "idle"}
            </ModelStatus>
          }
          actions={
            runningRecipeId ? (
              <ModelButton onClick={onEvictModel} tone="danger">
                <Square className="h-3 w-3" />
                Stop
              </ModelButton>
            ) : null
          }
        >
          {launchProgressMessage ? (
            <div className="text-[11px] text-(--dim)">{launchProgressMessage}</div>
          ) : null}
        </ModelRow>
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
