"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { MoreVertical, Play, Square } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelButton, ModelRow, ModelStatus, ModelValue, type ModelStatusTone } from "@/ui";
import { formatBackendLabel } from "@/features/recipes/recipe-labels";

type Props = {
  recipe: RecipeWithStatus;
  isPinned: boolean;
  isMenuOpen: boolean;
  launchDisabled: boolean;
  launchDisabledReason?: string | null;
  onTogglePin: (recipeId: string) => void;
  onToggleMenu: (recipeId: string) => void;
  onLaunch: (recipeId: string) => void;
  onStop: () => void;
  onEdit: (recipe: RecipeWithStatus) => void;
  onRequestDelete: (recipeId: string) => void;
  onAttachAgents: (recipe: RecipeWithStatus) => void;
};

function statusTone(status: string): ModelStatusTone {
  if (status === "running") return "good";
  if (status === "starting") return "info";
  if (status === "error") return "danger";
  return "default";
}

export const RecipeRow = memo(function RecipeRow({
  recipe,
  isPinned,
  isMenuOpen,
  launchDisabled,
  launchDisabledReason,
  onTogglePin,
  onToggleMenu,
  onLaunch,
  onStop,
  onEdit,
  onRequestDelete,
  onAttachAgents,
}: Props) {
  const handleTogglePin = useCallback(() => onTogglePin(recipe.id), [onTogglePin, recipe.id]);
  const handleLaunch = useCallback(() => onLaunch(recipe.id), [onLaunch, recipe.id]);
  const handleToggleMenu = useCallback(
    (e?: MouseEvent<HTMLButtonElement>) => {
      e?.stopPropagation();
      onToggleMenu(recipe.id);
    },
    [onToggleMenu, recipe.id],
  );
  const handleEdit = useCallback(() => onEdit(recipe), [onEdit, recipe]);
  const handleAttachAgents = useCallback(() => {
    // Close the overflow menu before opening the dialog.
    onToggleMenu(recipe.id);
    onAttachAgents(recipe);
  }, [onAttachAgents, onToggleMenu, recipe]);
  const handleRequestDelete = useCallback(
    () => onRequestDelete(recipe.id),
    [onRequestDelete, recipe.id],
  );

  const tp = recipe.tp || recipe.tensor_parallel_size || 1;
  const pp = recipe.pp || recipe.pipeline_parallel_size || 1;
  const status = recipe.status || "stopped";
  const modelName =
    recipe.served_model_name || recipe.model_path.split("/").pop() || recipe.model_path;
  const context = recipe.max_model_len
    ? `${recipe.max_model_len.toLocaleString()} ctx`
    : "ctx auto";
  const description = `${modelName} · ${formatBackendLabel(recipe.backend)} · ${context}`;
  const launchTitle = launchDisabledReason ?? "Launch recipe";

  return (
    <ModelRow
      label={recipe.name}
      description={description}
      value={<ModelValue mono>{`${recipe.model_path} · tp/pp ${tp}/${pp}`}</ModelValue>}
      status={<ModelStatus tone={statusTone(status)}>{status}</ModelStatus>}
      actions={
        <>
          {status === "running" ? (
            <ModelButton onClick={onStop} tone="danger" title="Stop">
              <Square className="h-3 w-3" />
            </ModelButton>
          ) : (
            <ModelButton onClick={handleLaunch} disabled={launchDisabled} title={launchTitle}>
              <Play className="h-3 w-3" />
            </ModelButton>
          )}
          <div className="relative">
            <ModelButton onClick={() => handleToggleMenu()} title="Actions">
              <MoreVertical className="h-3 w-3" />
            </ModelButton>
            {isMenuOpen ? (
              <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-md border border-(--border) bg-(--surface) shadow-lg">
                <button
                  onClick={handleTogglePin}
                  className="w-full px-3 py-2 text-left text-[length:var(--fs-md)] hover:bg-(--hover)"
                >
                  {isPinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={handleEdit}
                  className="w-full px-3 py-2 text-left text-[length:var(--fs-md)] hover:bg-(--hover)"
                >
                  Edit
                </button>
                <button
                  onClick={handleAttachAgents}
                  className="w-full px-3 py-2 text-left text-[length:var(--fs-md)] hover:bg-(--hover)"
                >
                  Attach to local agents…
                </button>
                <button
                  onClick={handleRequestDelete}
                  title={`Open delete confirmation for ${recipe.name}`}
                  className="w-full border-t border-(--border) px-3 py-2 text-left text-[length:var(--fs-md)] text-(--err) hover:bg-(--err)/10"
                >
                  Delete recipe...
                </button>
              </div>
            ) : null}
          </div>
        </>
      }
    />
  );
});
