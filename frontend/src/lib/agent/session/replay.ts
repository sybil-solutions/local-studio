import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  upsertTool,
} from "./block-event";
import {
  messageText,
  newId,
  nowLabel,
  sessionTitleFromPrompt,
  visibleUserTextFromPi,
} from "./helpers";
import { blocksFromMessageContent, messageTextFromBlocks } from "./message-content";
import type { AssistantBlock, ChatMessage } from "./types";

type ReplayPiMessage = {
  role?: string;
  content?: string | Array<Record<string, unknown>>;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
};

type ReplayState = {
  messages: ChatMessage[];
  pendingAssistantId: string | null;
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
};

const replayMessageFromEvent = (event: Record<string, unknown>): ReplayPiMessage | null => {
  if (event.type !== "message" && event.type !== "message_end") return null;
  const message = event.message;
  return message && typeof message === "object" && !Array.isArray(message)
    ? (message as ReplayPiMessage)
    : null;
};

const eventToolCallId = (event: Record<string, unknown>, message: ReplayPiMessage): string =>
  message.toolCallId || String(event.toolCallId || "");

const patchMessage = (
  state: ReplayState,
  messageId: string,
  patch: (message: ChatMessage) => ChatMessage,
): void => {
  const index = state.messages.findIndex((message) => message.id === messageId);
  if (index !== -1) state.messages[index] = patch(state.messages[index]);
};

const ensureAssistantMessage = (state: ReplayState): string => {
  if (state.pendingAssistantId) return state.pendingAssistantId;
  const id = newId("assistant");
  state.messages.push({ id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() });
  state.pendingAssistantId = id;
  return id;
};

const assistantWithTool = (state: ReplayState, toolCallId: string): string | null => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    const hasTool = (message.blocks ?? []).some(
      (block) => block.kind === "tool" && block.id === toolCallId,
    );
    if (message.role === "assistant" && hasTool) return message.id;
  }
  return null;
};

const pendingAssistantCanReceive = (
  state: ReplayState,
  eventType: unknown,
  incomingBlocks: AssistantBlock[],
): boolean => {
  if (!state.pendingAssistantId) return false;
  const pending = state.messages.find((message) => message.id === state.pendingAssistantId);
  const pendingHasTools = (pending?.blocks ?? []).some((block) => block.kind === "tool");
  const incomingHasTools = incomingBlocks.some((block) => block.kind === "tool");
  return (
    eventType === "message_end" ||
    eventType === "message" ||
    (!pendingHasTools && !incomingHasTools)
  );
};

const appendUserMessage = (state: ReplayState, message: ReplayPiMessage): boolean => {
  if (message.role !== "user") return false;

  state.pendingAssistantId = null;
  const text = visibleUserTextFromPi(messageText(message.content));
  if (!text) return true;
  state.title ??= sessionTitleFromPrompt(text);
  state.messages.push({ id: newId("user"), role: "user", text, timestamp: nowLabel() });
  return true;
};

const appendAssistantMessage = (
  state: ReplayState,
  eventType: unknown,
  message: ReplayPiMessage,
): boolean => {
  if (message.role !== "assistant") return false;

  const blocks = blocksFromMessageContent(message.content, { stopReason: message.stopReason });
  const text = messageTextFromBlocks(blocks);
  if (pendingAssistantCanReceive(state, eventType, blocks) && state.pendingAssistantId) {
    patchMessage(state, state.pendingAssistantId, (current) => ({ ...current, text, blocks }));
    state.pendingAssistantId = null;
    return true;
  }

  state.pendingAssistantId = null;
  state.messages.push({
    id: newId("assistant"),
    role: "assistant",
    text,
    blocks,
    timestamp: nowLabel(),
  });
  return true;
};

const appendToolResult = (
  state: ReplayState,
  event: Record<string, unknown>,
  message: ReplayPiMessage,
): boolean => {
  if (message.role !== "toolResult") return false;

  const id = eventToolCallId(event, message);
  if (!id) return true;
  const resultText = messageText(message.content);
  const assistantId = assistantWithTool(state, id) ?? ensureAssistantMessage(state);
  patchMessage(state, assistantId, (current) => ({
    ...current,
    blocks: upsertTool(
      current.blocks ?? [],
      id,
      (existing) => ({
        ...existing,
        status: message.isError ? "error" : "done",
        text: resultText || existing.text,
      }),
      () => ({
        kind: "tool",
        id,
        name: message.toolName || "tool",
        status: message.isError ? "error" : "done",
        text: resultText,
      }),
    ),
  }));
  return true;
};

const applyReplayMessage = (state: ReplayState, event: Record<string, unknown>): boolean => {
  const message = replayMessageFromEvent(event);
  if (!message) return false;
  return (
    appendUserMessage(state, message) ||
    appendAssistantMessage(state, event.type, message) ||
    appendToolResult(state, event, message)
  );
};

const applyAssistantPiEvent = (state: ReplayState, event: Record<string, unknown>): void => {
  if (!assistantPiEventAffectsBlocks(event)) return;
  const assistantId = ensureAssistantMessage(state);
  patchMessage(state, assistantId, (message) => {
    const blocks = applyAssistantPiEventToBlocks(message.blocks ?? [], event);
    return blocks ? { ...message, blocks } : message;
  });
};

const applySessionStart = (state: ReplayState, event: Record<string, unknown>): void => {
  if (event.type === "session") {
    if (!state.startedAt && typeof event.timestamp === "string") state.startedAt = event.timestamp;
    if (!state.modelId && typeof event.modelId === "string") state.modelId = event.modelId;
    if (!state.modelId && typeof event.model === "string") state.modelId = event.model;
    if (!state.modelId && typeof event.model_id === "string") state.modelId = event.model_id;
    return;
  }

  if (event.type === "model_change") {
    if (typeof event.modelId === "string") state.modelId = event.modelId;
    if (typeof event.model === "string") state.modelId = event.model;
  }
};

// ----- full session replay -----

export function replaySessionEvents(events: Record<string, unknown>[]): {
  messages: ChatMessage[];
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
} {
  const state: ReplayState = {
    messages: [],
    pendingAssistantId: null,
    title: null,
    startedAt: null,
    modelId: null,
  };

  for (const event of events) {
    applySessionStart(state, event);
    if (applyReplayMessage(state, event)) continue;
    applyAssistantPiEvent(state, event);
  }

  return {
    messages: state.messages,
    title: state.title,
    startedAt: state.startedAt,
    modelId: state.modelId,
  };
}
