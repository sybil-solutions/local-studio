// CRITICAL
"use client";

import { useCallback, type MutableRefObject } from "react";
import api from "@/lib/api";
import type { ChatMessage, ChatSession, ToolResult } from "@/lib/types";
import type { ChatRunStreamEvent } from "@/lib/api";
import { useChatRunStream } from "../../../chat-run-stream";
import { useChatSendUserMessage } from "../../../chat-send-user-message";
import type { Attachment } from "@/app/chat/types";
import type {
  AgentFilesService,
  ChatPageStore,
  ChatSessionsService,
  RouterLike,
  SetMessages,
  SessionIdRef,
} from "../types/controller-types";

export interface UseChatRunActionsArgs {
  store: ChatPageStore;
  sessions: ChatSessionsService;
  agentFiles: AgentFilesService;

  isLoading: boolean;
  setMessages: SetMessages;
  setStreamError: (next: string | null) => void;

  lastUserInputRef: MutableRefObject<string>;
  replaceUrlToSession: (sessionId: string) => void;
  generateTitle: (sessionId: string, user: string, assistant: string) => Promise<string | null>;
  setLastSessionId: (sessionId: string) => void;

  activeRunIdRef: MutableRefObject<string | null>;
  runAbortControllerRef: MutableRefObject<AbortController | null>;
  runCompletedRef: MutableRefObject<boolean>;
  lastEventTimeRef: MutableRefObject<number>;
  sessionIdRef: SessionIdRef;
  setIsLoading: (next: boolean) => void;
  setStreamStalled: (next: boolean) => void;
  setExecutingTools: (next: Set<string>) => void;
  setToolResultsMap: (next: Map<string, ToolResult>) => void;
  handleRunEvent: (event: ChatRunStreamEvent) => void;
  router: RouterLike;
}

export function useChatRunActions({
  store,
  sessions,
  agentFiles,
  isLoading,
  setMessages,
  setStreamError,
  lastUserInputRef,
  replaceUrlToSession,
  generateTitle,
  setLastSessionId,
  activeRunIdRef,
  runAbortControllerRef,
  runCompletedRef,
  lastEventTimeRef,
  sessionIdRef,
  setIsLoading,
  setStreamStalled,
  setExecutingTools,
  setToolResultsMap,
  handleRunEvent,
  router,
}: UseChatRunActionsArgs) {
  const { startRunStream } = useChatRunStream({
    activeRunIdRef,
    runAbortControllerRef,
    runCompletedRef,
    lastEventTimeRef,
    sessionIdRef,
    setIsLoading,
    setStreamError,
    setStreamStalled,
    setExecutingTools,
    setToolResultsMap,
    handleRunEvent,
  });

  const { sendUserMessage } = useChatSendUserMessage({
    selectedModel: store.selectedModel,
    systemPrompt: store.systemPrompt,
    mcpEnabled: store.mcpEnabled,
    deepResearchEnabled: store.deepResearch.enabled,
    agentMode: store.agentMode,
    currentSessionId: sessions.currentSessionId,
    currentSessionTitle: sessions.currentSessionTitle,
    isLoading,
    agentFiles: agentFiles.agentFiles,
    agentFileVersions: agentFiles.agentFileVersions,
    setInput: store.setInput,
    setMessages,
    setStreamError,
    setStreamingStartTime: store.setStreamingStartTime,
    lastUserInputRef,
    createSession: sessions.createSession,
    setLastSessionId,
    replaceUrlToSession,
    generateTitle,
    startRunStream,
    loadAgentFiles: agentFiles.loadAgentFiles,
  });

  const handleSend = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      await sendUserMessage(text, attachments, { clearInput: true });
    },
    [sendUserMessage],
  );

  const handleReprompt = useCallback(
    async (messageId: string, messages: ChatMessage[]) => {
      if (isLoading) return;
      const messageIndex = messages.findIndex((msg) => msg.id === messageId);
      if (messageIndex <= 0) return;

      const previousUser = [...messages.slice(0, messageIndex)]
        .reverse()
        .find((msg) => msg.role === "user");

      if (!previousUser) return;

      const userText = previousUser.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");

      if (!userText.trim()) return;
      await sendUserMessage(userText);
    },
    [isLoading, sendUserMessage],
  );

  const handleForkMessage = useCallback(
    async (messageId: string) => {
      if (!sessions.currentSessionId) return;
      try {
        const { session } = await api.forkChatSession(sessions.currentSessionId, {
          message_id: messageId,
          model: store.selectedModel || undefined,
          title: "New Chat",
        });
        store.updateSessions((sessionsList) => {
          if (sessionsList.some((existing: ChatSession) => existing.id === session.id)) {
            return sessionsList.map((existing: ChatSession) =>
              existing.id === session.id ? session : existing,
            );
          }
          return [session, ...sessionsList];
        });
        router.push(`/chat?session=${session.id}`);
      } catch (err) {
        console.error("Failed to fork session:", err);
      }
    },
    [router, sessions.currentSessionId, store],
  );

  const handleStop = useCallback(async () => {
    runAbortControllerRef.current?.abort();
    const runId = activeRunIdRef.current;
    if (runId && sessions.currentSessionId) {
      try {
        await api.abortChatRun(sessions.currentSessionId, runId);
      } catch (err) {
        console.warn("Failed to abort run:", err);
      }
    }
    activeRunIdRef.current = null;
    store.setStreamingStartTime(null);
    store.setElapsedSeconds(0);
    setIsLoading(false);
    // Clear tool execution state so amber spinners don't get stuck
    setExecutingTools(new Set());
  }, [activeRunIdRef, runAbortControllerRef, sessions.currentSessionId, setIsLoading, setExecutingTools, store]);

  return { handleSend, handleReprompt, handleForkMessage, handleStop };
}
