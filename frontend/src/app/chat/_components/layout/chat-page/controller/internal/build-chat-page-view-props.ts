// CRITICAL
"use client";

import type { ChatPageViewProps } from "../../view/chat-page-view/types";
import type { ChatPageStore } from "./types/controller-types";

type UiSlice = Pick<
  ChatPageViewProps,
  | "sidebarOpen"
  | "setSidebarOpen"
  | "sidebarTab"
  | "setSidebarTab"
  | "handleScroll"
  | "messagesContainerRef"
  | "messagesEndRef"
  | "toolBelt"
>;

type DerivedSlice = Pick<
  ChatPageViewProps,
  | "activityGroups"
  | "activityCount"
  | "thinkingActive"
  | "isLoading"
  | "streamError"
  | "streamStalled"
  | "showEmptyState"
>;

type ContextSlice = Pick<
  ChatPageViewProps,
  | "contextStats"
  | "contextBreakdown"
  | "contextUsageLabel"
  | "compactionHistory"
  | "compacting"
  | "compactionError"
  | "formatTokenCount"
  | "runManualCompaction"
  | "canManualCompact"
>;

type ArtifactSlice = Pick<
  ChatPageViewProps,
  "sessionArtifacts" | "artifactsByMessage" | "activeArtifact" | "onCloseArtifactModal"
>;

type AgentFilesSlice = Pick<
  ChatPageViewProps,
  | "agentFiles"
  | "agentFileVersions"
  | "selectedAgentFilePath"
  | "selectedAgentFileContent"
  | "selectedAgentFileLoading"
  | "onSelectAgentFile"
  | "onOpenAgentFile"
>;

type ChatSlice = Pick<
  ChatPageViewProps,
  | "hasSession"
  | "messages"
  | "onForkMessage"
  | "onReprompt"
  | "onListenMessage"
  | "listeningMessageId"
  | "listeningPending"
  | "openActivityPanel"
  | "openContextPanel"
>;

type McpSlice = Pick<
  ChatPageViewProps,
  "mcpServers" | "addMcpServer" | "updateMcpServer" | "removeMcpServer" | "loadMCPServers"
>;

type ExportSlice = Pick<ChatPageViewProps, "onExportJson" | "onExportMarkdown">;

export function buildChatPageViewProps(args: {
  store: ChatPageStore;
  ui: UiSlice;
  derived: DerivedSlice;
  context: ContextSlice;
  artifacts: ArtifactSlice;
  agentFiles: AgentFilesSlice;
  chat: ChatSlice;
  mcp: McpSlice;
  exportActions: ExportSlice;
}): ChatPageViewProps {
  const { store, ui, derived, context, artifacts, agentFiles, chat, mcp, exportActions } = args;

  return {
    sidebarOpen: ui.sidebarOpen,
    setSidebarOpen: ui.setSidebarOpen,
    sidebarTab: ui.sidebarTab,
    setSidebarTab: ui.setSidebarTab,
    sidebarWidth: store.sidebarWidth,
    setSidebarWidth: store.setSidebarWidth,

    activityGroups: derived.activityGroups,
    activityCount: derived.activityCount,
    agentPlan: store.agentPlan,
    thinkingActive: derived.thinkingActive,
    isLoading: derived.isLoading,
    streamError: derived.streamError,
    streamStalled: derived.streamStalled,
    contextStats: context.contextStats,
    contextBreakdown: context.contextBreakdown,
    contextUsageLabel: context.contextUsageLabel,
    compactionHistory: context.compactionHistory,
    compacting: context.compacting,
    compactionError: context.compactionError,
    formatTokenCount: context.formatTokenCount,
    runManualCompaction: context.runManualCompaction,
    canManualCompact: context.canManualCompact,

    artifactsEnabled: store.artifactsEnabled,
    sessionArtifacts: artifacts.sessionArtifacts,
    artifactsByMessage: artifacts.artifactsByMessage,
    activeArtifact: artifacts.activeArtifact,
    onCloseArtifactModal: artifacts.onCloseArtifactModal,

    agentFiles: agentFiles.agentFiles,
    agentFileVersions: agentFiles.agentFileVersions,
    selectedAgentFilePath: agentFiles.selectedAgentFilePath,
    selectedAgentFileContent: agentFiles.selectedAgentFileContent,
    selectedAgentFileLoading: agentFiles.selectedAgentFileLoading,
    onSelectAgentFile: agentFiles.onSelectAgentFile,
    hasSession: chat.hasSession,
    onOpenAgentFile: agentFiles.onOpenAgentFile,

    messages: chat.messages,
    selectedModel: store.selectedModel,
    showEmptyState: derived.showEmptyState,
    onForkMessage: chat.onForkMessage,
    onReprompt: chat.onReprompt,
    onListenMessage: chat.onListenMessage,
    listeningMessageId: chat.listeningMessageId,
    listeningPending: chat.listeningPending,
    openActivityPanel: chat.openActivityPanel,
    openContextPanel: chat.openContextPanel,

    handleScroll: ui.handleScroll,
    messagesContainerRef: ui.messagesContainerRef,
    messagesEndRef: ui.messagesEndRef,
    toolBelt: ui.toolBelt,

    settingsOpen: store.settingsOpen,
    setSettingsOpen: store.setSettingsOpen,
    mcpSettingsOpen: store.mcpSettingsOpen,
    setMcpSettingsOpen: store.setMcpSettingsOpen,
    usageOpen: store.usageOpen,
    setUsageOpen: store.setUsageOpen,
    exportOpen: store.exportOpen,
    setExportOpen: store.setExportOpen,

    systemPrompt: store.systemPrompt,
    setSystemPrompt: store.setSystemPrompt,
    setSelectedModel: store.setSelectedModel,
    availableModels: store.availableModels,
    customChatModels: store.customChatModels,
    onAddCustomChatModel: store.addCustomChatModel,
    onRemoveCustomChatModel: store.removeCustomChatModel,
    deepResearch: store.deepResearch,
    setDeepResearch: store.setDeepResearch,

    mcpServers: mcp.mcpServers,
    addMcpServer: mcp.addMcpServer,
    updateMcpServer: mcp.updateMcpServer,
    removeMcpServer: mcp.removeMcpServer,
    loadMCPServers: mcp.loadMCPServers,

    sessionUsage: store.sessionUsage,

    onExportJson: exportActions.onExportJson,
    onExportMarkdown: exportActions.onExportMarkdown,
  };
}
