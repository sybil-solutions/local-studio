import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  asRecord,
  blocksFromMessageContent,
  blocksFromTurnSnapshots,
  finalizeRunningToolBlocks,
  mergeExistingToolState,
  messageTextFromBlocks,
  piSessionIdFromEvent,
  toolCallSnapshotFromUpdate,
  upsertTool,
  usefulToolArgsText,
  type AssistantBlock,
  type ChatMessage,
  messageText,
  newId,
  nowLabel,
  reconcileQueueWithPiEvent,
  removeDeliveredQueuedMessage,
  sessionTitleFromPrompt,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/features/agent/messages";
import { isAgentEndEvent, piEventIsSuccessfulCompaction } from "@shared/agent/pi-events";
import { traceAgentReasoning } from "@/features/agent/trace-reasoning";
import type { Session, SessionId } from "@/features/agent/runtime/types";

export type SessionStreamContext = {
  // Sync channel for the live assistant id. React state commits lag the event
  // stream within a tick, so when a mid-stream user message opens the next
  // assistant bubble, later events in the same tick must find that id here
  // rather than on the (possibly stale) session snapshot.
  liveAssistantIds: Map<SessionId, string>;
  // Canonical-replay mode (foldSessionEvents). Replay renders one bubble per
  // settled assistant `message` — matching the on-disk log — and never adopts
  // a previous turn's bubble, while the live stream accumulates a whole turn
  // into one bubble. This grouping divergence is deliberate; the flag only
  // switches assistant-bubble targeting and the settled-`message` apply, every
  // other branch is shared.
  replay?: boolean;
};

/**
 * Pure event reducer: fold one pi event — live runtime or canonical log — into
 * a session. The only side channel is `ctx.liveAssistantIds` (see above).
 * Callers dispatch the returned session in a single state commit.
 */
export function reduceSessionEvent(
  session: Session,
  ctx: SessionStreamContext,
  event: Record<string, unknown>,
): Session {
  if (event.type === "queue_update") {
    return { ...session, queue: reconcileQueueWithPiEvent(session.queue ?? [], event) };
  }

  const afterHeader = reduceSessionHeaderEvent(session, event);
  if (afterHeader) return afterHeader;

  const afterUserMessage = reduceUserMessageEvent(session, ctx, event);
  if (afterUserMessage) return afterUserMessage;

  let next = session;
  if (piEventIsSuccessfulCompaction(event)) {
    next = { ...next, contextUsage: null, tokenStats: undefined };
  }

  const usage = usageFromEvent(event);
  if (usage) next = { ...next, tokenStats: usage };

  const afterToolResult = reduceToolResultMessageEvent(next, ctx, event);
  if (afterToolResult) return afterToolResult;

  // Assistant message lifecycle -> rebuild blocks from accumulated per-call
  // snapshots (NOT from token deltas). This owns message_start/update/end.
  const afterSnapshot = reduceAssistantSnapshotEvent(next, ctx, event);
  if (afterSnapshot) return afterSnapshot;

  // Turn finished: settle any still-"running" tool badges and drop the
  // transient per-call snapshots. Also un-dim any steer bubble still marked
  // pending — once the turn is over there is no further echo coming, so a
  // delivered-or-not steer must read as normal rather than stuck dimmed.
  if (isAgentEndEvent(event)) {
    // Canonical replay ignores turn boundaries: the settled log already
    // carries final tool statuses (toolResult messages), so finalizing here
    // would invent state the log doesn't have — and must not open a bubble.
    if (ctx.replay) return next;
    const target = resolveAssistantTarget(next, ctx);
    const settled = patchAssistantMessage(target.session, target.targetId, (msg) => ({
      ...msg,
      blocks: finalizeRunningToolBlocks(msg.blocks ?? []),
      streamCalls: undefined,
    }));
    return clearPendingUserMessages(settled);
  }

  const afterFinalMessage = reduceFinalAssistantMessageEvent(next, ctx, event);
  if (afterFinalMessage) return afterFinalMessage;

  if (!assistantPiEventAffectsBlocks(event)) return next;
  const target = resolveAssistantTarget(next, ctx);
  traceAgentReasoning("pi-event-applier.before", {
    sessionId: session.id,
    assistantId: target.targetId,
    event,
  });
  return patchAssistantMessage(target.session, target.targetId, (msg) => {
    const blocks = applyAssistantPiEventToBlocks(msg.blocks ?? [], event);
    traceAgentReasoning("pi-event-applier.after", {
      sessionId: session.id,
      assistantId: target.targetId,
      event,
      beforeBlocks: msg.blocks ?? [],
      afterBlocks: blocks,
    });
    return blocks ? { ...msg, blocks } : msg;
  });
}

