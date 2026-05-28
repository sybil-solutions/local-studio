"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { MoreVertical, Pin, PinOff, Play, Square } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import {
  ModelButton,
  ModelRow,
  ModelStatus,
  ModelValue,
  type ModelStatusTone,
} from "./model-page-primitives";
import { formatBackendLabel } from "../../recipe-labels";

type Props = {
  recipe: RecipeWithStatus;
  isPinned: boolean;
  isMenuOpen: boolean;
  launchDisabled: boolean;
  onTogglePin: (recipeId: string) => void;
  onToggleMenu: (recipeId: string) => void;
  onLaunch: (recipeId: string) => void;
  onStop: () => void;
  onEdit: (recipe: RecipeWithStatus) => void;
  onRequestDelete: (recipeId: string) => void;
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
  onTogglePin,
  onToggleMenu,
  onLaunch,
  onStop,
  onEdit,
  onRequestDelete,
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

  return (
    <ModelRow
      label={recipe.name}
      description={`${modelName} · engine ${formatBackendLabel(recipe.backend)} · ${context} · tp/pp ${tp}/${pp}`}
      value={<ModelValue mono>{recipe.model_path}</ModelValue>}
      status={<ModelStatus tone={statusTone(status)}>{status}</ModelStatus>}
      actions={
        <>
          <ModelButton onClick={handleTogglePin} title={isPinned ? "Unpin" : "Pin"}>
            {isPinned ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
          </ModelButton>
          {status === "running" ? (
            <ModelButton onClick={onStop} tone="danger" title="Stop">
              <Square className="h-3 w-3" />
            </ModelButton>
          ) : (
            <ModelButton onClick={handleLaunch} disabled={launchDisabled} title="Launch">
              <Play className="h-3 w-3" />
            </ModelButton>
          )}
          <div className="relative">
            <ModelButton onClick={() => handleToggleMenu()} title="Actions">
              <MoreVertical className="h-3 w-3" />
            </ModelButton>
            {isMenuOpen ? (
              <div className="absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-md border border-(--border) bg-(--surface) shadow-lg">
                <button
                  onClick={handleEdit}
                  className="w-full px-3 py-2 text-left text-[12px] hover:bg-(--hover)"
                >
                  Edit
                </button>
                <button
                  onClick={handleRequestDelete}
                  className="w-full px-3 py-2 text-left text-[12px] text-(--err) hover:bg-(--err)/10"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </>
      }
    />
  );
});
