import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import type { SessionId } from "./types";

type ApplyPiEvent = (
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
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
    options?: { flushNow?: boolean },
  ) => boolean;
  flushNow: (sessionId: SessionId) => void;
  flushAll: () => void;
  dispose: () => void;
};

type PendingSnapshot = {
  assistantId: string;
  event: Record<string, unknown>;
  frame: FrameToken | null;
};

type TextDeltaSnapshot = {
  kind: "text" | "thinking";
  delta: string;
};

// Coalesces assistant streaming updates to at most one render per animation
// frame. Each pi `message_update` carries the FULL accumulated message snapshot,
// so superseded snapshots can be dropped losslessly — we keep only the latest
// per session and apply it on the next frame. Every non-`message_update` event
// (call boundaries, tool execution, agent_end) is left for the caller to flush
// the pending snapshot and apply immediately, preserving event order.
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
    applyPiEvent(sessionId, snapshot.assistantId, snapshot.event);
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
    const existingDelta = existing ? textDeltaFromPiEvent(existing.event) : null;
    if (existingDelta && incomingDelta && existingDelta.kind !== incomingDelta.kind) {
      flushNow(sessionId);
    }
    const carriedFrame = pending.get(sessionId)?.frame ?? null;
    pending.set(sessionId, { assistantId, event: normalizedEvent, frame: carriedFrame });
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
    dispose: () => {
      for (const snapshot of pending.values()) snapshot.frame?.cancel();
      pending.clear();
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
