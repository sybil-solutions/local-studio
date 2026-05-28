"use client";

import type { ModelInfo, RecipeEditor } from "@/lib/types";
import type { RecipeModalTabId } from "./tab-id";
import { RecipeModalTabCommand } from "./tab-command";
import { RecipeModalTabEnvironment } from "./tab-environment";
import { RecipeModalTabFeatures } from "./tab-features";
import { RecipeModalTabGeneral } from "./tab-general";
import { RecipeModalTabModel } from "./tab-model";
import { RecipeModalTabPerformance } from "./tab-performance";
import { RecipeModalTabResources } from "./tab-resources";

export function RecipeModalTabContent({
  activeTab,
  recipe,
  onChange,
  availableModels,
  modelServedNames,
  isLlamacpp,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
  envVarEntries,
  onAddEnvVar,
  onChangeEnvVar,
  onRemoveEnvVar,
  extraArgsText,
  extraArgsError,
  onExtraArgsChange,
  llamaConfigLoading,
  llamaConfigHelp,
  commandText,
  onCommandChange,
}: {
  activeTab: RecipeModalTabId;
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
  isLlamacpp: boolean;
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
  envVarEntries: Array<{ key: string; value: string }>;
  onAddEnvVar: () => void;
  onChangeEnvVar: (index: number, field: "key" | "value", value: string) => void;
  onRemoveEnvVar: (index: number) => void;
  extraArgsText: string;
  extraArgsError: string | null;
  onExtraArgsChange: (value: string) => void;
  llamaConfigLoading: boolean;
  llamaConfigHelp: { config: string | null; error?: string | null } | null;
  commandText: string;
  onCommandChange: (value: string) => void;
}) {
  switch (activeTab) {
    case "general":
      return (
        <RecipeModalTabGeneral
          recipe={recipe}
          onChange={onChange}
          availableModels={availableModels}
          modelServedNames={modelServedNames}
        />
      );
    case "model":
      return (
        <RecipeModalTabModel
          recipe={recipe}
          onChange={onChange}
          isLlamacpp={isLlamacpp}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "resources":
      return (
        <RecipeModalTabResources
          recipe={recipe}
          onChange={onChange}
          isLlamacpp={isLlamacpp}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "performance":
      return (
        <RecipeModalTabPerformance
          recipe={recipe}
          onChange={onChange}
          isLlamacpp={isLlamacpp}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "features":
      return (
        <RecipeModalTabFeatures
          recipe={recipe}
          onChange={onChange}
          isLlamacpp={isLlamacpp}
          getExtraArgValueForKey={getExtraArgValueForKey}
          setExtraArgValueForKey={setExtraArgValueForKey}
        />
      );
    case "environment":
      return (
        <RecipeModalTabEnvironment
          recipe={recipe}
          onChange={onChange}
          isLlamacpp={isLlamacpp}
          envVarEntries={envVarEntries}
          onAddEnvVar={onAddEnvVar}
          onChangeEnvVar={onChangeEnvVar}
          onRemoveEnvVar={onRemoveEnvVar}
          extraArgsText={extraArgsText}
          extraArgsError={extraArgsError}
          onExtraArgsChange={onExtraArgsChange}
          llamaConfigLoading={llamaConfigLoading}
          llamaConfigHelp={llamaConfigHelp}
        />
      );
    case "command":
      return <RecipeModalTabCommand commandText={commandText} onCommandChange={onCommandChange} />;
  }
}
