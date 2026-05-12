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
import type { AssistantBlock, ChatMessage, TextBlock } from "./types";

function blocksFromMessageContent(content: string | Array<Record<string, unknown>> | undefined) {
  if (typeof content === "string") {
    return content ? [{ kind: "text" as const, id: newId("text"), text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: AssistantBlock[] = [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      blocks.push({ kind: "text", id: newId("text"), text: part.text });
    } else if (part?.type === "thinking" && typeof part.thinking === "string") {
      blocks.push({ kind: "thinking", id: newId("thinking"), text: part.thinking });
    } else if (part?.type === "toolCall") {
      const argsText = JSON.stringify(part.arguments ?? {}, null, 2);
      const args =
        part.arguments && typeof part.arguments === "object"
          ? (part.arguments as Record<string, unknown>)
          : undefined;
      blocks.push({
        kind: "tool",
        id: typeof part.id === "string" ? part.id : newId("tool"),
        name: typeof part.name === "string" ? part.name : "tool",
        status: "running",
        argsText,
        args,
        text: argsText,
      });
    }
  }
  return blocks;
}

// ----- full session replay -----

export function replaySessionEvents(events: Record<string, unknown>[]): {
  messages: ChatMessage[];
  title: string | null;
  startedAt: string | null;
} {
  const replayed: ChatMessage[] = [];
  let pendingAssistantId: string | null = null;
  let title: string | null = null;
  let startedAt: string | null = null;

  const ensureAssistant = () => {
    if (pendingAssistantId) return pendingAssistantId;
    const id = newId("assistant");
    replayed.push({ id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() });
    pendingAssistantId = id;
    return id;
  };
  const localPatch = (assistantId: string, patch: (msg: ChatMessage) => ChatMessage) => {
    const idx = replayed.findIndex((m) => m.id === assistantId);
    if (idx !== -1) replayed[idx] = patch(replayed[idx]);
  };
  const assistantWithTool = (toolCallId: string) => {
    for (let idx = replayed.length - 1; idx >= 0; idx -= 1) {
      const message = replayed[idx];
      if (
        message.role === "assistant" &&
        (message.blocks ?? []).some((block) => block.kind === "tool" && block.id === toolCallId)
      ) {
        return message.id;
      }
    }
    return null;
  };

  for (const event of events) {
    const type = event.type;
    if (type === "session" && !startedAt && typeof event.timestamp === "string") {
      startedAt = event.timestamp;
    }
    if (type === "message" || type === "message_end") {
      const msg = event.message as
        | {
            role?: string;
            content?: string | Array<Record<string, unknown>>;
            toolCallId?: string;
            toolName?: string;
            isError?: boolean;
          }
        | undefined;
      if (msg?.role === "user") {
        pendingAssistantId = null;
        const text = visibleUserTextFromPi(messageText(msg.content));
        if (text) {
          if (!title) title = sessionTitleFromPrompt(text);
          replayed.push({ id: newId("user"), role: "user", text, timestamp: nowLabel() });
        }
        continue;
      }
      if (msg?.role === "assistant") {
        const blocks = blocksFromMessageContent(msg.content);
        const text = blocks
          .filter((block): block is TextBlock => block.kind === "text")
          .map((block) => block.text)
          .join("\n");
        if (pendingAssistantId) {
          const pending = replayed.find((message) => message.id === pendingAssistantId);
          const pendingHasTools = (pending?.blocks ?? []).some((block) => block.kind === "tool");
          const incomingHasTools = blocks.some((block) => block.kind === "tool");
          if (type === "message_end" || (!pendingHasTools && !incomingHasTools)) {
            localPatch(pendingAssistantId, (message) => ({
              ...message,
              text,
              blocks,
            }));
            pendingAssistantId = null;
            continue;
          }
        }
        pendingAssistantId = null;
        replayed.push({
          id: newId("assistant"),
          role: "assistant",
          text,
          blocks,
          timestamp: nowLabel(),
        });
        continue;
      }
      if (msg?.role === "toolResult") {
        const id = msg.toolCallId || String(event.toolCallId || "");
        if (id) {
          const resultText = messageText(msg.content);
          const assistantId = assistantWithTool(id) ?? ensureAssistant();
          localPatch(assistantId, (message) => ({
            ...message,
            blocks: upsertTool(
              message.blocks ?? [],
              id,
              (existing) => ({
                ...existing,
                status: msg.isError ? "error" : "done",
                text: resultText || existing.text,
              }),
              () => ({
                kind: "tool",
                id,
                name: msg.toolName || "tool",
                status: msg.isError ? "error" : "done",
                text: resultText,
              }),
            ),
          }));
        }
        continue;
      }
    }

    if (!assistantPiEventAffectsBlocks(event)) continue;

    const assistantId = ensureAssistant();
    localPatch(assistantId, (msg) => {
      const blocks = applyAssistantPiEventToBlocks(msg.blocks ?? [], event);
      return blocks ? { ...msg, blocks } : msg;
    });
  }

  return { messages: replayed, title, startedAt };
}
