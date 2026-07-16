"use client";

import { useCallback, useMemo } from "react";
import type { RecipesTableProps } from "./types";
import { useRecipesContentModel, type RecipesContentTab } from "./recipes-content-model";
import { RecipesContentView } from "./recipes-content-view";

export function RecipesContent({ embedded = false }: { embedded?: boolean }) {
  const model = useRecipesContentModel();
  const setTab = model.setTab;
  const selectTab = useCallback(
    (tab: RecipesContentTab) => {
      setTab(tab);
      if (!embedded) return;
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      url.hash = "models";
      window.history.replaceState(null, "", url);
    },
    [embedded, setTab],
  );

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
      embedded={embedded}
      tab={model.tab}
      setTab={selectTab}
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
      runtimeTargets={model.runtimeTargets}
      sortedRecipes={model.derived.sortedRecipes}
      onRefresh={model.actions.handleRefresh}
      onNewRecipe={model.actions.handleNewRecipe}
      onCreateServeFromDownload={model.actions.handleCreateServeFromDownload}
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
