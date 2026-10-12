"use client";

import { useState } from "react";
import { Plus } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import type { RecipeWithStatus } from "@/lib/types";
import { AttachLocalAgentsDialog } from "@/features/settings/attach-local-agents-dialog";
import { ServerRow } from "./recipe-row";
import { GroupRow, HeadCell, TableFrame, TableNotice } from "./catalog-table-shell";

type Props = {
  recipes: RecipeWithStatus[];
  pinnedRecipes: Set<string>;
  recipeMenuOpen: string | null;
  launching: boolean;
  runningRecipeId: string | null;
  loading: boolean;
  filter: string;
  onTogglePin: (recipeId: string) => void;
  onToggleMenu: (recipeId: string) => void;
  onLaunch: (recipeId: string) => void;
  onStop: () => void;
  onEdit: (recipe: RecipeWithStatus) => void;
  onRequestDelete: (recipeId: string) => void;
  onNewRecipe: () => void;
};

export function RecipesTable({
  recipes,
  pinnedRecipes,
  recipeMenuOpen,
  launching,
  runningRecipeId,
  loading,
  filter,
  onTogglePin,
  onToggleMenu,
  onLaunch,
  onStop,
  onEdit,
  onRequestDelete,
  onNewRecipe,
}: Props) {
  const [attachRecipe, setAttachRecipe] = useState<RecipeWithStatus | null>(null);
  const emptyBecauseSearch = Boolean(filter.trim()) && recipes.length === 0;
  const launchDisabledReason = launching
    ? "A launch is already in progress."
    : runningRecipeId
      ? "Stop the running server before launching another."
      : null;

  if (recipes.length === 0) {
    return (
      <TableNotice
        title={
          emptyBecauseSearch
            ? `No server matches “${filter.trim()}”`
            : loading
              ? "Loading servers from the controller…"
              : "No servers yet"
        }
        body="A server binds downloaded weights to a runtime and its launch flags — tensor parallelism, context length, quantization — so you can start it again with one click."
        action={
          emptyBecauseSearch ? null : (
            <ModelButton onClick={onNewRecipe} tone="primary">
              <Plus className="h-3 w-3" />
              New server
            </ModelButton>
          )
        }
      />
    );
  }

  return (
    <>
      <TableFrame minWidthClass="min-w-[44rem]">
        <thead>
          <tr>
            <HeadCell>Server</HeadCell>
            <HeadCell numeric title="Inference engine, and the runtime it launches under">
              Engine
            </HeadCell>
            <HeadCell numeric>Context</HeadCell>
            <HeadCell numeric title="Tensor-parallel / pipeline-parallel split across GPUs">
              tp / pp
            </HeadCell>
            <HeadCell numeric>Status</HeadCell>
          </tr>
        </thead>
        <tbody>
          <GroupRow
            colSpan={5}
            label="Saved servers"
            blurb={launchDisabledReason ?? "Click a row to edit it, or launch it from the right."}
            right={`${recipes.length} ${recipes.length === 1 ? "server" : "servers"}`}
          />
          {recipes.map((recipe) => (
            <ServerRow
              key={recipe.id}
              recipe={recipe}
              isPinned={pinnedRecipes.has(recipe.id)}
              isMenuOpen={recipeMenuOpen === recipe.id}
              launchDisabled={launching || Boolean(runningRecipeId)}
              launchDisabledReason={launchDisabledReason}
              onTogglePin={onTogglePin}
              onToggleMenu={onToggleMenu}
              onLaunch={onLaunch}
              onStop={onStop}
              onEdit={onEdit}
              onRequestDelete={onRequestDelete}
              onAttachAgents={setAttachRecipe}
            />
          ))}
        </tbody>
      </TableFrame>

      {attachRecipe ? (
        <AttachLocalAgentsDialog
          modelId={attachRecipe.served_model_name || attachRecipe.id}
          modelName={attachRecipe.name}
          onClose={() => setAttachRecipe(null)}
        />
      ) : null}
    </>
  );
}
