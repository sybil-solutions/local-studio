import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import type { SessionId } from "./types";

type TextDeltaKind = "text" | "thinking";

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

type KindBuffer = {
  assistantId: string;
  delta: string;
  event: Record<string, unknown>;
  firstSeq: number;
  kind: TextDeltaKind;
};

type SessionBuffer = {
  entries: KindBuffer[];
  frame: FrameToken | null;
};

type DeltaEvent = {
  delta: string;
  kind: TextDeltaKind;
};

export function createTextDeltaCoalescer({
  applyPiEvent,
  scheduleFrame = defaultScheduleFrame,
}: {
  applyPiEvent: ApplyPiEvent;
  scheduleFrame?: ScheduleFrame;
}): TextDeltaCoalescer {
  const pending = new Map<SessionId, SessionBuffer>();
  let sequence = 0;

  const flushNow = (sessionId: SessionId) => {
    const buffer = pending.get(sessionId);
    if (!buffer) return;
    buffer.frame?.cancel();
    pending.delete(sessionId);

    for (const entry of orderedEntries(buffer)) {
      applyPiEvent(
        sessionId,
        entry.assistantId,
        syntheticDeltaEvent(entry.event, entry.delta, eventTypeForKind(entry)),
      );
    }
  };

  const scheduleSessionFlush = (sessionId: SessionId, buffer: SessionBuffer) => {
    if (buffer.frame) return;
    buffer.frame = scheduleFrame(() => flushNow(sessionId));
  };

  const enqueuePiEvent: TextDeltaCoalescer["enqueuePiEvent"] = (
    sessionId,
    assistantId,
    event,
    options = {},
  ) => {
    const deltaEvent = textDeltaFromPiEvent(event);
    if (!deltaEvent) return false;
    traceAgentReasoning("coalescer.enqueue", {
      sessionId,
      assistantId,
      kind: deltaEvent.kind,
      delta: deltaEvent.delta,
      event,
    });

    const existing = pending.get(sessionId);
    if (existing && bufferAssistantId(existing) !== assistantId) {
      flushNow(sessionId);
    }

    const buffer = pending.get(sessionId) ?? { entries: [], frame: null };
    const current = buffer.entries.at(-1);
    if (current) {
      if (current.kind === deltaEvent.kind) {
        current.delta += deltaEvent.delta;
        current.event = event;
      } else {
        buffer.entries.push({
          assistantId,
          delta: deltaEvent.delta,
          event,
          firstSeq: sequence,
          kind: deltaEvent.kind,
        });
        sequence += 1;
      }
    } else {
      buffer.entries.push({
        assistantId,
        delta: deltaEvent.delta,
        event,
        firstSeq: sequence,
        kind: deltaEvent.kind,
      });
      sequence += 1;
    }
    pending.set(sessionId, buffer);

    if (options.flushNow) {
      flushNow(sessionId);
    } else {
      scheduleSessionFlush(sessionId, buffer);
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
      for (const buffer of pending.values()) buffer.frame?.cancel();
      pending.clear();
    },
  };
}

export function textDeltaFromPiEvent(event: Record<string, unknown>): DeltaEvent | null {
  if (event.type !== "message_update") return null;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  const delta = assistantMessageEvent?.delta;
  if (typeof delta !== "string" || !delta) return null;
  if (
    assistantMessageEvent.type === "thinking_delta" ||
    assistantMessageEvent.type === "reasoning_delta" ||
    assistantMessageEvent.type === "reasoning_text_delta"
  ) {
    return { kind: "thinking", delta };
  }
  if (assistantMessageEvent.type === "text_delta") {
    traceAgentReasoning("coalescer.classify", {
      kind: "text",
      assistantMessageEventType: assistantMessageEvent.type,
      contentIndex: assistantMessageEvent.contentIndex,
      delta,
    });
    return { kind: "text", delta };
  }
  return null;
}

function orderedEntries(buffer: SessionBuffer): KindBuffer[] {
  return buffer.entries.slice().sort((a, b) => a.firstSeq - b.firstSeq);
}

function bufferAssistantId(buffer: SessionBuffer): string | undefined {
  return buffer.entries[0]?.assistantId;
}

function eventTypeForKind(entry: KindBuffer): "text_delta" | "thinking_delta" {
  return entry.kind === "thinking" ? "thinking_delta" : "text_delta";
}

function syntheticDeltaEvent(
  event: Record<string, unknown>,
  delta: string,
  type: "text_delta" | "thinking_delta",
): Record<string, unknown> {
  return {
    ...event,
    type: "message_update",
    assistantMessageEvent: {
      ...asRecord(event.assistantMessageEvent),
      type,
      delta,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
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
