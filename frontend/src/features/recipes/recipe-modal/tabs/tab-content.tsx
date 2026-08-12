"use client";

import type { ModelInfo, RuntimeTarget } from "@/lib/types";
import type { RecipeModalTabId } from "./tab-id";
import type { RecipeModalTabProps } from "./tab-props";
import { RecipeModalTabCommand } from "./tab-command";
import { RecipeModalTabEnvironment } from "./tab-environment";
import { RecipeModalTabFeatures } from "./tab-features";
import { RecipeModalTabGeneral } from "./tab-general";
import { RecipeModalTabModel } from "./tab-model";
import { RecipeModalTabPerformance } from "./tab-performance";
import { RecipeModalTabResources } from "./tab-resources";

export type RecipeModalGeneralProps = {
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
  runtimeTargets: RuntimeTarget[];
  installingRuntime: boolean;
  runtimeInstallMessage: string | null;
  onInstallRuntime: (targetId?: string) => void;
};

export type RecipeModalEnvironmentProps = {
  envVarEntries: Array<{ key: string; value: string }>;
  onAddEnvVar: () => void;
  onChangeEnvVar: (index: number, field: "key" | "value", value: string) => void;
  onRemoveEnvVar: (index: number) => void;
  extraArgsText: string;
  extraArgsError: string | null;
  onExtraArgsChange: (value: string) => void;
  llamaConfigLoading: boolean;
  llamaConfigHelp: { config: string | null; error?: string | null } | null;
};

export type RecipeModalCommandProps = {
  recipeSourceText: string;
  recipeSourceError: string | null;
  onRecipeSourceChange: (value: string) => void;
  onFormatRecipeSource: () => void;
  commandText: string;
  generatedCommand: string;
  hasCommandOverride: boolean;
  onCommandChange: (value: string) => void;
  onResetCommand: () => void;
};

const OPTION_TABS = {
  model: RecipeModalTabModel,
  resources: RecipeModalTabResources,
  performance: RecipeModalTabPerformance,
  features: RecipeModalTabFeatures,
} as const;

export function RecipeModalTabContent({
  activeTab,
  tab,
  general,
  environment,
  command,
}: {
  activeTab: RecipeModalTabId;
  tab: RecipeModalTabProps;
  general: RecipeModalGeneralProps;
  environment: RecipeModalEnvironmentProps;
  command: RecipeModalCommandProps;
}) {
  if (activeTab === "general") {
    return <RecipeModalTabGeneral recipe={tab.recipe} onChange={tab.onChange} {...general} />;
  }
  if (activeTab === "environment") {
    return (
      <RecipeModalTabEnvironment
        recipe={tab.recipe}
        onChange={tab.onChange}
        capabilities={tab.capabilities}
        {...environment}
      />
    );
  }
  if (activeTab === "command") {
    return <RecipeModalTabCommand {...command} />;
  }
  const OptionTab = OPTION_TABS[activeTab];
  return <OptionTab {...tab} />;
}
