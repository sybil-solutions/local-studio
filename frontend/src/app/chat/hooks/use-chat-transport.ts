// CRITICAL
"use client";

import { useCallback, useRef, useEffect } from "react";
import { useAppStore } from "@/store";
import type { LanguageModelUsage } from "ai";
import { api } from "@/lib/api";
import type { UIMessage } from "@ai-sdk/react";

interface UseChatTransportOptions {
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  setCurrentSessionTitle: (title: string) => void;
  selectedModel: string;
}

export function useChatTransport({
  currentSessionId,
  setCurrentSessionId,
  setCurrentSessionTitle,
  selectedModel,
}: UseChatTransportOptions) {
  const sessionIdRef = useRef<string | null>(currentSessionId);
  const updateSessions = useAppStore((state) => state.updateSessions);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Persist a UIMessage to the controller
  const persistMessage = useCallback(
    async (sessionId: string, message: UIMessage) => {
      try {
        const metadata = message.metadata as
          | { usage?: LanguageModelUsage; model?: string }
          | undefined;
        const usage = metadata?.usage;
        const promptTokens = usage?.inputTokens;
        const completionTokens = usage?.outputTokens;
        const totalTokens =
          usage?.totalTokens ??
          (promptTokens != null || completionTokens != null
            ? (promptTokens ?? 0) + (completionTokens ?? 0)
            : undefined);

        // Extract text content from parts
        const textContent = message.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");

        // Extract tool calls from parts
        const toolCalls = message.parts
          .filter((p) => p.type.startsWith("tool-") && "toolCallId" in p)
          .map((p) => ({
            id: (p as { toolCallId: string }).toolCallId,
            type: "function" as const,
            function: {
              name: p.type.replace(/^tool-/, ""),
              arguments: "input" in p ? JSON.stringify(p.input) : "{}",
            },
          }));

        const role = message.role === "system" ? "assistant" : message.role;
        await api.addChatMessage(sessionId, {
          id: message.id,
          role,
          content: textContent,
          model: metadata?.model ?? selectedModel,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          request_total_input_tokens: promptTokens,
          request_completion_tokens: completionTokens,
        });
      } catch (err) {
        console.error("Failed to persist message:", err);
      }
    },
    [selectedModel],
  );

  // Create a new session and persist initial user message
  const createSessionWithMessage = useCallback(
    async (userMessage: UIMessage): Promise<string | null> => {
      try {
        const { session } = await api.createChatSession({
          title: "New Chat",
          model: selectedModel,
        });

        setCurrentSessionId(session.id);
        setCurrentSessionTitle(session.title);
        sessionIdRef.current = session.id;
        updateSessions((sessions) => {
          if (sessions.some((existing) => existing.id === session.id)) {
            return sessions;
          }
          return [session, ...sessions];
        });

        // Persist the user message
        await persistMessage(session.id, userMessage);

        return session.id;
      } catch (err) {
        console.error("Failed to create session:", err);
        return null;
      }
    },
    [
      selectedModel,
      setCurrentSessionId,
      setCurrentSessionTitle,
      persistMessage,
      updateSessions,
    ],
  );

  // Generate title from conversation
  const generateTitle = useCallback(
    async (sessionId: string, userContent: string, assistantContent: string) => {
      try {
        const res = await fetch("/api/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            user: userContent,
            assistant: assistantContent,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.title && data.title !== "New Chat") {
            await api.updateChatSession(sessionId, { title: data.title });
            setCurrentSessionTitle(data.title);
            updateSessions((sessions) =>
              sessions.map((session) =>
                session.id === sessionId ? { ...session, title: data.title } : session,
              ),
            );
            return data.title;
          }
        }
      } catch (err) {
        console.error("Failed to generate title:", err);
      }
      return null;
    },
    [selectedModel, setCurrentSessionTitle, updateSessions],
  );

  return {
    persistMessage,
    createSessionWithMessage,
    generateTitle,
    sessionIdRef,
  };
}
