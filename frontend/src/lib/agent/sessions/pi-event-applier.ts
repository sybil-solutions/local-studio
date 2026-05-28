import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  asRecord,
  blocksFromMessageContent,
  messageTextFromBlocks,
  type AssistantBlock,
  type ChatMessage,
  messageText,
  newId,
  nowLabel,
  reconcileQueueWithPiEvent,
  removeDeliveredQueuedMessage,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/lib/agent/session";
import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import type { Session, SessionId } from "./types";

type MutableRef<T> = { current: T };
type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;
type PatchAssistant = (
  sessionId: SessionId,
  assistantId: string,
  patch: (msg: ChatMessage) => ChatMessage,
) => void;

export type PiEventApplierDeps = {
  liveAssistantIdsRef: MutableRef<Map<SessionId, string>>;
  patchAssistant: PatchAssistant;
  tabsRef: MutableRef<Session[]>;
  updateSession: UpdateSession;
};

export function applyPiEventToSession(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
): void {
  if (event.type === "queue_update") {
    deps.updateSession(sessionId, (session) => ({
      ...session,
      queue: reconcileQueueWithPiEvent(session.queue ?? [], event),
    }));
    return;
  }

  if (appendUserMessageFromPiEvent(deps, sessionId, event)) return;

  const usage = usageFromEvent(event);
  if (usage) {
    deps.updateSession(sessionId, (session) => ({ ...session, tokenStats: usage }));
  }

  if (patchFinalAssistantMessageFromPiEvent(deps, sessionId, assistantId, event)) return;

  if (!assistantPiEventAffectsBlocks(event)) return;
  traceAgentReasoning("pi-event-applier.before", { sessionId, assistantId, event });
  deps.patchAssistant(sessionId, currentAssistantId(deps, sessionId, assistantId), (msg) => {
    const blocks = applyAssistantPiEventToBlocks(msg.blocks ?? [], event);
    traceAgentReasoning("pi-event-applier.after", {
      sessionId,
      assistantId,
      event,
      beforeBlocks: msg.blocks ?? [],
      afterBlocks: blocks,
    });
    return blocks ? { ...msg, blocks } : msg;
  });
}

function currentAssistantId(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
): string {
  return deps.liveAssistantIdsRef.current.get(sessionId) ?? assistantId;
}

function appendUserMessageFromPiEvent(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  event: Record<string, unknown>,
): boolean {
  if (event.type !== "message_start" && event.type !== "message_end") return false;
  const msg = event.message as { role?: string; content?: string | Record<string, unknown>[] };
  if (msg?.role !== "user") return false;
  const text = visibleUserTextFromPi(messageText(msg.content));
  if (!text) return true;
  let appended = false;
  deps.updateSession(sessionId, (session) => {
    const queue = removeDeliveredQueuedMessage(session.queue ?? [], text);
    if (hasMatchingLastUserMessage(session.messages, text)) {
      return { ...session, queue };
    }
    appended = true;
    return {
      ...session,
      queue,
      messages: [
        ...session.messages,
        { id: newId("user"), role: "user", text, timestamp: nowLabel() },
      ],
    };
  });
  if (appended) ensureNextAssistant(deps, sessionId);
  return true;
}

function patchFinalAssistantMessageFromPiEvent(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
): boolean {
  if (event.type !== "message" && event.type !== "message_end") return false;
  const msg = asRecord(event.message);
  if (msg?.role !== "assistant") return false;
  const content = finalMessageContent(msg.content);
  const stopReason = typeof msg.stopReason === "string" ? msg.stopReason : undefined;
  const blocks = blocksFromMessageContent(content, { stopReason });
  const text = messageTextFromBlocks(blocks);
  deps.patchAssistant(sessionId, currentAssistantId(deps, sessionId, assistantId), (current) => {
    return reconcileFinalAssistantMessage(current, text, blocks);
  });
  return true;
}

function finalMessageContent(value: unknown): string | Array<Record<string, unknown>> | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((part) => {
    const record = asRecord(part);
    return record ? [record] : [];
  });
}

function assistantHasGeneratedBlocks(blocks: AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "event") return false;
    if (block.kind === "tool") {
      return Boolean(block.text || block.argsText || block.resultText || block.name);
    }
    return isMeaningfulAssistantText(block.text);
  });
}

function reconcileFinalAssistantMessage(
  current: ChatMessage,
  text: string,
  incomingBlocks: AssistantBlock[],
): ChatMessage {
  const existingBlocks = current.blocks ?? [];
  if (!assistantHasGeneratedBlocks(existingBlocks)) {
    return { ...current, text, blocks: incomingBlocks };
  }
  if (!finalMessageCoversExistingBlocks(existingBlocks, incomingBlocks)) return current;
  return { ...current, text, blocks: mergeExistingToolState(existingBlocks, incomingBlocks) };
}

function finalMessageCoversExistingBlocks(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): boolean {
  if (incomingBlocks.length === 0) return false;
  const existingHasTool = existingBlocks.some((block) => block.kind === "tool");
  const incomingHasTool = incomingBlocks.some((block) => block.kind === "tool");
  if (existingHasTool && !incomingHasTool) return false;

  return (
    blockTextCoversExisting(existingBlocks, incomingBlocks, "text") ||
    blockTextCoversExisting(existingBlocks, incomingBlocks, "thinking")
  );
}

function blockTextCoversExisting(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
  kind: "text" | "thinking",
): boolean {
  const existing = joinedBlockText(existingBlocks, kind);
  const incoming = joinedBlockText(incomingBlocks, kind);
  return Boolean(existing && incoming && (incoming === existing || incoming.startsWith(existing)));
}

function joinedBlockText(blocks: AssistantBlock[], kind: "text" | "thinking"): string {
  return blocks
    .filter((block) => block.kind === kind)
    .map((block) => block.text)
    .filter(isMeaningfulAssistantText)
    .join("");
}

function isMeaningfulAssistantText(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed && !/^(?:\.{3}|…)+$/.test(trimmed));
}

function mergeExistingToolState(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const existingTools = new Map(
    existingBlocks
      .filter((block) => block.kind === "tool")
      .map((block) => [block.id, block] as const),
  );
  return incomingBlocks.map((block) => {
    if (block.kind !== "tool") return block;
    const existing = existingTools.get(block.id);
    if (!existing) return block;
    return {
      ...block,
      args: block.args ?? existing.args,
      argsText: block.argsText ?? existing.argsText,
      resultText: existing.resultText ?? block.resultText,
      status: existing.status,
      text: block.text || existing.text,
    };
  });
}

function hasMatchingLastUserMessage(messages: ChatMessage[], text: string): boolean {
  const lastUser = [...messages].reverse().find((entry) => entry.role === "user");
  return Boolean(
    lastUser &&
    (lastUser.text === text ||
      text.includes(lastUser.text) ||
      Boolean(text && lastUser.text.includes(text)) ||
      Boolean(!text && lastUser.attachments?.length)),
  );
}

function ensureNextAssistant(deps: PiEventApplierDeps, sessionId: SessionId): string {
  const id = newId("assistant");
  deps.liveAssistantIdsRef.current.set(sessionId, id);
  deps.updateSession(sessionId, (session) => ({
    ...session,
    activeAssistantId: id,
    messages: [
      ...session.messages,
      { id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  }));
  return id;
}