/**
 * Canonical replay is a fold over the live reducer: reduce every logged event
 * into an empty session skeleton and project out the transcript fields.
 * `tokenStats` falls out of the reducer's usage/compaction branches (last
 * usage after the latest successful compaction boundary).
 */
export function foldSessionEvents(events: Record<string, unknown>[]): {
  messages: ChatMessage[];
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
  tokenStats: Session["tokenStats"];
} {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map(), replay: true };
  let session: Session = {
    id: "replay",
    piSessionId: null,
    title: "",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
  for (const event of events) session = reduceSessionEvent(session, ctx, event);
  return {
    messages: session.messages,
    title: session.title || null,
    startedAt: session.startedAt ?? null,
    modelId: session.modelId ?? null,
    tokenStats: session.tokenStats,
  };
}

// Resolve (or create) the assistant bubble an event should land on — the
// controller's former external `ensureAssistantId`, expressed as part of the
// fold. The liveAssistantIds pin wins (React-commit lag bridge), then a
// still-valid activeAssistantId, then — live only — the transcript's last
// assistant bubble (reload-mid-turn reattach); otherwise a new bubble opens
// and becomes the active target. Canonical replay never adopts the last
// bubble: a settled log renders one bubble per settled message.
function resolveAssistantTarget(
  session: Session,
  ctx: SessionStreamContext,
): { session: Session; targetId: string } {
  const pinned = ctx.liveAssistantIds.get(session.id);
  // The active bubble is almost always the LAST message (bubbles append at the
  // end), so validate it by scanning backward — folding a long replayed log
  // must not rescan the whole transcript from the front for every event.
  const active =
    session.activeAssistantId && messageIndexById(session.messages, session.activeAssistantId) >= 0
      ? session.activeAssistantId
      : undefined;
  const existing = pinned ?? active ?? (ctx.replay ? undefined : lastAssistantId(session.messages));
  if (existing) {
    return {
      targetId: existing,
      session:
        session.activeAssistantId === existing
          ? session
          : { ...session, activeAssistantId: existing },
    };
  }
  const targetId = newId("assistant");
  return {
    targetId,
    session: {
      ...session,
      activeAssistantId: targetId,
      messages: [
        ...session.messages,
        { id: targetId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
      ],
    },
  };
}

// Canonical `session` header and `model_change` entries carry session
// metadata, not transcript content.
function reduceSessionHeaderEvent(
  session: Session,
  event: Record<string, unknown>,
): Session | null {
  if (event.type === "session") {
    let next = session;
    if (!next.startedAt && typeof event.timestamp === "string") {
      next = { ...next, startedAt: event.timestamp };
    }
    const modelId = [event.modelId, event.model, event.model_id].find(
      (value): value is string => typeof value === "string",
    );
    if (!next.modelId && modelId) next = { ...next, modelId };
    const piSessionId = piSessionIdFromEvent(event);
    if (!next.piSessionId && piSessionId) next = { ...next, piSessionId };
    return next;
  }
  if (event.type === "model_change") {
    const modelId =
      typeof event.model === "string"
        ? event.model
        : typeof event.modelId === "string"
          ? event.modelId
          : null;
    if (!modelId || session.modelId === modelId) return session;
    return { ...session, modelId };
  }
  return null;
}

// Canonical settled tool result: attach it to the bubble that owns the tool
// call (scan back through the transcript), falling back to the current target
// bubble. Live tool results arrive as tool_execution_* events, so this fires
// on replayed/hydrated logs.
function reduceToolResultMessageEvent(
  session: Session,
  ctx: SessionStreamContext,
  event: Record<string, unknown>,
): Session | null {
  if (event.type !== "message" && event.type !== "message_end") return null;
  const msg = asRecord(event.message);
  if (msg?.role !== "toolResult") return null;
  const toolCallId =
    (typeof msg.toolCallId === "string" && msg.toolCallId) || String(event.toolCallId || "");
  if (!toolCallId) return session;
  const owner = assistantWithTool(session.messages, toolCallId);
  const target = owner ? { session, targetId: owner } : resolveAssistantTarget(session, ctx);
  const resultText = messageText(msg.content as string | Record<string, unknown>[] | undefined);
  const isError = Boolean(msg.isError);
  return patchAssistantMessage(target.session, target.targetId, (current) => ({
    ...current,
    blocks: upsertTool(
      current.blocks ?? [],
      toolCallId,
      (existing) => ({
        ...existing,
        status: isError ? "error" : "done",
        text: resultText || existing.text,
      }),
      () => ({
        kind: "tool",
        id: toolCallId,
        name: (typeof msg.toolName === "string" && msg.toolName) || "tool",
        status: isError ? "error" : "done",
        text: resultText,
      }),
    ),
  }));
}

function assistantWithTool(messages: ChatMessage[], toolCallId: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const hasTool = (message.blocks ?? []).some(
      (block) => block.kind === "tool" && block.id === toolCallId,
    );
    if (message.role === "assistant" && hasTool) return message.id;
  }
  return null;
}

