"use client";

import { memo, useCallback, type MouseEvent } from "react";
import { MoreVertical, Play, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelLogo } from "@/ui/model-logo";
import { ModelButton, ModelRow, ModelStatus, type ModelStatusTone } from "./model-page";
import { modelIdFromPath } from "@/lib/huggingface";
import { engineNodeStyle, formatBackendLabel } from "@/features/recipes/recipe-labels";
import { visionModeOverrideLabel } from "@/features/recipes/recipe-vision";

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
  const description = `${modelName} · ${context}`;
  const engine = formatBackendLabel(recipe.backend);
  const engineStyle = engineNodeStyle(recipe.backend);
  const launchTitle = launchDisabledReason ?? "Launch Serve";
  const parallelism = `tp/pp ${tp}/${pp}`;
  const quant = recipe.quantization?.trim();
  const runtime =
    recipe.runtime?.label ??
    (recipe.runtime ? `${recipe.runtime.kind}:${recipe.runtime.ref}` : "legacy runtime");
  const inputMode = visionModeOverrideLabel(recipe);

  return (
    <ModelRow
      label={recipe.name}
      description={description}
      leading={<ModelLogo modelId={modelIdFromPath(recipe.model_path)} size="sm" />}
      value={
        <div className="flex items-center gap-2">
          <span
            title={`Inference engine: ${engine}`}
            className={`inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[length:var(--fs-2xs)] font-medium ${engineStyle.bg} ${engineStyle.fg}`}
          >
            {engine}
          </span>
          <span
            title={`Splits the model across GPUs: ${tp} tensor-parallel × ${pp} pipeline-parallel`}
            className="truncate font-mono text-[length:var(--fs-md)] text-(--ui-fg)"
          >
            {parallelism}
          </span>
          <span
            title={
              recipe.runtime
                ? `Launch runtime: ${recipe.runtime.kind} · ${recipe.runtime.ref}`
                : "Runtime will be migrated when this Serve is edited"
            }
            className="max-w-40 truncate rounded bg-(--surface-2) px-1.5 py-0.5 font-mono text-[length:var(--fs-2xs)] text-(--dim)"
          >
            {runtime}
          </span>
          {inputMode ? (
            <span
              title="Image input override"
              className="shrink-0 rounded bg-(--surface-2) px-1.5 py-0.5 text-[length:var(--fs-2xs)] text-(--dim)"
            >
              {inputMode}
            </span>
          ) : null}
          {quant ? (
            <span
              title={`Quantization: weights compressed to ${quant} for lower memory use`}
              className="shrink-0 rounded bg-(--surface-2) px-1.5 py-0.5 text-[length:var(--fs-2xs)] text-(--dim)"
            >
              {quant}
            </span>
          ) : null}
        </div>
      }
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
              <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-md border border-(--color-popover-border) bg-(--color-popover) shadow-[0_16px_44px_rgba(0,0,0,0.48)]">
                <button
                  onClick={handleTogglePin}
                  className="w-full px-3 py-2 text-left text-[length:var(--fs-md)] text-(--fg) hover:bg-(--color-menu-hover)"
                >
                  {isPinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={handleEdit}
                  className="w-full px-3 py-2 text-left text-[length:var(--fs-md)] text-(--fg) hover:bg-(--color-menu-hover)"
                >
                  Edit
                </button>
                <button
                  onClick={handleAttachAgents}
                  className="w-full px-3 py-2 text-left text-[length:var(--fs-md)] text-(--fg) hover:bg-(--color-menu-hover)"
                >
                  Attach to local agents…
                </button>
                <button
                  onClick={handleRequestDelete}
                  title={`Open delete confirmation for ${recipe.name}`}
                  className="w-full border-t border-(--color-popover-border) px-3 py-2 text-left text-[length:var(--fs-md)] text-(--color-destructive) hover:bg-(--color-destructive)/10"
                >
                  Delete Serve…
                </button>
              </div>
            ) : null}
          </div>
        </>
      }
    />
  );
});
