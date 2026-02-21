// CRITICAL
"use client";

import { useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { ChatMessage, ChatSessionDetail, StoredMessage } from "@/lib/types";

export interface UseChatSessionBootstrapArgs {
  newChatFromUrl: boolean;
  sessionFromUrl: string | null;
  currentSessionId: string | null;
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  loadSessions: () => void;
  loadSession: (sessionId: string) => Promise<ChatSessionDetail | null | undefined>;
  startNewSession: () => void;
  router: { replace: (href: string) => void };
  setMessages: (messages: ChatMessage[]) => void;
  mapStoredMessages: (messages: StoredMessage[]) => ChatMessage[];
  hydrateAgentState: (session: ChatSessionDetail) => void;
  loadAgentFiles: (args: { sessionId: string }) => void;
  clearPlan: () => void;
  clearAgentFiles: () => void;
  messagesLengthRef: MutableRefObject<number>;
  sessionIdRef: MutableRefObject<string | null>;
  activeRunIdRef: MutableRefObject<string | null>;
  runAbortControllerRef: MutableRefObject<AbortController | null>;
  getLastSessionId: () => string | null;
  setLastSessionId: (sessionId: string) => void;
}

export function useChatSessionBootstrap({
  newChatFromUrl,
  sessionFromUrl,
  currentSessionId,
  selectedModel,
  setSelectedModel,
  loadSessions,
  loadSession,
  startNewSession,
  router,
  setMessages,
  mapStoredMessages,
  hydrateAgentState,
  loadAgentFiles,
  clearPlan,
  clearAgentFiles,
  messagesLengthRef,
  sessionIdRef,
  activeRunIdRef,
  runAbortControllerRef,
  getLastSessionId,
  setLastSessionId,
}: UseChatSessionBootstrapArgs) {
  const clearActiveRun = useCallback(() => {
    if (runAbortControllerRef.current) {
      runAbortControllerRef.current.abort();
      runAbortControllerRef.current = null;
    }
    activeRunIdRef.current = null;
  }, [activeRunIdRef, runAbortControllerRef]);

  const resetActiveSession = useCallback(() => {
    startNewSession();
    clearActiveRun();
  }, [startNewSession, clearActiveRun]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Remember the active session (URL-based navigation will update this too)
  useEffect(() => {
    if (currentSessionId) {
      setLastSessionId(currentSessionId);
    }
  }, [currentSessionId, setLastSessionId]);

  // Handle PWA resume - reload session when app becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;

      // Reload current session to restore messages after PWA was backgrounded
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void (async () => {
        try {
          const session = await loadSession(sessionId);
          if (!session) return;
          const storedMessages = session.messages ?? [];
          // Only restore if we lost messages (PWA was killed)
          if (messagesLengthRef.current === 0 && storedMessages.length > 0) {
            setMessages(mapStoredMessages(storedMessages));
          }
          hydrateAgentState(session);
          void loadAgentFiles({ sessionId: session.id });
        } catch (err) {
          console.error("Failed to restore session on resume:", err);
        }
      })();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    hydrateAgentState,
    loadAgentFiles,
    loadSession,
    mapStoredMessages,
    messagesLengthRef,
    sessionIdRef,
    setMessages,
  ]);

  // Handle URL session/new params and restore last session if needed
  useEffect(() => {
    if (newChatFromUrl) {
      resetActiveSession();
      setMessages([]);
      clearPlan();
      clearAgentFiles();
      return;
    }

    const targetSessionId = sessionFromUrl || getLastSessionId();
    if (!targetSessionId) return;

    // Avoid re-loading the same session repeatedly
    if (targetSessionId === currentSessionId) return;

    resetActiveSession();

    // If the URL is missing session but we have a remembered one, reflect it in the URL
    if (!sessionFromUrl) {
      router.replace(`/chat?session=${encodeURIComponent(targetSessionId)}`);
    }

    void (async () => {
      const session = await loadSession(targetSessionId);
      if (!session) {
        // Stale session ID in URL or localStorage: reset to a new chat so navigation doesn't feel "stuck".
        setLastSessionId("");
        resetActiveSession();
        setMessages([]);
        clearPlan();
        clearAgentFiles();
        if (sessionFromUrl) {
          router.replace("/chat?new=1");
        }
        return;
      }

      if (session.model && session.model !== selectedModel) {
        setSelectedModel(session.model);
      }
      const stored = session.messages ?? [];
      setMessages(mapStoredMessages(stored));
      hydrateAgentState(session);
      void loadAgentFiles({ sessionId: session.id });
    })();
  }, [
    clearAgentFiles,
    clearPlan,
    currentSessionId,
    getLastSessionId,
    hydrateAgentState,
    loadAgentFiles,
    loadSession,
    mapStoredMessages,
    newChatFromUrl,
    resetActiveSession,
    router,
    selectedModel,
    sessionFromUrl,
    setMessages,
    setSelectedModel,
  ]);
}
