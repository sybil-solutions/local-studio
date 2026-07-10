"use client";

import type { ReactNode } from "react";
import { Compass, Download, HardDrive } from "@/ui/icon-registry";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { SettingsLayout } from "@/features/settings/settings-ui";
import type { RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { DeleteRecipeConfirmModal } from "./delete-recipe-confirm-modal";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";
import { DownloadsTab } from "./downloads-tab";

type Props = {
  tab: RecipesContentTab;
  setTab: (tab: RecipesContentTab) => void;
  loading: boolean;
  refreshing: boolean;
  filter: string;
  setFilter: (value: string) => void;
  modalOpen: boolean;
  modalRecipe: RecipeEditor | null;
  setModalRecipe: (recipe: RecipeEditor | null) => void;
  saving: boolean;
  recipes: RecipeWithStatus[];
  deleteConfirm: string | null;
  deleteRecipeName: string;
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  availableModels: ModelInfo[];
  runtimeTargets: RuntimeTarget[];
  sortedRecipes: RecipeWithStatus[];
  onRefresh: () => void;
  onNewRecipe: () => void;
  onCreateServeFromDownload: (download: ModelDownload) => void;
  onSaveRecipe: () => void;
  onCloseRecipeModal: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEvictModel: () => void;
  table: RecipesTableProps;
};

const MODEL_SECTIONS: Array<{
  id: RecipesContentTab;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    id: "get",
    label: "Get",
    description: "Find the right model, check hardware fit, and download its weights.",
    icon: <Compass className="h-3.5 w-3.5" />,
  },
  {
    id: "serves",
    label: "Serves",
    description: "Saved model, runtime, and configuration combinations ready to launch.",
    icon: <HardDrive className="h-3.5 w-3.5" />,
  },
  {
    id: "downloads",
    label: "Downloads",
    description: "Download queue, progress, retry, and cancel controls.",
    icon: <Download className="h-3.5 w-3.5" />,
  },
];

export function RecipesContentView(props: Props) {
  const {
    tab,
    setTab,
    loading,
    refreshing,
    filter,
    setFilter,
    modalOpen,
    modalRecipe,
    setModalRecipe,
    saving,
    recipes,
    deleteConfirm,
    deleteRecipeName,
    runningRecipeId,
    runningRecipeName,
    launchProgressMessage,
    availableModels,
    runtimeTargets,
    sortedRecipes,
    onRefresh,
    onNewRecipe,
    onCreateServeFromDownload,
    onSaveRecipe,
    onCloseRecipeModal,
    onCancelDelete,
    onConfirmDelete,
    onEvictModel,
    table,
  } = props;
  const status = loading
    ? "syncing recipes"
    : recipes.length
      ? `${recipes.length} configured`
      : "stable defaults";
  const statusText = refreshing ? "refreshing" : status;

  return (
    <>
      <SettingsLayout
        sections={MODEL_SECTIONS}
        activeSection={tab}
        title="Models"
        eyebrow="Model library"
        status={statusText}
        loading={refreshing || loading}
        onReload={onRefresh}
        onSelectSection={setTab}
        refreshLabel="Refresh models"
      >
        {tab === "serves" ? (
          <RecipesTab
            loading={loading}
            filter={filter}
            setFilter={setFilter}
            recipes={recipes}
            sortedRecipes={sortedRecipes}
            runningRecipeId={runningRecipeId}
            runningRecipeName={runningRecipeName}
            launchProgressMessage={launchProgressMessage}
            onEvictModel={onEvictModel}
            onNewRecipe={onNewRecipe}
            table={table}
          />
        ) : tab === "get" ? (
          <ExploreTab />
        ) : (
          <DownloadsTab onCreateServe={onCreateServeFromDownload} />
        )}
      </SettingsLayout>

      {modalOpen && modalRecipe ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close recipe editor"
            className="absolute inset-0 bg-(--color-background)/85 backdrop-blur-[5px]"
            onClick={onCloseRecipeModal}
          />
          <RecipeModal
            recipe={modalRecipe}
            onClose={onCloseRecipeModal}
            onSave={onSaveRecipe}
            onChange={setModalRecipe}
            saving={saving}
            availableModels={availableModels}
            runtimeTargets={runtimeTargets}
            recipes={recipes}
          />
        </div>
      ) : null}

      {deleteConfirm ? (
        <DeleteRecipeConfirmModal
          recipeName={deleteRecipeName}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </>
  );
}
