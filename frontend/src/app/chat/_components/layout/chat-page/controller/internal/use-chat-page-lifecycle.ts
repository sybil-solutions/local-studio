// CRITICAL
"use client";

import { useEffect, type MutableRefObject } from "react";
import type { ChatMessage } from "@/lib/types";
import { useChatSessionBootstrap } from "../../chat-session-bootstrap";
import { useChatPageTimers } from "../use-chat-page-timers";
import type {
  AgentFilesService,
  AgentStateService,
  ChatPageStore,
  ChatSessionsService,
  ChatToolsService,
  ChatUsageService,
  MessageMappingService,
  MessagesLengthRef,
  MessagesRef,
  RouterLike,
  SessionIdRef,
  SetMessages,
} from "./types/controller-types";

export interface UseChatPageLifecycleArgs {
  store: ChatPageStore;
  sessions: ChatSessionsService;
  tools: ChatToolsService;
  usage: ChatUsageService;
  agentFiles: AgentFilesService;
  agentState: AgentStateService;
  messageMapping: MessageMappingService;

  messages: ChatMessage[];
  setMessages: SetMessages;
  messagesRef: MessagesRef;
  messagesLengthRef: MessagesLengthRef;
  sessionIdRef: SessionIdRef;

  newChatFromUrl: boolean;
  sessionFromUrl: string | null;

  isLoading: boolean;
  router: RouterLike;

  clearPlan: () => void;
  executingToolsSize: number;
  activeRunIdRef: MutableRefObject<string | null>;
  runAbortControllerRef: MutableRefObject<AbortController | null>;
  lastEventTimeRef: MutableRefObject<number>;
  setStreamStalled: (next: boolean) => void;

  getLastSessionId: () => string | null;
  setLastSessionId: (sessionId: string) => void;
}

export function useChatPageLifecycle({
  store,
  sessions,
  tools,
  usage,
  agentFiles,
  agentState,
  messageMapping,
  messages,
  setMessages,
  messagesRef,
  messagesLengthRef,
  sessionIdRef,
  newChatFromUrl,
  sessionFromUrl,
  isLoading,
  router,
  clearPlan,
  executingToolsSize,
  activeRunIdRef,
  runAbortControllerRef,
  lastEventTimeRef,
  setStreamStalled,
  getLastSessionId,
  setLastSessionId,
}: UseChatPageLifecycleArgs) {
  const { clearAgentFiles, loadAgentFiles } = agentFiles;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages, messagesRef]);

  useEffect(() => {
    messagesLengthRef.current = messages.length;
  }, [messages.length, messagesLengthRef]);

  useEffect(() => {
    store.setExecutingTools(new Set());
    store.setToolResultsMap(new Map());
  }, [sessions.currentSessionId, store]);

  useEffect(() => {
    if (!sessions.currentSessionId) {
      clearPlan();
      clearAgentFiles();
    }
  }, [clearPlan, clearAgentFiles, sessions.currentSessionId]);

  useChatPageTimers({
    isLoading,
    streamingStartTime: store.streamingStartTime,
    setStreamingStartTime: store.setStreamingStartTime,
    setElapsedSeconds: store.setElapsedSeconds,
    executingToolsSize,
    activeRunIdRef,
    lastEventTimeRef,
    setStreamStalled,
  });

  useChatSessionBootstrap({
    newChatFromUrl,
    sessionFromUrl,
    currentSessionId: sessions.currentSessionId,
    selectedModel: store.selectedModel,
    setSelectedModel: store.setSelectedModel,
    loadSessions: sessions.loadSessions,
    loadSession: sessions.loadSession,
    startNewSession: sessions.startNewSession,
    router,
    setMessages,
    mapStoredMessages: messageMapping.mapStoredMessages,
    hydrateAgentState: agentState.hydrateAgentState,
    loadAgentFiles,
    clearPlan,
    clearAgentFiles,
    messagesLengthRef,
    sessionIdRef,
    activeRunIdRef,
    runAbortControllerRef,
    getLastSessionId,
    setLastSessionId,
  });

  // Load MCP servers/tools when enabled
  const { loadMCPServers, loadMCPTools } = tools;
  useEffect(() => {
    if (!store.mcpEnabled) return;
    void loadMCPServers().then(() => {
      void loadMCPTools();
    });
  }, [store.mcpEnabled, loadMCPServers, loadMCPTools]);

  // Load agent files when agent mode is enabled
  useEffect(() => {
    if (!store.agentMode || !sessions.currentSessionId) return;
    void loadAgentFiles({ sessionId: sessions.currentSessionId });
  }, [loadAgentFiles, sessions.currentSessionId, store.agentMode]);

  // Load MCP servers when settings modal opens
  useEffect(() => {
    if (store.mcpSettingsOpen) {
      loadMCPServers();
    }
  }, [store.mcpSettingsOpen, loadMCPServers]);

  // Refresh usage when modal opens
  useEffect(() => {
    if (store.usageOpen && sessions.currentSessionId) {
      usage.refreshUsage(sessions.currentSessionId);
    }
  }, [sessions.currentSessionId, store.usageOpen, usage]);
}
