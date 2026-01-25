// CRITICAL
"use client";

import { useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { ChatSession } from "@/lib/types";
import { useAppStore } from "@/store";

export function useChatSessions() {
  const sessions = useAppStore((state) => state.sessions);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const currentSessionTitle = useAppStore((state) => state.currentSessionTitle);
  const sessionsLoading = useAppStore((state) => state.sessionsLoading);
  const setSessions = useAppStore((state) => state.setSessions);
  const updateSessions = useAppStore((state) => state.updateSessions);
  const setCurrentSessionId = useAppStore((state) => state.setCurrentSessionId);
  const setCurrentSessionTitle = useAppStore((state) => state.setCurrentSessionTitle);
  const setSessionsLoading = useAppStore((state) => state.setSessionsLoading);
  const activeSessionRef = useRef<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await api.getChatSessions();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setSessionsLoading(false);
    }
  }, [setSessions, setSessionsLoading]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (activeSessionRef.current === sessionId) return;
    activeSessionRef.current = sessionId;

    try {
      const data = await api.getChatSession(sessionId);
      setCurrentSessionId(sessionId);
      setCurrentSessionTitle(data.session?.title || "Chat");
      // Messages are managed by useChat, we just load metadata
      return data.session ?? null;
    } catch (err) {
      console.error("Failed to load session:", err);
      return null;
    }
  }, [setCurrentSessionId, setCurrentSessionTitle]);

  const startNewSession = useCallback(() => {
    activeSessionRef.current = null;
    setCurrentSessionId(null);
    setCurrentSessionTitle("New Chat");
  }, [setCurrentSessionId, setCurrentSessionTitle]);

  const createSession = useCallback(async (title: string, model?: string) => {
    try {
      const { session } = await api.createChatSession({
        title,
        model,
      });
      updateSessions((prev) => [session, ...prev]);
      setCurrentSessionId(session.id);
      setCurrentSessionTitle(session.title);
      activeSessionRef.current = session.id;
      return session;
    } catch (err) {
      console.error("Failed to create session:", err);
      return null;
    }
  }, [setCurrentSessionId, setCurrentSessionTitle, updateSessions]);

  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      try {
        await api.updateChatSession(sessionId, { title });
        updateSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
        if (currentSessionId === sessionId) {
          setCurrentSessionTitle(title);
        }
      } catch (err) {
        console.error("Failed to update session title:", err);
      }
    },
    [currentSessionId, setCurrentSessionTitle, updateSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await api.deleteChatSession(sessionId);
        updateSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (currentSessionId === sessionId) {
          startNewSession();
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [currentSessionId, startNewSession, updateSessions],
  );

  return {
    sessions,
    currentSessionId,
    currentSessionTitle,
    sessionsLoading,
    loadSessions,
    loadSession,
    startNewSession,
    createSession,
    updateSessionTitle,
    deleteSession,
    setCurrentSessionId,
    setCurrentSessionTitle,
  };
}
