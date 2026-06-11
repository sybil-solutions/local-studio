"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelButton, ModelRow, ModelSection, ModelStatus, ModelValue } from "@/ui";
import { AttachLocalAgentsDialog } from "@/features/settings/attach-local-agents-dialog";
import { RecipeRow } from "./recipe-row";

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

const TEMPLATE_ROWS = [
  {
    label: "vLLM default",
    description: "CUDA-first OpenAI-compatible launch recipe.",
    value: "backend vLLM · tp/pp 1/1",
    status: "template",
  },
  {
    label: "SGLang server",
    description: "Structured generation runtime with metrics enabled by default.",
    value: "backend SGLang · metrics ready",
    status: "template",
  },
  {
    label: "llama.cpp local",
    description: "GGUF-oriented CPU, Metal, or CUDA target.",
    value: "backend llama.cpp · local path",
    status: "template",
  },
];

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
      ? "Stop the running model before launching another recipe."
      : null;

  return (
    <ModelSection
      title="Launch recipes"
      description="Configured controller launch rows."
      actions={
        <ModelStatus tone={recipes.length ? "good" : loading ? "info" : "default"}>
          {recipes.length ? `${recipes.length} rows` : loading ? "syncing" : "defaults"}
        </ModelStatus>
      }
    >
      {loading ? (
        <ModelRow
          label="Controller sync"
          description="Recipe requests are still in flight; stable defaults stay visible below."
          value={<ModelValue dim>Loading controller recipe rows…</ModelValue>}
          status={<ModelStatus tone="info">syncing</ModelStatus>}
        />
      ) : null}

      {launchDisabledReason ? (
        <ModelRow
          label="Launch controls"
          description={launchDisabledReason}
          value={
            <ModelValue dim>Launch buttons are locked until the controller is ready.</ModelValue>
          }
          status={<ModelStatus tone="info">locked</ModelStatus>}
        />
      ) : null}

      {recipes.length
        ? recipes.map((recipe) => (
            <RecipeRow
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
          ))
        : TEMPLATE_ROWS.map((row) => (
            <ModelRow
              key={row.label}
              label={row.label}
              description={
                emptyBecauseSearch
                  ? `No exact match for "${filter.trim()}". ${row.description}`
                  : row.description
              }
              value={<ModelValue mono>{row.value}</ModelValue>}
              status={<ModelStatus>{row.status}</ModelStatus>}
              actions={
                <ModelButton onClick={onNewRecipe}>
                  <Plus className="h-3 w-3" />
                  Use
                </ModelButton>
              }
            />
          ))}

      {attachRecipe ? (
        <AttachLocalAgentsDialog
          modelId={attachRecipe.served_model_name || attachRecipe.id}
          modelName={attachRecipe.name}
          onClose={() => setAttachRecipe(null)}
        />
      ) : null}
    </ModelSection>
  );
}
