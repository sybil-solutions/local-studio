"use client";

import type { ReactNode } from "react";
import { Download, Search, Server, Sparkles } from "@/ui/icon-registry";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { ConfirmDeleteModal, RefreshButton, TabbedPage, Tabs } from "@/ui";
import { DrawerOverlay } from "@/ui/drawer";
import type { RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";
import { DownloadsTab } from "./downloads-tab";
import { PicksTab } from "./picks-tab";

type Props = {
  embedded?: boolean;
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

// Tab ids are storage/URL keys and stay put; the labels say what each tab
// actually does, because "Picks / Get / Serves" told you nothing from outside.
const MODEL_TABS: Array<{ id: RecipesContentTab; label: string; icon: ReactNode }> = [
  { id: "picks", label: "Recommended", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "get", label: "Hugging Face", icon: <Search className="h-3.5 w-3.5" /> },
  { id: "serves", label: "Your servers", icon: <Server className="h-3.5 w-3.5" /> },
  { id: "downloads", label: "Downloads", icon: <Download className="h-3.5 w-3.5" /> },
];

const TAB_HINTS: Record<RecipesContentTab, string> = {
  picks: "Curated models checked against this machine's GPU memory.",
  get: "Search the Hub, check fit, and pull weights.",
  serves: "Saved model configurations ready to launch.",
  downloads: "Active downloads with progress and controls.",
};

export function RecipesContentView(props: Props) {
  const {
    embedded = false,
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

  const content = (
    <section>
      <div>
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
        ) : tab === "picks" ? (
          <PicksTab />
        ) : tab === "get" ? (
          <ExploreTab />
        ) : (
          <DownloadsTab onCreateServe={onCreateServeFromDownload} />
        )}
      </div>
    </section>
  );

  return (
    <>
      {embedded ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
            <Tabs variant="pill" items={MODEL_TABS} activeTab={tab} onSelectTab={setTab} />
            <RefreshButton
              onRefresh={onRefresh}
              loading={refreshing || loading}
              label="Refresh models"
              className="h-8 w-8"
            />
          </div>
          {content}
        </div>
      ) : (
        <TabbedPage
          title="Models"
          width="md"
          compact
          tabs={MODEL_TABS.map((item) => ({ ...item, title: TAB_HINTS[item.id] }))}
          activeTab={tab}
          onSelectTab={setTab}
          actions={
            <RefreshButton
              onRefresh={onRefresh}
              loading={refreshing || loading}
              label="Refresh models"
              className="h-8 w-8"
            />
          }
        >
          {content}
        </TabbedPage>
      )}

      {modalOpen && modalRecipe ? (
        <DrawerOverlay onClose={onCloseRecipeModal}>
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
        </DrawerOverlay>
      ) : null}

      {deleteConfirm ? (
        <ConfirmDeleteModal
          title="Delete Serve"
          message={`Delete "${deleteRecipeName}"? Model weights stay on disk.`}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </>
  );
}
