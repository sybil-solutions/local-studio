// CRITICAL
"use client";

import { useMemo, type ReactNode } from "react";
import { AgentPlanDrawer } from "../../../../agent/agent-plan-drawer";
import { ToolBelt } from "../../../../input/tool-belt";
import type { AgentPlan } from "../../../../agent/agent-types";
import type { Attachment, ModelOption } from "@/app/chat/types";
import type { DeepResearchConfig } from "@/lib/types";

export interface UseChatToolBeltArgs {
  isLoading: boolean;
  thinkingSnippet: string;
  selectedModel: string;
  availableModels: ModelOption[];
  onModelChange: (modelId: string) => void;
  systemPrompt: string;

  mcpEnabled: boolean;
  onMcpToggle: () => void;
  artifactsEnabled: boolean;
  onArtifactsToggle: () => void;
  deepResearch: DeepResearchConfig;
  onDeepResearchToggle: () => void;

  onOpenResults: () => void;
  onOpenMcpSettings: () => void;
  onOpenChatSettings: () => void;

  agentPlan: AgentPlan | null;
  clearPlan: () => void;

  onSubmit: (text: string, attachments?: Attachment[]) => Promise<void>;
  onStop: () => Promise<void>;

  callModeEnabled: boolean;
  onCallModeToggle: () => void;
}

export function useChatToolBelt({
  isLoading,
  thinkingSnippet,
  selectedModel,
  availableModels,
  onModelChange,
  systemPrompt,
  mcpEnabled,
  onMcpToggle,
  artifactsEnabled,
  onArtifactsToggle,
  deepResearch,
  onDeepResearchToggle,
  onOpenResults,
  onOpenMcpSettings,
  onOpenChatSettings,
  agentPlan,
  clearPlan,
  onSubmit,
  onStop,
  callModeEnabled,
  onCallModeToggle,
}: UseChatToolBeltArgs) {
  return useMemo(() => {
    return (
      <ToolBelt
        onSubmit={onSubmit}
        onStop={onStop}
        disabled={false}
        isLoading={isLoading}
        thinkingSnippet={thinkingSnippet}
        placeholder={selectedModel ? "Message..." : "Select a model"}
        onOpenResults={onOpenResults}
        selectedModel={selectedModel}
        availableModels={availableModels}
        onModelChange={onModelChange}
        mcpEnabled={mcpEnabled}
        onMcpToggle={onMcpToggle}
        artifactsEnabled={artifactsEnabled}
        onArtifactsToggle={onArtifactsToggle}
        deepResearchEnabled={deepResearch.enabled}
        onDeepResearchToggle={onDeepResearchToggle}
        onOpenMcpSettings={onOpenMcpSettings}
        onOpenChatSettings={onOpenChatSettings}
        hasSystemPrompt={systemPrompt.trim().length > 0}
        planDrawer={agentPlan ? <AgentPlanDrawer plan={agentPlan} onClear={clearPlan} /> : null}
        callModeEnabled={callModeEnabled}
        onCallModeToggle={onCallModeToggle}
      />
    );
  }, [
    agentPlan,
    artifactsEnabled,
    availableModels,
    callModeEnabled,
    clearPlan,
    deepResearch.enabled,
    isLoading,
    mcpEnabled,
    onArtifactsToggle,
    onCallModeToggle,
    onDeepResearchToggle,
    onMcpToggle,
    onModelChange,
    onOpenChatSettings,
    onOpenMcpSettings,
    onOpenResults,
    onStop,
    onSubmit,
    selectedModel,
    systemPrompt,
    thinkingSnippet,
  ]);
}
