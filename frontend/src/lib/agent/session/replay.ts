import {
  asRecord,
  compactionTextFromEvent,
  extractToolText,
  messageText,
  newId,
  nowLabel,
  sessionTitleFromPrompt,
  visibleUserTextFromPi,
} from "./helpers";
import type { AssistantBlock, ChatMessage, TextBlock, ToolBlock } from "./types";

// ----- block mutation primitives -----

export function appendDelta(
  blocks: AssistantBlock[],
  kind: "text" | "thinking",
  delta: string,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    if (last.text.startsWith(delta)) return blocks;
    const append = delta.startsWith(last.text) ? delta.slice(last.text.length) : delta;
    if (!append) return blocks;
    return [...blocks.slice(0, -1), { ...last, text: last.text + append }];
  }
  return [...blocks, { kind, id: newId(kind), text: delta }];
}

export function upsertTool(
  blocks: AssistantBlock[],
  toolCallId: string,
  patch: (tool: ToolBlock) => ToolBlock,
  fallback: () => ToolBlock,
): AssistantBlock[] {
  const idx = blocks.findIndex((b) => b.kind === "tool" && b.id === toolCallId);
  if (idx === -1) return [...blocks, fallback()];
  const next = blocks.slice();
  next[idx] = patch(next[idx] as ToolBlock);
  return next;
}

export function appendEventBlock(blocks: AssistantBlock[], text: string): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === "event" && last.text === text) return blocks;
  return [...blocks, { kind: "event", id: newId("event"), text }];
}

// ----- streaming tool-call extraction helpers -----

export type StreamingToolCallSnapshot = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
};

function contentPartAt(
  messageLike: unknown,
  contentIndex: unknown,
): Record<string, unknown> | null {
  const message = asRecord(messageLike);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;
  if (typeof contentIndex === "number") return asRecord(content[contentIndex]);
  for (let idx = content.length - 1; idx >= 0; idx -= 1) {
    const part = asRecord(content[idx]);
    if (part?.type === "toolCall") return part;
  }
  return null;
}

export function toolCallSnapshotFromUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
  message?: unknown,
): StreamingToolCallSnapshot | null {
  if (!assistantMessageEvent) return null;
  const explicit = asRecord(assistantMessageEvent.toolCall);
  const part =
    explicit ??
    contentPartAt(assistantMessageEvent.partial, assistantMessageEvent.contentIndex) ??
    contentPartAt(message, assistantMessageEvent.contentIndex);
  const idValue = part?.id ?? assistantMessageEvent.toolCallId;
  const id = typeof idValue === "string" && idValue.trim() ? idValue.trim() : "";
  if (!id) return null;
  const nameValue = part?.name ?? assistantMessageEvent.toolName;
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : "tool";
  const args = asRecord(part?.arguments) ?? undefined;
  return { id, name, args };
}

export function toolCallDeltaFromUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
): string {
  const value = assistantMessageEvent?.delta ?? assistantMessageEvent?.argumentsDelta;
  return typeof value === "string" ? value : "";
}

export function stringifyToolArgs(args: Record<string, unknown> | undefined): string | undefined {
  return args && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;
}

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
    const compactionText = compactionTextFromEvent(event);
    if (compactionText) {
      const assistantId = ensureAssistant();
      localPatch(assistantId, (message) => ({
        ...message,
        blocks: appendEventBlock(message.blocks ?? [], compactionText),
      }));
      continue;
    }

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

    const eventType = event.type;
    if (
      eventType !== "message_update" &&
      eventType !== "tool_execution_start" &&
      eventType !== "tool_execution_update" &&
      eventType !== "tool_execution_end"
    ) {
      continue;
    }

    const assistantId = ensureAssistant();
    if (eventType === "message_update") {
      const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
      const updateType = ame?.type;
      if (updateType === "text_delta" && typeof ame?.delta === "string") {
        const delta = ame.delta;
        localPatch(assistantId, (msg) => ({
          ...msg,
          blocks: appendDelta(msg.blocks ?? [], "text", delta),
        }));
      } else if (updateType === "thinking_delta" && typeof ame?.delta === "string") {
        const delta = ame.delta;
        localPatch(assistantId, (msg) => ({
          ...msg,
          blocks: appendDelta(msg.blocks ?? [], "thinking", delta),
        }));
      } else if (updateType === "toolcall_start") {
        const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
        if (!snapshot) continue;
        localPatch(assistantId, (msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            snapshot.id,
            (existing) => ({
              ...existing,
              name: snapshot.name,
              args: snapshot.args ?? existing.args,
            }),
            () => ({
              kind: "tool",
              id: snapshot.id,
              name: snapshot.name,
              status: "running",
              text: "",
              argsText: stringifyToolArgs(snapshot.args) ?? "",
              args: snapshot.args,
            }),
          ),
        }));
      } else if (updateType === "toolcall_delta") {
        const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
        const delta = toolCallDeltaFromUpdate(ame);
        if (!snapshot || (!delta && !snapshot.args)) continue;
        localPatch(assistantId, (msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            snapshot.id,
            (existing) => ({
              ...existing,
              name: snapshot.name || existing.name,
              args: snapshot.args ?? existing.args,
              argsText: delta
                ? (existing.argsText ?? "") + delta
                : existing.argsText || stringifyToolArgs(snapshot.args),
            }),
            () => ({
              kind: "tool",
              id: snapshot.id,
              name: snapshot.name,
              status: "running",
              text: "",
              argsText: delta || stringifyToolArgs(snapshot.args) || "",
              args: snapshot.args,
            }),
          ),
        }));
      } else if (updateType === "toolcall_end") {
        const toolCall = ame?.toolCall as
          | { id?: string; name?: string; arguments?: unknown }
          | undefined;
        if (toolCall) {
          const id = toolCall.id || newId("tool");
          const name = toolCall.name || "tool";
          const argsText = JSON.stringify(toolCall.arguments ?? {}, null, 2);
          const argsObj =
            toolCall.arguments && typeof toolCall.arguments === "object"
              ? (toolCall.arguments as Record<string, unknown>)
              : undefined;
          localPatch(assistantId, (msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              id,
              (existing) => ({
                ...existing,
                name,
                argsText,
                args: argsObj ?? existing.args,
                text: existing.text || argsText,
              }),
              () => ({
                kind: "tool",
                id,
                name,
                status: "running",
                argsText,
                args: argsObj,
                text: argsText,
              }),
            ),
          }));
        }
      }
    } else if (eventType === "tool_execution_start") {
      const id = String(event.toolCallId || newId("tool"));
      const name = String(event.toolName || "tool");
      localPatch(assistantId, (msg) => ({
        ...msg,
        blocks: upsertTool(
          msg.blocks ?? [],
          id,
          (existing) => existing,
          () => ({ kind: "tool", id, name, status: "running", text: "" }),
        ),
      }));
    } else if (eventType === "tool_execution_update" || eventType === "tool_execution_end") {
      const id = String(event.toolCallId || "");
      if (id) {
        const resultText = extractToolText(event.partialResult || event.result);
        localPatch(assistantId, (msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            id,
            (existing) => ({
              ...existing,
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : existing.status,
              resultText: resultText || existing.resultText,
              text: existing.argsText || existing.text || resultText,
            }),
            () => ({
              kind: "tool",
              id,
              name: "tool",
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : "running",
              resultText,
              text: resultText,
            }),
          ),
        }));
      }
    }
  }

  return { messages: replayed, title, startedAt };
}
