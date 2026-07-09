"use client";

import type { Dispatch, SetStateAction } from "react";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { SessionId } from "@/features/agent/runtime/types";
import { useCanvasEffects } from "@/features/agent/tools/canvas-effects";
import { useToolsCatalogueEffects } from "@/features/agent/tools/catalogue-effects";
import type { ComputerState } from "@/features/agent/tools/types";

type ToolsEffectsBridgeProps = {
  catalogueEnabled: boolean;
  canvasEffectsEnabled: boolean;
  setComputer: Dispatch<SetStateAction<ComputerState>>;
  activeCanvasSessionId: SessionId | null;
  onCatalogueLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

export function ToolsEffectsBridge({
  catalogueEnabled,
  canvasEffectsEnabled,
  setComputer,
  activeCanvasSessionId,
  onCatalogueLoaded,
}: ToolsEffectsBridgeProps) {
  useToolsCatalogueEffects({
    enabled: catalogueEnabled,
    onLoaded: onCatalogueLoaded,
  });
  useCanvasEffects({
    enabled: canvasEffectsEnabled,
    setComputer,
    sessionId: activeCanvasSessionId,
  });
  return null;
}
