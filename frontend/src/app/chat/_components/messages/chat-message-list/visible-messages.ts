// CRITICAL
"use client";

import type { Artifact, ChatMessage } from "@/lib/types";
import { isToolCallOnlyText } from "@/app/chat/hooks/chat/use-chat-message-mapping/helpers";

function isToolOnlyMessage(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;

  let hasToolParts = false;
  for (const part of message.parts) {
    if (part.type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        if (isToolCallOnlyText(text)) return false;
        if (text.trim().length > 0) return false;
      }
      continue;
    }
    if (part.type === "dynamic-tool") {
      hasToolParts = true;
      continue;
    }
    if (
      typeof part.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "tool-call")
    ) {
      hasToolParts = true;
    }
  }

  return hasToolParts;
}

function hasNonEmptyText(message: ChatMessage): boolean {
  for (const part of message.parts ?? []) {
    if (!part || typeof part !== "object") continue;
    const type = (part as { type?: unknown }).type;
    if (type !== "text") continue;
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string" && !isToolCallOnlyText(text) && text.trim().length > 0) return true;
  }
  return false;
}

export function filterVisibleMessages({
  messages,
  isLoading,
  lastRawMessageId,
  artifactsByMessage,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  lastRawMessageId: string | undefined;
  artifactsByMessage?: Map<string, Artifact[]>;
}) {
  return messages.filter((m) => {
    const metadata = m.metadata as { internal?: boolean } | undefined;
    if (metadata?.internal) return false;

    if (isLoading && m.role === "assistant" && m.id === lastRawMessageId) return true;

    if (isToolOnlyMessage(m)) return false;

    if (m.role === "assistant") {
      const hasArtifacts = Boolean(artifactsByMessage?.get(m.id)?.length);
      if (!hasArtifacts && !hasNonEmptyText(m)) return false;
    }
    return true;
  });
}
