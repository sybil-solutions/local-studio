// CRITICAL
export interface Attachment {
  id: string;
  type: "file" | "image" | "audio";
  name: string;
  size: number;
  url?: string;
  file?: File;
  base64?: string;
}

export interface ModelOption {
  id: string;
  provider: string;
  name?: string;
  maxModelLen?: number;
  active?: boolean;
}

export interface ParsedChatModel {
  id: string;
  provider: string;
}

export const DEFAULT_CHAT_PROVIDER = "openai";

export function parseChatModelId(rawModelId: string): ParsedChatModel {
  const trimmed = rawModelId.trim();
  const delimiterIndex = trimmed.indexOf("/");
  if (delimiterIndex <= 0 || delimiterIndex === trimmed.length - 1) {
    return { id: trimmed, provider: DEFAULT_CHAT_PROVIDER };
  }

  const provider = trimmed.slice(0, delimiterIndex).trim();
  const model = trimmed.slice(delimiterIndex + 1).trim();
  return {
    id: model.length > 0 ? model : trimmed,
    provider: provider || DEFAULT_CHAT_PROVIDER,
  };
}

export function buildDisplayModelLabel(modelId: string, provider: string): string {
  if (!provider || provider === DEFAULT_CHAT_PROVIDER) return modelId;
  if (modelId.startsWith(`${provider}/`)) return modelId;
  return `${provider}/${modelId}`;
}

export interface ActivityItem {
  id: string;
  type: "tool-call" | "thinking" | "research";
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  state?: "pending" | "running" | "complete" | "error";
  input?: unknown;
  output?: unknown;
  content?: string;
  isActive?: boolean;
}

export interface ActivityGroup {
  id: string;
  messageId: string;
  title: string;
  isLatest: boolean;
  turnNumber: number;
  items: ActivityItem[];
}

export interface ThinkingState {
  content: string;
  isComplete: boolean;
}
