"use client";

import { Drawer, DrawerBody, DrawerHeader } from "@/ui/drawer";
import type { ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { ENGINE_LABEL } from "@/features/recipes/engine-capabilities";
import { engineNodeStyle } from "@/features/recipes/recipe-labels";
import { preferredRuntimeForBackend } from "@/features/recipes/serve-runtime-options";
import { RecipeModalTabBar } from "./recipe-modal-tab-bar";
import { RecipeModalTabContent } from "./tabs/tab-content";
import { useRecipeModalModel } from "./recipe-modal-model";
import { RecipeModalSummary } from "./recipe-modal-summary";
import { RecipeModalFooter } from "./recipe-modal-footer";

export function RecipeModal({
  recipe,
  onClose,
  onSave,
  onChange,
  saving,
  availableModels,
  runtimeTargets,
  recipes,
}: {
  recipe: RecipeEditor;
  onClose: () => void;
  onSave: () => void;
  onChange: (recipe: RecipeEditor) => void;
  saving: boolean;
  availableModels: ModelInfo[];
  runtimeTargets: RuntimeTarget[];
  recipes: RecipeWithStatus[];
}) {
  const model = useRecipeModalModel({ recipe, onChange, recipes });
  const { backend, capabilities, safeActiveTab, applyRecipeChange, runtimeInstallation } = model;
  const engineStyle = engineNodeStyle(backend);

  return (
    <Drawer width={880}>
      <DrawerHeader
        title={recipe.id ? recipe.name || "Edit Serve" : "New Serve"}
        badge={
          <span
            className={`inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[length:var(--fs-2xs)] font-medium ${engineStyle.bg} ${engineStyle.fg}`}
          >
            {ENGINE_LABEL[backend]}
          </span>
        }
        onClose={onClose}
      />

      <RecipeModalTabBar
        tabs={capabilities.tabs}
        activeTab={safeActiveTab}
        onSelectTab={model.setActiveTab}
      />

      <DrawerBody>
        <div className="space-y-5">
          <RecipeModalSummary
            recipe={recipe}
            backend={backend}
            commandOverridden={model.hasCommandOverride}
            onBackendChange={(next) =>
              applyRecipeChange({
                ...recipe,
                backend: next,
                runtime: preferredRuntimeForBackend(next, runtimeTargets),
                python_path: null,
              })
            }
          />
          <RecipeModalTabContent
            activeTab={safeActiveTab}
            tab={{
              recipe,
              onChange: applyRecipeChange,
              capabilities,
              getExtraArgValueForKey: model.getExtraArgValueForKeyLocal,
              setExtraArgValueForKey: model.setExtraArgValueForKeyLocal,
            }}
            general={{
              availableModels,
              modelServedNames: model.modelServedNames,
              runtimeTargets,
              installingRuntime: runtimeInstallation.installing,
              runtimeInstallMessage: runtimeInstallation.message,
              onInstallRuntime: runtimeInstallation.install,
            }}
            environment={{
              envVarEntries: model.envVarEntries,
              onAddEnvVar: model.handleAddEnvVar,
              onChangeEnvVar: model.handleEnvVarChange,
              onRemoveEnvVar: model.handleRemoveEnvVar,
              extraArgsText: model.extraArgsText,
              extraArgsError: model.extraArgsError,
              onExtraArgsChange: model.handleExtraArgsChange,
              llamaConfigLoading: model.llamaConfigLoading,
              llamaConfigHelp: model.llamaConfigHelp,
            }}
            command={{
              recipeSourceText: model.recipeSourceText,
              recipeSourceError: model.recipeSourceError,
              onRecipeSourceChange: model.handleRecipeSourceChange,
              onFormatRecipeSource: model.handleRecipeSourceFormat,
              commandText: model.commandText,
              generatedCommand: model.generatedCommand,
              hasCommandOverride: model.hasCommandOverride,
              onCommandChange: model.handleCommandChange,
              onResetCommand: model.handleCommandReset,
            }}
          />
        </div>
      </DrawerBody>

      <RecipeModalFooter
        recipe={recipe}
        saving={saving}
        extraArgsError={model.extraArgsError}
        recipeSourceError={model.recipeSourceError}
        onClose={onClose}
        onSave={onSave}
      />
    </Drawer>
  );
}
