import { traceAgentReasoning } from "@/features/agent/trace-reasoning";
import type { SessionId } from "@/features/agent/runtime/types";

type ApplyPiEvent = (
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
  seq?: number,
) => void;

type FrameToken = {
  cancel: () => void;
};

type ScheduleFrame = (callback: () => void) => FrameToken;

export type TextDeltaCoalescer = {
  enqueuePiEvent: (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    options?: { flushNow?: boolean; seq?: number },
  ) => boolean;
  flushNow: (sessionId: SessionId) => void;
  flushAll: () => void;
  /** Drop a session's pending merge without applying it (cursor epoch reset). */
  discard: (sessionId: SessionId) => void;
};

type PendingSnapshot = {
  assistantId: string;
  event: Record<string, unknown>;
  frame: FrameToken | null;
  // Highest event seq merged into this snapshot — stamped onto the session as
  // lastEventSeq in the same commit that applies the flushed event.
  seq: number | undefined;
};

type TextDeltaSnapshot = {
  kind: "text" | "thinking";
  delta: string;
};

// Coalesces assistant streaming updates to at most one render per animation
// frame. Pi `text_delta`/`thinking_delta` events carry INCREMENTAL chunks (the
// new text only, not a cumulative snapshot), so we merge every same-kind delta
// batched into a frame by concatenating their `delta` strings — dropping any of
// them would silently lose tokens (most visibly the standalone "\n"/"\n\n"
// deltas models emit between paragraphs and table rows). A kind switch (text vs
// thinking) or any non-delta `message_update` flushes the pending merge first
// so ordering is preserved. Every non-`message_update` event (call boundaries,
// tool execution, agent_end) is left for the caller to flush and apply.
export function createTextDeltaCoalescer({
  applyPiEvent,
  scheduleFrame = defaultScheduleFrame,
}: {
  applyPiEvent: ApplyPiEvent;
  scheduleFrame?: ScheduleFrame;
}): TextDeltaCoalescer {
  const pending = new Map<SessionId, PendingSnapshot>();

  const flushNow = (sessionId: SessionId) => {
    const snapshot = pending.get(sessionId);
    if (!snapshot) return;
    snapshot.frame?.cancel();
    pending.delete(sessionId);
    applyPiEvent(sessionId, snapshot.assistantId, snapshot.event, snapshot.seq);
  };

  const scheduleSessionFlush = (sessionId: SessionId) => {
    const snapshot = pending.get(sessionId);
    if (!snapshot || snapshot.frame) return;
    snapshot.frame = scheduleFrame(() => flushNow(sessionId));
  };

  const enqueuePiEvent: TextDeltaCoalescer["enqueuePiEvent"] = (
    sessionId,
    assistantId,
    event,
    options = {},
  ) => {
    if (event.type !== "message_update") return false;
    const existing = pending.get(sessionId);
    if (existing && existing.assistantId !== assistantId) flushNow(sessionId);
    const normalizedEvent = normalizeDeltaEvent(event);
    const incomingDelta = textDeltaFromPiEvent(normalizedEvent);
    const current = pending.get(sessionId);
    const existingDelta = current ? textDeltaFromPiEvent(current.event) : null;
    // Only same-kind text deltas can merge. A kind switch or a non-delta
    // message_update must flush the pending merge so we never reorder events.
    const canMerge =
      Boolean(current) &&
      existingDelta !== null &&
      incomingDelta !== null &&
      existingDelta.kind === incomingDelta.kind;
    if (current && !canMerge) flushNow(sessionId);
    const carried = pending.get(sessionId);
    const nextEvent =
      canMerge && existingDelta && incomingDelta
        ? mergeTextDeltaEvent(normalizedEvent, existingDelta.delta + incomingDelta.delta)
        : normalizedEvent;
    pending.set(sessionId, {
      assistantId,
      event: nextEvent,
      frame: carried?.frame ?? null,
      seq: options.seq ?? carried?.seq,
    });
    traceAgentReasoning("coalescer.snapshot", {
      sessionId,
      assistantId,
      type: normalizedEvent.type,
    });
    if (options.flushNow) {
      flushNow(sessionId);
    } else {
      scheduleSessionFlush(sessionId);
    }
    return true;
  };

  const flushAll = () => {
    for (const sessionId of Array.from(pending.keys())) flushNow(sessionId);
  };

  return {
    enqueuePiEvent,
    flushNow,
    flushAll,
    discard: (sessionId: SessionId) => {
      const snapshot = pending.get(sessionId);
      if (!snapshot) return;
      snapshot.frame?.cancel();
      pending.delete(sessionId);
    },
  };
}

export function textDeltaFromPiEvent(event: Record<string, unknown>): TextDeltaSnapshot | null {
  if (event.type !== "message_update") return null;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  const delta = assistantMessageEvent?.delta;
  if (typeof delta !== "string" || !delta) return null;
  const type = assistantMessageEvent.type;
  if (type === "text_delta") return { kind: "text", delta };
  if (type === "thinking_delta" || type === "reasoning_delta" || type === "reasoning_text_delta") {
    return { kind: "thinking", delta };
  }
  return null;
}

function mergeTextDeltaEvent(
  event: Record<string, unknown>,
  combinedDelta: string,
): Record<string, unknown> {
  const assistantMessageEvent = asRecord(event.assistantMessageEvent) ?? {};
  return {
    ...event,
    assistantMessageEvent: {
      ...assistantMessageEvent,
      delta: combinedDelta,
    },
  };
}

function normalizeDeltaEvent(event: Record<string, unknown>): Record<string, unknown> {
  const delta = textDeltaFromPiEvent(event);
  if (!delta || delta.kind !== "thinking") return event;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  if (!assistantMessageEvent || assistantMessageEvent.type === "thinking_delta") return event;
  return {
    ...event,
    assistantMessageEvent: {
      ...assistantMessageEvent,
      type: "thinking_delta",
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function defaultScheduleFrame(callback: () => void): FrameToken {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const requestAnimationFrame = window.requestAnimationFrame.bind(window);
    const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const frame = requestAnimationFrame(() => callback());
    return { cancel: () => cancelAnimationFrame(frame) };
  }

  const timer = setTimeout(callback, 0);
  return { cancel: () => clearTimeout(timer) };
}