// Backward id lookup: patch/target lookups land on (or near) the last message,
// so scanning from the end is O(1) in practice instead of O(N) per event.
function messageIndexById(messages: ChatMessage[], id: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].id === id) return index;
  }
  return -1;
}

function lastAssistantId(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index].id;
  }
  return undefined;
}

function patchAssistantMessage(
  session: Session,
  assistantId: string,
  patch: (msg: ChatMessage) => ChatMessage,
): Session {
  const index = messageIndexById(session.messages, assistantId);
  if (index < 0) return session;
  const current = session.messages[index];
  const next = patch(current);
  if (next === current) return session;
  const messages = session.messages.slice();
  messages[index] = next;
  return { ...session, messages };
}

// Accumulate one content snapshot per LLM call and rebuild the bubble's blocks
// from all of them. `message_start` opens a new call slot; `message_update` /
// `message_end` replace the current slot with the call's full accumulated
// content. Tool results (from tool_execution_* events) are preserved across
// rebuilds via mergeExistingToolState.
function reduceAssistantSnapshotEvent(
  session: Session,
  ctx: SessionStreamContext,
  event: Record<string, unknown>,
): Session | null {
  const type = event.type;
  if (type !== "message_start" && type !== "message_update" && type !== "message_end") return null;
  // On canonical replay a `message_end` is a settled message, not a streaming
  // frame: it closes the target bubble like `message` does (the settled branch
  // below), so the next settled message opens a fresh bubble.
  if (ctx.replay && type === "message_end") return null;
  const message = asRecord(event.message);
  if (message?.role !== "assistant") return null;
  const target = resolveAssistantTarget(session, ctx);
  session = target.session;
  const targetId = target.targetId;
  const content = assistantSnapshotContent(event, message);

  const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
  // An aborted turn is a deliberate stop (user pressed Stop, navigated away) —
  // NOT an error. It must settle cleanly: keep whatever streamed, settle tool
  // badges, and never surface an error block or session error. Only a genuine
  // "error" stopReason is a failure.
  const callErrored = type === "message_end" && stopReason === "error";
  const callAborted = type === "message_end" && stopReason === "aborted";
  const failureText = callErrored ? assistantFailureText(message, stopReason) : "";

  let next = patchAssistantMessage(session, targetId, (current) => {
    const streamCalls = nextStreamCalls(current.streamCalls, type, content);
    const existingBlocks = current.blocks ?? [];
    let blocks = mergeExistingToolState(existingBlocks, blocksFromTurnSnapshots(streamCalls));
    blocks = applyLegacyToolCallDeltaIfSnapshotMissedIt(blocks, existingBlocks, event, content);
    // Carry over any tool block created from tool_execution_*/toolcall_* events
    // that the latest content snapshot doesn't list — for EVERY update, not just
    // toolcall_* ones. Without this, the model's closing text-only summary after
    // a tool-heavy turn rebuilds blocks from a tool-free snapshot and
    // mergeExistingToolState silently drops the completed tools (they vanish from
    // the bubble).
    blocks = preserveMissingToolBlocks(blocks, existingBlocks);
    // A call that ended (errored or aborted) won't execute its declared tools —
    // settle them so they don't show a perpetual "running" badge. An error marks
    // them errored; an abort just settles them done.
    if (callErrored) blocks = finalizeRunningToolBlocks(blocks, "error");
    else if (callAborted) blocks = finalizeRunningToolBlocks(blocks, "done");
    if (failureText) blocks = appendFailureBlock(blocks, failureText);
    return { ...current, streamCalls, blocks, text: messageTextFromBlocks(blocks) };
  });
  if (failureText) next = { ...next, error: failureText };
  return next;
}

