// CRITICAL
"use client";

import * as Hooks from "@/app/chat/hooks";
import type { ChatMessage } from "@/lib/types";
import type {
  AgentFilesService,
  AgentStateService,
  ChatPageStore,
  ChatSessionsService,
  ChatToolsService,
  MessageMappingService,
  SessionIdRef,
  SetMessages,
} from "./types/controller-types";

export interface UseChatPageContextArgs {
  store: ChatPageStore;
  sessions: ChatSessionsService;
  tools: ChatToolsService;
  agentFiles: AgentFilesService;
  agentState: AgentStateService;
  messageMapping: MessageMappingService;

  messages: ChatMessage[];
  isLoading: boolean;
  setMessages: SetMessages;

  effectiveSystemPrompt: string;
  contextPanelVisible: boolean;
  sessionIdRef: SessionIdRef;
}

export function useChatPageContext({
  store,
  sessions,
  tools,
  agentFiles,
  agentState,
  messageMapping,
  messages,
  isLoading,
  setMessages,
  effectiveSystemPrompt,
  contextPanelVisible,
  sessionIdRef,
}: UseChatPageContextArgs) {
  Hooks.useAvailableModels({
    selectedModel: store.selectedModel,
    setSelectedModel: store.setSelectedModel,
    setAvailableModels: store.setAvailableModels,
    customChatModels: store.customChatModels,
  });

  const { messagesContainerRef, messagesEndRef, handleScroll } = Hooks.useChatScroll({
    isLoading,
    messageCount: messages.length,
  });

  const { sessionArtifacts, artifactsByMessage, activeArtifact, clearArtifactsCache } =
    Hooks.useChatArtifacts({
      messages,
      artifactsEnabled: store.artifactsEnabled,
      currentSessionId: sessions.currentSessionId,
      activeArtifactId: store.activeArtifactId,
      setActiveArtifactId: store.setActiveArtifactId,
    });

  const context = Hooks.useChatContext({
    messages,
    selectedModel: store.selectedModel,
    availableModels: store.availableModels,
    effectiveSystemPrompt,
    contextPanelVisible,
    getToolDefinitions: tools.getToolDefinitions,
    isToolPart: messageMapping.isToolPart,
  });

  const compaction = Hooks.useChatCompaction({
    currentSessionId: sessions.currentSessionId,
    currentSessionTitle: sessions.currentSessionTitle,
    selectedModel: store.selectedModel,
    effectiveSystemPrompt,
    messages,
    isLoading,
    maxContext: context.maxContext,
    contextStats: context.contextStats,
    contextConfig: context.contextConfig,
    contextMessages: context.contextMessages,
    calculateMessageTokens: context.calculateMessageTokens,
    mapStoredMessages: messageMapping.mapStoredMessages,
    buildContextContent: context.buildContextContent,
    updateSessions: store.updateSessions,
    setCurrentSessionId: sessions.setCurrentSessionId,
    setCurrentSessionTitle: sessions.setCurrentSessionTitle,
    setMessages,
    hydrateAgentState: agentState.hydrateAgentState,
    loadAgentFiles: agentFiles.loadAgentFiles,
    sessionIdRef,
    clearArtifactsCache,
  });

  return {
    messagesContainerRef,
    messagesEndRef,
    handleScroll,
    sessionArtifacts,
    artifactsByMessage,
    activeArtifact,
    clearArtifactsCache,
    context,
    compaction,
  };
}
