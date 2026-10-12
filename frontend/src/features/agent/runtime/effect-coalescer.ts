// Effect-TS text-delta coalescer.
//
// The per-session pending state is a plain mutable container (the enqueue path
// is synchronous and needs immediate read/write — wrapping it in Ref<Effect>
// would just add ceremony for no gain), while the animation-frame flush runs
// as a forked Effect fiber.
//
// Merge semantics: same-kind text deltas concatenate so no incremental token
// is dropped; a kind switch or a non-delta `message_update` flushes first to
// preserve ordering.

import { Effect, Fiber } from "effect";
import type { SessionId } from "@/features/agent/runtime/types";
import { traceAgentReasoning } from "@/features/agent/trace-reasoning";

type ApplyPiEvent = (sessionId: SessionId, event: Record<string, unknown>, seq?: number) => void;

export type TextDeltaCoalescer = {
  enqueuePiEvent: (
    sessionId: SessionId,
    event: Record<string, unknown>,
    options?: { flushNow?: boolean; seq?: number },
  ) => boolean;
  flushNow: (sessionId: SessionId) => void;
  /** Drop a session's pending merge without applying it (cursor epoch reset). */
  discard: (sessionId: SessionId) => void;
  /** Flush and drop every slot (workspace teardown). */
  clear: () => void;
};

type TextDeltaSnapshot = { kind: "text" | "thinking"; delta: string };

type PendingSnapshot = {
  event: Record<string, unknown>;
  seq: number | undefined;
};

/** A cancellable animation-frame handle. */
type FlushHandle = { cancel: () => void };

type ScheduleFrame = (callback: () => void) => FlushHandle;

type SessionSlot = {
  pending: PendingSnapshot | null;
  // Non-null while a frame-driven flush is in flight, so we don't stack flushes.
  flushHandle: FlushHandle | null;
};

/**
 * Build a coalescer. `applyPiEvent` is the commit callback the controller wires
 * to the React dispatch, so every flush ultimately calls it.
 */
export function createEffectTextDeltaCoalescer({
  applyPiEvent,
}: {
  applyPiEvent: ApplyPiEvent;
}): TextDeltaCoalescer {
  const slots = new Map<SessionId, SessionSlot>();

  const getSlot = (sessionId: SessionId): SessionSlot => {
    const existing = slots.get(sessionId);
    if (existing) return existing;
    const slot: SessionSlot = { pending: null, flushHandle: null };
    slots.set(sessionId, slot);
    return slot;
  };

  const applyPending = (sessionId: SessionId, snapshot: PendingSnapshot): void => {
    applyPiEvent(sessionId, snapshot.event, snapshot.seq);
  };

  const cancelFlush = (slot: SessionSlot): void => {
    if (slot.flushHandle) {
      slot.flushHandle.cancel();
      slot.flushHandle = null;
    }
  };

  const frameClock: ScheduleFrame = (callback) => {
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        yield* waitForAnimationFrame;
        callback();
      }),
    );
    return { cancel: () => void Effect.runPromise(Fiber.interrupt(fiber)) };
  };
  const flushNow = (sessionId: SessionId): void => {
    const slot = slots.get(sessionId);
    if (!slot || !slot.pending) return;
    cancelFlush(slot);
    const current = slot.pending;
    slot.pending = null;
    applyPending(sessionId, current);
  };

  const scheduleFlush = (sessionId: SessionId): void => {
    const slot = getSlot(sessionId);
    if (slot.flushHandle) return; // a flush is already scheduled for this frame
    // Yield to the frame clock, then apply whatever accumulated for this session.
    // A handle that was cancelled (discard/flushNow) but whose callback still
    // fires is harmless: `pending` is already null, so it applies nothing.
    slot.flushHandle = frameClock(() => {
      const slotNow = slots.get(sessionId);
      if (!slotNow) return;
      slotNow.flushHandle = null;
      const current = slotNow.pending;
      slotNow.pending = null;
      if (current) applyPending(sessionId, current);
    });
  };

  const enqueuePiEvent: TextDeltaCoalescer["enqueuePiEvent"] = (sessionId, event, options = {}) => {
    if (event.type !== "message_update") return false;
    const slot = getSlot(sessionId);
    const normalizedEvent = normalizeDeltaEvent(event);
    const incomingDelta = textDeltaFromPiEvent(normalizedEvent);
    const current = slot.pending;
    const existingDelta = current ? textDeltaFromPiEvent(current.event) : null;
    const canMerge =
      Boolean(current) &&
      existingDelta !== null &&
      incomingDelta !== null &&
      existingDelta.kind === incomingDelta.kind;
    if (current && !canMerge) flushNow(sessionId);
    const carried = slot.pending;
    const nextEvent =
      canMerge && existingDelta && incomingDelta
        ? mergeTextDeltaEvent(normalizedEvent, existingDelta.delta + incomingDelta.delta)
        : normalizedEvent;
    slot.pending = {
      event: nextEvent,
      seq: options.seq ?? carried?.seq,
    };
    traceAgentReasoning("coalescer.snapshot", {
      sessionId,
      type: normalizedEvent.type,
    });
    if (options.flushNow) {
      flushNow(sessionId);
    } else {
      scheduleFlush(sessionId);
    }
    return true;
  };

  // Flush every slot, cancel any pending frame handles, then drop all slots so
  // the map does not retain one entry per session for the app lifetime.
  const clear = (): void => {
    for (const sessionId of Array.from(slots.keys())) {
      const slot = slots.get(sessionId);
      if (slot) {
        flushNow(sessionId);
        cancelFlush(slot);
      }
    }
    slots.clear();
  };

  const discard = (sessionId: SessionId): void => {
    const slot = slots.get(sessionId);
    if (!slot) return;
    cancelFlush(slot);
    slot.pending = null;
  };

  return { enqueuePiEvent, flushNow, discard, clear };
}

// A single-frame wait. Uses requestAnimationFrame on the DOM; falls back to a
// zero-delay timeout otherwise (matches the legacy defaultScheduleFrame).
const waitForAnimationFrame: Effect.Effect<void> = Effect.callback<void>((resume) => {
  let cancelled = false;
  let handle: number | ReturnType<typeof setTimeout>;
  const finish = () => {
    if (cancelled) return;
    resume(Effect.void);
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    handle = window.requestAnimationFrame(finish);
    return Effect.sync(() => {
      cancelled = true;
      if (typeof handle === "number") window.cancelAnimationFrame(handle);
    });
  }
  handle = setTimeout(finish, 0);
  return Effect.sync(() => {
    cancelled = true;
    clearTimeout(handle);
  });
});

function textDeltaFromPiEvent(event: Record<string, unknown>): TextDeltaSnapshot | null {
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
    assistantMessageEvent: { ...assistantMessageEvent, delta: combinedDelta },
  };
}

function normalizeDeltaEvent(event: Record<string, unknown>): Record<string, unknown> {
  const delta = textDeltaFromPiEvent(event);
  if (!delta || delta.kind !== "thinking") return event;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  if (!assistantMessageEvent || assistantMessageEvent.type === "thinking_delta") return event;
  return {
    ...event,
    assistantMessageEvent: { ...assistantMessageEvent, type: "thinking_delta" },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
