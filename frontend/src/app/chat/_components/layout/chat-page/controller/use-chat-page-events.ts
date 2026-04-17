// CRITICAL
"use client";

import { useEffect } from "react";
import type { ChatMessage, ChatSessionDetail, StoredMessage } from "@/lib/types";
import { mergeToolParts } from "../../../../hooks/chat/use-chat-message-mapping/helpers";

export interface UseChatPageEventsArgs {
  currentSessionId: string | null;
  hydrateAgentState: (session: ChatSessionDetail) => void;
  mapStoredMessages: (messages: StoredMessage[]) => ChatMessage[];
  startNewSession: () => void;
  updateMessages: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void;
}

export function useChatPageEvents({
  currentSessionId,
  hydrateAgentState,
  mapStoredMessages,
  startNewSession,
  updateMessages,
}: UseChatPageEventsArgs) {
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ type?: string; data?: Record<string, unknown> }>;
      const type = custom.detail?.type;
      const data = custom.detail?.data ?? {};
      if (!type || !data) return;

      switch (type) {
        case "chat_message_upserted": {
          const sessionId = String(data["session_id"] ?? "");
          if (!currentSessionId || sessionId !== currentSessionId) return;
          const message = data["message"] as StoredMessage | undefined;
          if (!message) return;
          const mapped = mapStoredMessages([message])[0];
          if (!mapped) return;
          updateMessages((current) => {
            const index = current.findIndex((entry) => entry.id === mapped.id);
            if (index < 0) return [...current, mapped];
            // Preserve tool parts already merged into the streaming version of
            // this message (e.g. from a collapsed tool-only sibling) — the
            // persisted DB record for a text reply doesn't include them, so a
            // naive replace wipes the inline diff.
            const existing = current[index];
            const merged: ChatMessage = {
              ...mapped,
              parts: mergeToolParts(existing.parts, mapped.parts),
            };
            return [...current.slice(0, index), merged, ...current.slice(index + 1)];
          });
          break;
        }
        case "chat_session_deleted": {
          const sessionId = String(data["session_id"] ?? "");
          if (currentSessionId && sessionId === currentSessionId) {
            startNewSession();
          }
          break;
        }
        case "chat_session_updated": {
          const sessionId = String(data["session_id"] ?? "");
          if (currentSessionId && sessionId === currentSessionId) {
            const session = data["session"] as Record<string, unknown> | undefined;
            if (session) {
              hydrateAgentState(session as unknown as ChatSessionDetail);
            }
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("vllm:chat-event", handler as EventListener);
    return () => {
      window.removeEventListener("vllm:chat-event", handler as EventListener);
    };
  }, [
    currentSessionId,
    hydrateAgentState,
    mapStoredMessages,
    updateMessages,
    startNewSession,
  ]);
}

