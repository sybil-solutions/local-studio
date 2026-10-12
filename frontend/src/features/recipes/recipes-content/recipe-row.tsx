"use client";

import { memo, useCallback, type MouseEvent, type ReactNode } from "react";
import { MoreVertical, Play, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelLogo } from "@/ui/model-logo";
import { cx } from "@/ui/utils";
import { POPOVER_MENU_CLASS, POPOVER_SEPARATOR_CLASS } from "@/ui/popover";
import { modelIdFromPath } from "@/lib/huggingface";
import { formatBackendLabel } from "@/features/recipes/recipe-labels";
import { visionModeOverrideLabel } from "@/features/recipes/recipe-vision";
import { DataRow, EndCell, LeadCell, NumCell, RowAction, StatusText } from "./catalog-table-shell";

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

/**
 * A saved server on the catalog's table.
 *
 * The columns are the four decisions that actually differ between two servers
 * pointed at the same weights — engine, context length, how it is split across
 * GPUs, and whether it is up — so two servers can be compared by scanning a
 * column, exactly the way two models can one tab over. Everything else about a
 * server lives in the editor the row opens.
 */
export const ServerRow = memo(function ServerRow({
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
  const running = status === "running";
  const engine = formatBackendLabel(recipe.backend);
  const runtime =
    recipe.runtime?.label ??
    (recipe.runtime ? `${recipe.runtime.kind}:${recipe.runtime.ref}` : "legacy runtime");
  const inputMode = visionModeOverrideLabel(recipe);
  const quant = recipe.quantization?.trim();
  const servedAs = recipe.served_model_name || recipe.id;

  return (
    <DataRow onOpen={handleEdit} ariaLabel={`Edit ${recipe.name}`}>
      <LeadCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <ModelLogo
            modelId={modelIdFromPath(recipe.model_path)}
            size="sm"
            className="rounded-md"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[length:var(--fs-md)] font-medium text-(--fg)">
                {recipe.name}
              </span>
              {isPinned ? (
                <span className="shrink-0 text-[length:var(--fs-xs)] text-(--dim)/60">pinned</span>
              ) : null}
            </div>
            <div
              className="truncate text-[length:var(--fs-xs)] text-(--dim)/60"
              title={`${recipe.model_path} — served to clients as ${servedAs}`}
            >
              {recipe.model_path}
            </div>
          </div>
        </div>
      </LeadCell>

      <NumCell sub={runtime} title={`${engine} · ${runtime}`}>
        {engine}
      </NumCell>

      <NumCell
        sub={quant ?? inputMode ?? undefined}
        title={
          recipe.max_model_len
            ? `Maximum context length: ${recipe.max_model_len.toLocaleString()} tokens`
            : "Context length follows the model's own config"
        }
      >
        {recipe.max_model_len ? recipe.max_model_len.toLocaleString() : "auto"}
      </NumCell>

      <NumCell title={`${tp} tensor-parallel × ${pp} pipeline-parallel`}>{`${tp} / ${pp}`}</NumCell>

      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={status === "error" ? "error" : running ? "ok" : "dim"}>
            {status}
          </StatusText>
          {running ? (
            <RowAction onClick={onStop} tone="danger" title="Stop this server">
              <Square className="h-3 w-3" />
              Stop
            </RowAction>
          ) : (
            <RowAction
              onClick={handleLaunch}
              disabled={launchDisabled}
              title={launchDisabledReason ?? "Launch this server"}
            >
              <Play className="h-3 w-3" />
              Launch
            </RowAction>
          )}
          <ServerRowMenu
            open={isMenuOpen}
            pinned={isPinned}
            recipeName={recipe.name}
            onToggle={handleToggleMenu}
            onTogglePin={handleTogglePin}
            onEdit={handleEdit}
            onAttachAgents={handleAttachAgents}
            onRequestDelete={handleRequestDelete}
          />
        </div>
      </EndCell>
    </DataRow>
  );
});

function ServerRowMenu({
  open,
  pinned,
  recipeName,
  onToggle,
  onTogglePin,
  onEdit,
  onAttachAgents,
  onRequestDelete,
}: {
  open: boolean;
  pinned: boolean;
  recipeName: string;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onAttachAgents: () => void;
  onRequestDelete: () => void;
}) {
  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={onToggle}
        title="Actions"
        aria-label="Server actions"
        className={cx(
          "-mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-(--dim) transition-opacity hover:bg-(--hover) hover:text-(--fg) focus-visible:opacity-100 group-hover:opacity-100",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        <MoreVertical className="h-3 w-3" />
      </button>
      {open ? (
        <div className={`absolute right-0 z-50 mt-1 w-48 ${POPOVER_MENU_CLASS}`}>
          <MenuItem onClick={onTogglePin}>{pinned ? "Unpin" : "Pin"}</MenuItem>
          <MenuItem onClick={onEdit}>Edit</MenuItem>
          <MenuItem onClick={onAttachAgents}>Attach to local agents…</MenuItem>
          <div className={POPOVER_SEPARATOR_CLASS} aria-hidden />
          <MenuItem
            onClick={onRequestDelete}
            danger
            title={`Open delete confirmation for ${recipeName}`}
          >
            Delete server…
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cx(
        "w-full rounded-lg px-2.5 py-2 text-left text-[length:var(--fs-md)]",
        danger
          ? "text-(--color-destructive) hover:bg-(--color-destructive)/10"
          : "text-(--fg) hover:bg-(--color-menu-hover)",
      )}
    >
      {children}
    </button>
  );
}