function assistantSnapshotContent(
  event: Record<string, unknown>,
  message: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const messageContent = recordArray(message.content);
  if (event.type !== "message_update") return messageContent;

  const partial = asRecord(asRecord(event.assistantMessageEvent)?.partial);
  const partialContent = partial?.role === "assistant" ? recordArray(partial.content) : [];
  if (partialContent.length === 0) return messageContent;

  const messageHasTool = hasToolCallPart(messageContent);
  const partialHasTool = hasToolCallPart(partialContent);
  if (messageContent.length === 0) return partialContent;
  if (partialHasTool && !messageHasTool) return partialContent;
  if (
    partialHasTool &&
    messageHasTool &&
    partialContent.length >= messageContent.length &&
    contentPayloadLength(partialContent) > contentPayloadLength(messageContent)
  ) {
    return partialContent;
  }
  return messageContent;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part): Array<Record<string, unknown>> => {
    const record = asRecord(part);
    return record ? [record] : [];
  });
}

function hasToolCallPart(content: Array<Record<string, unknown>>): boolean {
  return content.some((part) => part.type === "toolCall");
}

// Cheap structural size proxy for comparing two snapshots of the same growing
// content ("which frame is further along"). Both call sites only ever compare
// snapshots of one logical message, where growth means longer text/thinking,
// longer streamed tool arguments, or more parts — all captured below without
// JSON.stringify-ing multi-MB cumulative content on every streamed frame.
function contentPayloadLength(content: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const part of content) {
    total += 1;
    if (typeof part.text === "string") total += part.text.length;
    if (typeof part.thinking === "string") total += part.thinking.length;
    const args = part.arguments;
    if (typeof args === "string") {
      total += args.length;
    } else if (args && typeof args === "object") {
      for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
        total += key.length + 1;
        if (typeof value === "string") total += value.length;
      }
    }
  }
  return total;
}

function snapshotToolArgsText(
  content: Array<Record<string, unknown>>,
  toolCallId: string,
): string | null {
  for (const part of content) {
    if (part.type !== "toolCall" || part.id !== toolCallId) continue;
    const args = part.arguments;
    if (typeof args === "string") {
      const text = usefulToolArgsText(args);
      if (text) return text;
      continue;
    }
    if (args && typeof args === "object" && Object.keys(args).length > 0) {
      try {
        return JSON.stringify(args, null, 2);
      } catch {
        return String(args);
      }
    }
  }
  return null;
}

function applyLegacyToolCallDeltaIfSnapshotMissedIt(
  blocks: AssistantBlock[],
  existingBlocks: AssistantBlock[],
  event: Record<string, unknown>,
  content: Array<Record<string, unknown>>,
): AssistantBlock[] {
  if (event.type !== "message_update") return blocks;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  const eventType = assistantMessageEvent?.type;
  if (
    eventType !== "toolcall_start" &&
    eventType !== "toolcall_delta" &&
    eventType !== "toolcall_end"
  ) {
    return blocks;
  }
  const snapshot = toolCallSnapshotFromUpdate(assistantMessageEvent ?? undefined, event.message);
  if (snapshot?.id) {
    const snapshotArgsText = snapshotToolArgsText(content, snapshot.id);
    const existingTool = existingBlocks.find(
      (block): block is Extract<AssistantBlock, { kind: "tool" }> =>
        block.kind === "tool" && block.id === snapshot.id,
    );
    const existingArgsText = usefulToolArgsText(existingTool?.argsText);
    if (snapshotArgsText && snapshotArgsText.length > existingArgsText.length) return blocks;
  }
  const blocksWithPreviousTools = preserveMissingToolBlocks(blocks, existingBlocks);
  return applyAssistantPiEventToBlocks(blocksWithPreviousTools, event) ?? blocksWithPreviousTools;
}

