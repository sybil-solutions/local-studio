import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";

const EMPTY_BLOCKS: AssistantBlock[] = [];

export function assistantBlocksForMessage(message: ChatMessage): AssistantBlock[] {
  if (message.blocks?.length) return message.blocks;
  if (!message.text.trim()) return EMPTY_BLOCKS;
  return [{ kind: "text", id: `${message.id}:fallback-text`, text: message.text }];
}

export function messageRenders(message: ChatMessage): boolean {
  if (message.role === "system") return false;
  if (message.role === "user") {
    return message.text.trim().length > 0 || Boolean(message.attachments?.length);
  }
  return assistantBlocksForMessage(message).some((block) =>
    block.kind === "text" ? block.text.trim() !== "" : true,
  );
}

export function mergeConsecutiveAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (message.role !== "assistant" || previous?.role !== "assistant") {
      merged.push(message);
      continue;
    }
    merged[merged.length - 1] = {
      ...previous,
      id: previous.id,
      text: [previous.text, message.text].filter(Boolean).join("\n"),
      blocks: [...assistantBlocksForMessage(previous), ...assistantBlocksForMessage(message)],
      streamCalls: [...(previous.streamCalls ?? []), ...(message.streamCalls ?? [])],
      timestamp: message.timestamp ?? previous.timestamp,
    };
  }
  return merged;
}
