"use client";

import { useMemo } from "react";
import type { RecipesTableProps } from "./recipes-content/types";
import { useRecipesContentModel } from "./recipes-content/recipes-content-model";
import { RecipesContentView } from "./recipes-content/recipes-content-view";

export function RecipesContent() {
  const model = useRecipesContentModel();

  const table = useMemo<RecipesTableProps>(
    () => ({
      recipes: model.derived.sortedRecipes,
      pinnedRecipes: model.pinnedRecipes,
      recipeMenuOpen: model.recipeMenuOpen,
      launching: model.launching,
      runningRecipeId: model.runningRecipeId,
      onTogglePin: model.togglePin,
      onToggleMenu: model.actions.handleToggleRecipeMenu,
      onLaunch: model.actions.handleLaunchRecipe,
      onStop: model.actions.handleEvictModel,
      onEdit: model.actions.handleEditRecipe,
      onRequestDelete: model.actions.handleRequestDelete,
    }),
    [
      model.actions.handleEditRecipe,
      model.actions.handleEvictModel,
      model.actions.handleLaunchRecipe,
      model.actions.handleRequestDelete,
      model.actions.handleToggleRecipeMenu,
      model.derived.sortedRecipes,
      model.launching,
      model.pinnedRecipes,
      model.recipeMenuOpen,
      model.runningRecipeId,
      model.togglePin,
    ],
  );

  return (
    <RecipesContentView
      tab={model.tab}
      setTab={model.setTab}
      loading={model.loading}
      refreshing={model.refreshing}
      filter={model.filter}
      setFilter={model.setFilter}
      modalOpen={model.modalOpen}
      modalRecipe={model.modalRecipe}
      setModalRecipe={model.setModalRecipe}
      saving={model.saving}
      recipes={model.recipes}
      deleteConfirm={model.deleteConfirm}
      deleteRecipeName={model.derived.deleteRecipe?.name ?? ""}
      runningRecipeId={model.runningRecipeId}
      runningRecipeName={model.derived.runningRecipe?.name ?? null}
      launchProgressMessage={model.launchProgress?.message ?? null}
      availableModels={model.availableModels}
      modelServedNames={model.modelServedNames}
      sortedRecipes={model.derived.sortedRecipes}
      onRefresh={model.actions.handleRefresh}
      onNewRecipe={model.actions.handleNewRecipe}
      onSaveRecipe={model.actions.handleSaveRecipe}
      onCloseRecipeModal={model.actions.closeRecipeModal}
      onCancelDelete={() => model.setDeleteConfirm(null)}
      onConfirmDelete={async () => {
        if (model.deleteConfirm) {
          await model.actions.handleDeleteRecipe(model.deleteConfirm);
        }
      }}
      onEvictModel={model.actions.handleEvictModel}
      table={table}
    />
  );
}
