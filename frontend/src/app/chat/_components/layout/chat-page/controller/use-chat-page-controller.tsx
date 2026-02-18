// CRITICAL
"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { ChatMessage } from "@/lib/types";
import * as Hooks from "../../../../hooks";
import type { SidebarTab } from "../../sidebar/unified-sidebar";
import { buildAgentModeSystemPrompt } from "../../../../utils/agent-system-prompt";
import { getLastSessionId, setLastSessionId } from "./last-session-id";
import type { ChatPageViewProps } from "../view/chat-page-view/types";
import { useChatPageEvents } from "./use-chat-page-events";
import { useChatPageStore } from "./internal/use-chat-page-store";
import { useThinkingSnippet } from "./internal/use-thinking-snippet";
import { useStreamErrorToast } from "./internal/use-stream-error-toast";
import { useChatPageLifecycle } from "./internal/use-chat-page-lifecycle";
import { useChatPageServices } from "./internal/use-chat-page-services";
import { useChatPageContext } from "./internal/use-chat-page-context";
import { useChatPageControllerTail } from "./internal/use-chat-page-controller-tail";

export function useChatPageController(): ChatPageViewProps {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionFromUrl = searchParams.get("session");
  const newChatFromUrl = searchParams.get("new") === "1";

  const store = useChatPageStore();

  const effectiveSystemPrompt = useMemo(() => {
    const base = store.systemPrompt.trim();
    if (!store.agentMode) return base;
    const agentBlock = buildAgentModeSystemPrompt(store.agentPlan);
    return base ? `${base}\n\n${agentBlock}` : agentBlock;
  }, [store.systemPrompt, store.agentMode, store.agentPlan]);

  // Refs
  const messagesLengthRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamStalled, setStreamStalled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("activity");
  const activeRunIdRef = useRef<string | null>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const runCompletedRef = useRef(false);
  const lastEventTimeRef = useRef<number>(0);

  // Track the last user input for title generation
  const lastUserInputRef = useRef<string>("");
  const lastAssistantContentRef = useRef<string>("");

  const {
    agentFiles: agentFilesService,
    agentState,
    sessions,
    tools,
    usage,
    sessionIdRef,
    messageMapping,
    toolResults,
    generateTitle,
    handleRunEvent,
  } = useChatPageServices({
    store,
    setMessages,
    activeRunIdRef,
    lastEventTimeRef,
    runCompletedRef,
    lastUserInputRef,
    lastAssistantContentRef,
    setStreamStalled,
    setIsLoading,
    setStreamError,
  });

  const { hydrateAgentState, persistAgentState, buildAgentState } = agentState;

  const clearPlan = useCallback(() => {
    store.setAgentPlan(null);
    if (sessions.currentSessionId) {
      void persistAgentState(sessions.currentSessionId, buildAgentState(null));
    }
  }, [buildAgentState, persistAgentState, sessions.currentSessionId, store]);

  useChatPageEvents({
    currentSessionId: sessions.currentSessionId,
    hydrateAgentState,
    mapStoredMessages: messageMapping.mapStoredMessages,
    startNewSession: sessions.startNewSession,
    messagesRef,
    setMessages,
  });

  // Derived state from messages
  const activityPanelVisible = sidebarOpen && sidebarTab === "activity";
  const contextPanelVisible = sidebarOpen && sidebarTab === "context";

  const { thinkingActive, thinkingState, activityGroups } = Hooks.useChatDerived({
    messages,
    isLoading,
    executingTools: tools.executingTools,
    toolResultsMap: tools.toolResultsMap,
    enableActivityGroups: activityPanelVisible,
  });

  const activityCount = useMemo(() => {
    if (activityPanelVisible) {
      return activityGroups.reduce((sum, group) => sum + group.items.length, 0);
    }
    if (tools.executingTools.size > 0) return tools.executingTools.size;
    return isLoading ? 1 : 0;
  }, [activityGroups, activityPanelVisible, isLoading, tools.executingTools.size]);

  const thinkingSnippet = useThinkingSnippet({
    isLoading,
    streamStalled,
    executingTools: tools.executingTools,
    toolResultsMap: tools.toolResultsMap,
    thinkingStateContent: thinkingState.content,
    messages,
  });

  useStreamErrorToast({
    streamError,
    currentSessionId: sessions.currentSessionId,
    selectedModel: store.selectedModel || "",
    executingTools: tools.executingTools,
    lastEventTimeRef,
    activeRunIdRef,
  });

  const {
    messagesContainerRef,
    messagesEndRef,
    handleScroll,
    sessionArtifacts,
    artifactsByMessage,
    activeArtifact,
    context,
    compaction,
  } = useChatPageContext({
    store,
    sessions,
    tools,
    agentFiles: agentFilesService,
    agentState,
    messageMapping,
    messages,
    isLoading,
    setMessages,
    effectiveSystemPrompt,
    contextPanelVisible,
    sessionIdRef,
  });

  const { contextStats, contextUsageLabel, contextBreakdown, formatTokenCount } = context;
  const { compactionHistory, compacting, compactionError, runManualCompaction, canManualCompact } =
    compaction;

  useChatPageLifecycle({
    store,
    sessions,
    tools,
    usage,
    agentFiles: agentFilesService,
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
    executingToolsSize: tools.executingTools.size,
    activeRunIdRef,
    runAbortControllerRef,
    lastEventTimeRef,
    setStreamStalled,
    getLastSessionId,
    setLastSessionId,
  });

  return useChatPageControllerTail({
    store,
    sessions,
    tools,
    agentFiles: agentFilesService,
    router,
    sessionFromUrl,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    setSidebarTab,
    messages,
    setMessages,
    isLoading,
    streamError,
    streamStalled,
    setStreamError,
    setIsLoading,
    setStreamStalled,
    clearPlan,
    lastUserInputRef,
    generateTitle,
    handleRunEvent,
    activeRunIdRef,
    runAbortControllerRef,
    runCompletedRef,
    lastEventTimeRef,
    sessionIdRef,
    activityPanelVisible,
    thinkingActive,
    activityGroups,
    activityCount,
    thinkingSnippet,
    executingToolsSize: tools.executingTools.size,
    contextStats,
    contextBreakdown,
    contextUsageLabel,
    compactionHistory,
    compacting,
    compactionError,
    formatTokenCount,
    runManualCompaction,
    canManualCompact,
    sessionArtifacts,
    artifactsByMessage,
    activeArtifact,
    handleScroll,
    messagesContainerRef,
    messagesEndRef,
  });
}
