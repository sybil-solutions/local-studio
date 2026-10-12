import type { ChatMessage } from "@/features/agent/messages";

const COMPOSER_HISTORY_LIMIT = 5;

export type ComposerHistoryCursor = {
  index: number;
  draft: string;
};

export type ComposerHistoryStep = {
  cursor: ComposerHistoryCursor;
  value: string;
};

export function recentComposerHistory(messages: ChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user" && message.text.trim())
    .slice(-COMPOSER_HISTORY_LIMIT)
    .reverse()
    .map((message) => message.text.trim());
}

export function stepComposerHistory(
  messages: ChatMessage[],
  cursor: ComposerHistoryCursor,
  direction: "older" | "newer",
): ComposerHistoryStep | null {
  const history = recentComposerHistory(messages);
  if (direction === "older") {
    if (history.length === 0) return null;
    const index = Math.min(cursor.index + 1, history.length - 1);
    return { cursor: { ...cursor, index }, value: history[index] ?? cursor.draft };
  }
  if (cursor.index < 0) return null;
  const index = cursor.index - 1;
  return {
    cursor: { ...cursor, index },
    value: index < 0 ? cursor.draft : (history[index] ?? cursor.draft),
  };
}
