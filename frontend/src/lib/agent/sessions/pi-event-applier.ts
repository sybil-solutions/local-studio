import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  asRecord,
  blocksFromMessageContent,
  blocksFromTurnSnapshots,
  finalizeRunningToolBlocks,
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
import { isAgentEndEvent } from "@/lib/agent/pi-events";
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

  if (isSuccessfulCompactionEvent(event)) {
    deps.updateSession(sessionId, (session) => ({
      ...session,
      contextUsage: null,
      tokenStats: undefined,
    }));
  }

  const usage = usageFromEvent(event);
  if (usage) {
    deps.updateSession(sessionId, (session) => ({ ...session, tokenStats: usage }));
  }

  // Assistant message lifecycle -> rebuild blocks from accumulated per-call
  // snapshots (NOT from token deltas). This owns message_start/update/end.
  if (applyAssistantSnapshotEvent(deps, sessionId, assistantId, event)) return;

  // Turn finished: settle any still-"running" tool badges and drop the
  // transient per-call snapshots.
  if (isAgentEndEvent(event)) {
    deps.patchAssistant(sessionId, currentAssistantId(deps, sessionId, assistantId), (msg) => ({
      ...msg,
      blocks: finalizeRunningToolBlocks(msg.blocks ?? []),
      streamCalls: undefined,
    }));
    return;
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

function isSuccessfulCompactionEvent(event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
  if (!type.includes("compact") && !type.includes("compaction")) return false;
  if (isFailedCompactionEvent(event)) return false;
  if (type.includes("start") || type.includes("begin")) return false;
  return true;
}

function isFailedCompactionEvent(event: Record<string, unknown>): boolean {
  if (
    event.error ||
    event.errorMessage ||
    event.aborted ||
    event.cancelled ||
    event.canceled ||
    event.failed
  ) {
    return true;
  }
  if (event.type === "compaction_end" && event.result == null) return true;
  const status =
    typeof event.status === "string"
      ? event.status
      : typeof (event.result as { status?: unknown } | undefined)?.status === "string"
        ? (event.result as { status: string }).status
        : "";
  return /abort|cancel|error|fail/.test(status.toLowerCase());
}

function currentAssistantId(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
): string {
  return deps.liveAssistantIdsRef.current.get(sessionId) ?? assistantId;
}

// Accumulate one content snapshot per LLM call and rebuild the bubble's blocks
// from all of them. `message_start` opens a new call slot; `message_update` /
// `message_end` replace the current slot with the call's full accumulated
// content. Tool results (from tool_execution_* events) are preserved across
// rebuilds via mergeExistingToolState.
function applyAssistantSnapshotEvent(
  deps: PiEventApplierDeps,
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
): boolean {
  const type = event.type;
  if (type !== "message_start" && type !== "message_update" && type !== "message_end") return false;
  const message = asRecord(event.message);
  if (message?.role !== "assistant") return false;
  const content = Array.isArray(message.content)
    ? (message.content as Array<Record<string, unknown>>)
    : [];

  const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
  const callFailed = type === "message_end" && (stopReason === "error" || stopReason === "aborted");

  deps.patchAssistant(sessionId, currentAssistantId(deps, sessionId, assistantId), (current) => {
    const streamCalls = nextStreamCalls(current.streamCalls, type, content);
    let blocks = mergeExistingToolState(current.blocks ?? [], blocksFromTurnSnapshots(streamCalls));
    // An LLM call that errored/aborted will never execute the tools it declared
    // — settle them now instead of leaving a perpetual "running" badge.
    if (callFailed) blocks = finalizeRunningToolBlocks(blocks, "error");
    return { ...current, streamCalls, blocks, text: messageTextFromBlocks(blocks) };
  });
  return true;
}

function nextStreamCalls(
  prev: Array<Array<Record<string, unknown>>> | undefined,
  type: string,
  content: Array<Record<string, unknown>>,
): Array<Array<Record<string, unknown>>> {
  const calls = prev ? prev.slice() : [];
  if (type === "message_start") {
    calls.push(content);
    return calls;
  }
  if (calls.length === 0) {
    calls.push(content);
  } else {
    calls[calls.length - 1] = content;
  }
  return calls;
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
  // `message_end` is owned by the snapshot path; this only handles the canonical
  // `message` event shape (replayed/settled messages).
  if (event.type !== "message") return false;
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
