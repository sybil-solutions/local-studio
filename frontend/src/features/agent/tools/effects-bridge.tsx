"use client";

import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import { useToolsCatalogueEffects } from "@/features/agent/tools/catalogue-effects";

type ToolsEffectsBridgeProps = {
  catalogueEnabled: boolean;
  onCatalogueLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

export function ToolsEffectsBridge({
  catalogueEnabled,
  onCatalogueLoaded,
}: ToolsEffectsBridgeProps) {
  useToolsCatalogueEffects({
    enabled: catalogueEnabled,
    onLoaded: onCatalogueLoaded,
  });
  return null;
}
