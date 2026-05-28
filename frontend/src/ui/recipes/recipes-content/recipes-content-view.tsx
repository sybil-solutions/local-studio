"use client";

import type { ReactNode } from "react";
import { Compass, Download, HardDrive, RefreshCw } from "lucide-react";
import type { ModelInfo, RecipeEditor, RecipeWithStatus } from "@/lib/types";
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
  modelServedNames: Record<string, string>;
  sortedRecipes: RecipeWithStatus[];
  onRefresh: () => void;
  onNewRecipe: () => void;
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
    id: "explore",
    label: "Search Models",
    description: "Base model search first; derivatives expand under the selected family.",
    icon: <Compass className="h-3.5 w-3.5" />,
  },
  {
    id: "recipes",
    label: "Current Running Models",
    description: "Local launch recipes, running state, and engine actions.",
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
    modelServedNames,
    sortedRecipes,
    onRefresh,
    onNewRecipe,
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
  const activeLabel = MODEL_SECTIONS.find((section) => section.id === tab)?.label ?? "Models";

  return (
    <>
      <div className="flex h-full min-h-0 w-full bg-(--bg) text-(--fg)">
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-4 py-4 sm:px-6 lg:grid-cols-[172px_minmax(0,1fr)] lg:gap-8 lg:py-6">
            <aside className="lg:sticky lg:top-5 lg:self-start">
              <div className="mb-3 flex h-8 items-center justify-between gap-2">
                <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-(--fg)">
                  Models
                </h1>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing || loading}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
                  aria-label="Refresh models"
                  title="Refresh models"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshing || loading ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
              <nav
                aria-label="Model sections"
                className="-mx-1 overflow-x-auto pb-1 lg:mx-0 lg:overflow-visible"
              >
                <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
                  {MODEL_SECTIONS.map((section) => {
                    const active = tab === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setTab(section.id)}
                        className={`group grid h-7 grid-cols-[18px_1fr] items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors lg:w-full ${
                          active
                            ? "bg-(--surface) text-(--fg)"
                            : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                        }`}
                        title={section.description}
                      >
                        <span className="flex h-4 w-4 items-center justify-center opacity-80">
                          {section.icon}
                        </span>
                        <span className="truncate">{section.label}</span>
                      </button>
                    );
                  })}
                </div>
              </nav>
            </aside>

            <section className="min-w-0 pb-10">
              <div className="mb-5 flex min-h-8 items-center justify-between gap-4 border-b border-(--border)/75 pb-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-(--dim)">
                    Model library
                  </div>
                  <h2 className="mt-1 truncate text-[18px] font-semibold tracking-[-0.015em] text-(--fg)">
                    {activeLabel}
                  </h2>
                </div>
                <span className="shrink-0 text-[11px] text-(--dim)">
                  {refreshing ? "refreshing" : status}
                </span>
              </div>
              {tab === "recipes" ? (
                <RecipesTab
                  loading={loading}
                  filter={filter}
                  setFilter={setFilter}
                  sortedRecipes={sortedRecipes}
                  runningRecipeId={runningRecipeId}
                  runningRecipeName={runningRecipeName}
                  launchProgressMessage={launchProgressMessage}
                  onEvictModel={onEvictModel}
                  onNewRecipe={onNewRecipe}
                  table={table}
                />
              ) : tab === "explore" ? (
                <ExploreTab />
              ) : (
                <DownloadsTab />
              )}
            </section>
          </div>
        </main>
        {modalOpen && modalRecipe ? (
          <RecipeModal
            recipe={modalRecipe}
            onClose={onCloseRecipeModal}
            onSave={onSaveRecipe}
            onChange={setModalRecipe}
            saving={saving}
            availableModels={availableModels}
            recipes={recipes}
          />
        ) : null}
      </div>

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