function preserveMissingToolBlocks(
  blocks: AssistantBlock[],
  existingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const ids = new Set(blocks.filter((block) => block.kind === "tool").map((block) => block.id));
  const missingTools = existingBlocks.filter(
    (block) => block.kind === "tool" && !ids.has(block.id),
  );
  return missingTools.length ? [...blocks, ...missingTools] : blocks;
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
    return calls;
  }
  if (type === "message_update") {
    // Monotonic slot: a message_update may carry a snapshot that momentarily LAGS
    // the previous frame (assistantSnapshotContent flips between message.content
    // and assistantMessageEvent.partial.content, which don't advance in lockstep).
    // Overwriting the current call with a shorter snapshot shrinks the rendered
    // bubble for one frame — a visible flicker — before the next update re-grows
    // it. Keep whichever snapshot has the larger payload so the slot never regresses.
    const existing = calls[calls.length - 1];
    calls[calls.length - 1] =
      contentPayloadLength(content) >= contentPayloadLength(existing) ? content : existing;
    return calls;
  }
  // message_end carries the call's settled, authoritative content.
  calls[calls.length - 1] = content;
  return calls;
}

function reduceUserMessageEvent(
  session: Session,
  ctx: SessionStreamContext,
  event: Record<string, unknown>,
): Session | null {
  const isCanonical = event.type === "message";
  if (!isCanonical && event.type !== "message_start" && event.type !== "message_end") return null;
  const msg = event.message as { role?: string; content?: string | Record<string, unknown>[] };
  if (msg?.role !== "user") return null;
  const text = visibleUserTextFromPi(messageText(msg.content));

  // A canonical settled user message (replayed log / runtime hydration burst):
  // append it verbatim, close the previous turn's bubble, and derive the
  // session title from the first prompt. It must NOT open an optimistic
  // assistant bubble or touch liveAssistantIds — those are streaming-echo
  // concerns (the branches below).
  if (isCanonical) {
    let next = session.activeAssistantId ? { ...session, activeAssistantId: undefined } : session;
    if (!text) return next;
    if (!next.title) next = { ...next, title: sessionTitleFromPrompt(text) };
    return {
      ...next,
      messages: [
        ...next.messages,
        { id: newId("user"), role: "user", text, timestamp: nowLabel() },
      ],
    };
  }
  if (!text) return session;
  const queue = removeDeliveredQueuedMessage(session.queue ?? [], text);

  // This echo is Pi showing a steer message to the model. If the UI already
  // dropped it into the transcript optimistically (dimmed), clear `pending` so
  // it brightens to normal, and open the assistant bubble for the steered reply
  // — same as a freshly echoed mid-stream message, just without duplicating it.
  const pending = findPendingUserMessage(session.messages, text);
  if (pending) {
    const nextAssistantId = newId("assistant");
    ctx.liveAssistantIds.set(session.id, nextAssistantId);
    return {
      ...session,
      queue,
      activeAssistantId: nextAssistantId,
      messages: [
        ...session.messages.map((message) =>
          message.id === pending.id ? { ...message, pending: false } : message,
        ),
        { id: nextAssistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
      ],
    };
  }

  if (hasMatchingLastUserMessage(session.messages, text)) {
    return { ...session, queue };
  }
  // A mid-stream user message (steer/follow-up) opens the next assistant
  // bubble; later events in this turn target it via ctx.liveAssistantIds.
  const nextAssistantId = newId("assistant");
  ctx.liveAssistantIds.set(session.id, nextAssistantId);
  return {
    ...session,
    queue,
    activeAssistantId: nextAssistantId,
    messages: [
      ...session.messages,
      { id: newId("user"), role: "user", text, timestamp: nowLabel() },
      { id: nextAssistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  };
}

// The optimistic steer bubble awaiting its runtime echo: a still-pending user
// message whose text matches what Pi just delivered to the model.
function findPendingUserMessage(messages: ChatMessage[], text: string): ChatMessage | undefined {
  const target = text.trim();
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" && message.pending === true && message.text.trim() === target,
    );
}

function clearPendingUserMessages(session: Session): Session {
  if (!session.messages.some((message) => message.pending)) return session;
  return {
    ...session,
    messages: session.messages.map((message) =>
      message.pending ? { ...message, pending: false } : message,
    ),
  };
}

function reduceFinalAssistantMessageEvent(
  session: Session,
  ctx: SessionStreamContext,
  event: Record<string, unknown>,
): Session | null {
  // Live `message_end` is owned by the snapshot path; this handles the
  // canonical `message` shape (replayed/settled messages) — plus `message_end`
  // on canonical replay, where it is a settled message too.
  if (event.type !== "message" && !(ctx.replay && event.type === "message_end")) return null;
  const msg = asRecord(event.message);
  if (msg?.role !== "assistant") return null;
  const content = finalMessageContent(msg.content);
  const stopReason = typeof msg.stopReason === "string" ? msg.stopReason : undefined;

  if (ctx.replay) {
    // Canonical replay grouping: a settled `message` fills the still-open
    // bubble when one exists (streamed reattach / tool-result fallback) and
    // otherwise renders as its own bubble; either way it closes the target so
    // the NEXT settled message opens a fresh one — one bubble per settled
    // message, matching the on-disk log.
    const blocks = blocksFromMessageContent(content, { stopReason });
    const text = messageTextFromBlocks(blocks);
    const target = resolveAssistantTarget(session, ctx);
    const patched = patchAssistantMessage(target.session, target.targetId, (current) => ({
      ...current,
      text,
      blocks,
    }));
    ctx.liveAssistantIds.delete(session.id);
    return { ...patched, activeAssistantId: undefined };
  }

  const errorMessage = assistantFailureText(msg, stopReason);
  const blocks = blocksFromMessageContent(content, { stopReason, errorMessage });
  const text = messageTextFromBlocks(blocks);
  const target = resolveAssistantTarget(session, ctx);
  let next = patchAssistantMessage(target.session, target.targetId, (current) =>
    reconcileFinalAssistantMessage(current, text, blocks),
  );
  if (errorMessage) next = { ...next, error: errorMessage };
  return next;
}

function assistantFailureText(
  message: Record<string, unknown>,
  stopReason: string | undefined,
): string {
  // Only a genuine error is a failure. "aborted" (Stop pressed / navigated away)
  // is a clean stop and must produce no error text.
  if (stopReason !== "error") return "";
  const raw = [message.errorMessage, message.error]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
  if (!raw) return "Assistant turn failed.";
  return raw;
}

function appendFailureBlock(blocks: AssistantBlock[], text: string): AssistantBlock[] {
  if (blocks.some((block) => block.kind === "event" && block.text === text)) return blocks;
  return [...blocks, { kind: "event", id: newId("error"), text }];
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
  if (finalMessageCoversExistingBlocks(existingBlocks, incomingBlocks)) {
    return { ...current, text, blocks: mergeExistingToolState(existingBlocks, incomingBlocks) };
  }
  // A tool-free settled message that does NOT "cover" the bubble is the model's
  // closing summary arriving as its own LLM call after a tool-heavy turn (some
  // backends emit it as a bare `message`, not a streamed snapshot). Replacing
  // the bubble would drop the accumulated tool blocks; rejecting it — as this
  // used to — drops the summary, so the turn renders a trailing tool call and
  // no final words. Append the unseen text/thinking instead, tools untouched.
  if (incomingBlocks.some((block) => block.kind === "tool")) return current;
  const appended = appendUnseenTextBlocks(existingBlocks, incomingBlocks);
  return appended === existingBlocks
    ? current
    : { ...current, blocks: appended, text: messageTextFromBlocks(appended) };
}

function appendUnseenTextBlocks(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const shown = existingBlocks
    .filter((block) => block.kind === "text" || block.kind === "thinking")
    .map((block) => block.text.trim())
    .filter(Boolean);
  const alreadyShown = (value: string) =>
    shown.some((existing) => existing === value || existing.includes(value));
  const additions = incomingBlocks.filter(
    (block) =>
      (block.kind === "text" || block.kind === "thinking") &&
      isMeaningfulAssistantText(block.text) &&
      !alreadyShown(block.text.trim()),
  );
  return additions.length ? [...existingBlocks, ...additions] : existingBlocks;
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
