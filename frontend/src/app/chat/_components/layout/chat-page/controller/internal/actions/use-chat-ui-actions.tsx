// CRITICAL
"use client";

import { useCallback } from "react";
import type { SidebarTab } from "../../../../sidebar/unified-sidebar";
import type { Attachment } from "@/app/chat/types";
import { useChatSidebarController } from "../../chat-sidebar-controller";
import { useChatToolBelt } from "../use-chat-tool-belt";
import type { AgentFilesService, ChatPageStore, ChatSessionsService } from "../types/controller-types";

export interface UseChatUiActionsArgs {
  store: ChatPageStore;
  sessions: ChatSessionsService;
  agentFiles: AgentFilesService;
  isLoading: boolean;
  thinkingSnippet: string;

  clearPlan: () => void;
  onSubmit: (text: string, attachments?: Attachment[]) => Promise<void>;
  onStop: () => Promise<void>;

  sidebarOpen: boolean;
  setSidebarOpen: (next: boolean) => void;
  setSidebarTab: (next: SidebarTab) => void;

  sessionFromUrl: string | null;

  activityPanelVisible: boolean;
  thinkingActive: boolean;
  executingToolsSize: number;
  activityGroupsLength: number;

  callModeEnabled: boolean;
  onCallModeToggle: () => void;
}

export function useChatUiActions({
  store,
  sessions,
  agentFiles,
  isLoading,
  thinkingSnippet,
  clearPlan,
  onSubmit,
  onStop,
  sidebarOpen,
  setSidebarOpen,
  setSidebarTab,
  sessionFromUrl,
  activityPanelVisible,
  thinkingActive,
  executingToolsSize,
  activityGroupsLength,
  callModeEnabled,
  onCallModeToggle,
}: UseChatUiActionsArgs) {
  const handleModelChange = useCallback(
    (modelId: string) => {
      store.setSelectedModel(modelId);
      localStorage.setItem("vllm-studio-last-model", modelId);
    },
    [store],
  );

  const handleMcpToggle = useCallback(() => {
    store.setMcpEnabled(!store.mcpEnabled);
  }, [store]);

  const handleArtifactsToggle = useCallback(() => {
    store.setArtifactsEnabled(!store.artifactsEnabled);
  }, [store]);

  const handleDeepResearchToggle = useCallback(() => {
    const nextEnabled = !store.deepResearch.enabled;
    store.setDeepResearch({ ...store.deepResearch, enabled: nextEnabled });
    if (nextEnabled && !store.mcpEnabled) store.setMcpEnabled(true);
  }, [store]);

  const handleOpenMcpSettings = useCallback(() => {
    store.setMcpSettingsOpen(true);
  }, [store]);

  const handleOpenChatSettings = useCallback(() => {
    store.setSettingsOpen(true);
  }, [store]);

  const handleSetSidebarTab = useCallback(
    (tab: SidebarTab) => {
      setSidebarTab(tab);
      store.setResultsLastTab(tab);
    },
    [setSidebarTab, store],
  );

  const handleOpenResults = useCallback(() => {
    setSidebarOpen(true);
    handleSetSidebarTab(store.resultsLastTab ?? "activity");
  }, [handleSetSidebarTab, setSidebarOpen, store.resultsLastTab]);

  const toolBelt = useChatToolBelt({
    isLoading,
    thinkingSnippet,
    selectedModel: store.selectedModel,
    availableModels: store.availableModels,
    onModelChange: handleModelChange,
    systemPrompt: store.systemPrompt,
    mcpEnabled: store.mcpEnabled,
    onMcpToggle: handleMcpToggle,
    artifactsEnabled: store.artifactsEnabled,
    onArtifactsToggle: handleArtifactsToggle,
    deepResearch: store.deepResearch,
    onDeepResearchToggle: handleDeepResearchToggle,
    onOpenResults: handleOpenResults,
    onOpenMcpSettings: handleOpenMcpSettings,
    onOpenChatSettings: handleOpenChatSettings,
    agentPlan: store.agentPlan,
    clearPlan,
    onSubmit,
    onStop,
    callModeEnabled,
    onCallModeToggle,
  });

  const { openActivityPanel, openContextPanel, handleOpenAgentFile } = useChatSidebarController({
    currentSessionId: sessions.currentSessionId,
    sessionFromUrl,
    activityPanelVisible,
    thinkingActive,
    isLoading,
    executingToolsSize,
    activityGroupsLength,
    sidebarOpen,
    setSidebarOpen,
    setSidebarTab: handleSetSidebarTab,
    selectAgentFile: agentFiles.selectAgentFile,
  });

  const handleSelectAgentFile = useCallback(
    (path: string | null) => agentFiles.selectAgentFile(path, sessionFromUrl || sessions.currentSessionId),
    [agentFiles, sessionFromUrl, sessions.currentSessionId],
  );

  return {
    toolBelt,
    handleSetSidebarTab,
    openActivityPanel,
    openContextPanel,
    handleOpenAgentFile,
    handleSelectAgentFile,
  };
}
