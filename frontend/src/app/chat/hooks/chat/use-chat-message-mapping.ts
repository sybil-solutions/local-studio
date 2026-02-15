// CRITICAL
"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  ChatMessage,
  ChatMessagePart,
  StoredMessage,
} from "@/lib/types";
import {
  isToolPart,
  isToolCallOnlyText,
  mapAgentMessageToChatMessageImpl,
  mapStoredMessagesImpl,
  mergeToolParts,
} from "./use-chat-message-mapping/helpers";

type UseChatMessageMappingArgs = {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

export function useChatMessageMapping({ setMessages }: UseChatMessageMappingArgs) {
  const mapStoredMessages = useCallback((storedMessages: StoredMessage[]) => {
    return mapStoredMessagesImpl(storedMessages);
  }, []);

  const mapAgentMessageToChatMessage = useCallback(
    (rawMessage: Record<string, unknown>, messageId?: string, runMeta?: { runId?: string; turnIndex?: number }) => {
      return mapAgentMessageToChatMessageImpl(rawMessage, messageId, runMeta);
    },
    [],
  );

  const upsertMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        const hasVisibleTextPart = (parts: ChatMessagePart[]) =>
          parts.some(
            (part) =>
              part.type === "text" &&
              typeof part.text === "string" &&
              part.text.trim() &&
              !isToolCallOnlyText(part.text)
          );
        const hasVisibleText = hasVisibleTextPart(message.parts);
        const hasToolParts = message.parts.some((part) => isToolPart(part));
        const toolOnly = message.role === "assistant" && hasToolParts && !hasVisibleText;

        if (toolOnly) {
          const runId = (message.metadata as { runId?: string } | undefined)?.runId;
          let targetIndex = -1;
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            const candidate = prev[i];
            if (candidate.role !== "assistant") continue;
            const candidateRunId = (candidate.metadata as { runId?: string } | undefined)?.runId;
            if (runId && candidateRunId && runId !== candidateRunId) continue;
            targetIndex = i;
            break;
          }

          if (targetIndex !== -1) {
            const target = prev[targetIndex];
            const mergedParts = mergeToolParts(target.parts, message.parts);
            const mergedMetadata = message.metadata
              ? { ...(target.metadata ?? {}), ...message.metadata }
              : target.metadata;
            const updated: ChatMessage = {
              ...target,
              parts: mergedParts,
              metadata: mergedMetadata,
              tool_calls: message.tool_calls ?? target.tool_calls,
            };
            return [...prev.slice(0, targetIndex), updated, ...prev.slice(targetIndex + 1)];
          }

          const internal = {
            ...message,
            metadata: { ...(message.metadata ?? {}), internal: true },
          };
          return [...prev, internal];
        }

        let nextMessage: ChatMessage = message;
        let nextPrev = prev;
        if (message.role === "assistant") {
          const runId = (message.metadata as { runId?: string } | undefined)?.runId;
          if (runId) {
            const toolOnlyMessages = prev.filter((entry) => {
              if (entry.role !== "assistant") return false;
              const entryRunId = (entry.metadata as { runId?: string } | undefined)?.runId;
              if (entryRunId !== runId) return false;
              const entryHasText = hasVisibleTextPart(entry.parts);
              const entryHasTool = entry.parts.some((part) => isToolPart(part));
              const isInternal = Boolean(
                (entry.metadata as { internal?: boolean } | undefined)?.internal,
              );
              return isInternal && entryHasTool && !entryHasText;
            });

            if (toolOnlyMessages.length > 0) {
              const mergedParts = toolOnlyMessages.reduce(
                (acc, entry) => mergeToolParts(acc, entry.parts),
                message.parts,
              );
              nextMessage = { ...message, parts: mergedParts };
              const toolOnlyIds = new Set(toolOnlyMessages.map((entry) => entry.id));
              nextPrev = prev.filter((entry) => !toolOnlyIds.has(entry.id));
            }
          }
        }

        const index = nextPrev.findIndex((entry) => entry.id === nextMessage.id);
        if (index === -1) {
          return [...nextPrev, nextMessage];
        }
        const existing = nextPrev[index];
        const mergedParts = mergeToolParts(existing.parts, nextMessage.parts);
        const mergedMetadata = nextMessage.metadata
          ? { ...(existing.metadata ?? {}), ...nextMessage.metadata }
          : existing.metadata;
        const updated: ChatMessage = {
          ...existing,
          ...nextMessage,
          parts: mergedParts,
          metadata: mergedMetadata,
          tool_calls: nextMessage.tool_calls ?? existing.tool_calls,
          content: nextMessage.content ?? existing.content,
        };
        return [...nextPrev.slice(0, index), updated, ...nextPrev.slice(index + 1)];
      });
    },
    [setMessages],
  );

  return { mapStoredMessages, mapAgentMessageToChatMessage, upsertMessage, isToolPart };
}
