// Pure state machine for the per-session runtime event cursor. This is the
// single source of truth for ordering decisions on the live event stream:
// which seqs to accept, where to reconnect from, and what to persist.
//
// `receivedSeq` is the highest seq seen on the wire — the dedup gate and the
// SSE reconnect cursor. `committedSeq` is the highest seq whose effects have
// actually been reduced into session state — the only value that may be
// persisted as `Session.lastEventSeq`. They diverge while a text delta sits
// in the animation-frame coalescer.

export type RuntimeCursor = {
  receivedSeq: number | undefined;
  committedSeq: number | undefined;
};

/**
 * Gate an incoming payload. Seq-less payloads (status frames) always pass and
 * never advance the cursor. A seq at or below the highest received one is a
 * duplicate (server replay overlap, out-of-order packet) and is rejected.
 */
export function acceptRuntimeSeq(
  cursor: RuntimeCursor,
  seq: number | undefined,
): { accept: boolean; cursor: RuntimeCursor } {
  if (typeof seq !== "number") return { accept: true, cursor };
  if (seq <= (cursor.receivedSeq ?? 0)) return { accept: false, cursor };
  return { accept: true, cursor: { ...cursor, receivedSeq: seq } };
}

/** Mark a seq's effects as reduced into session state. Monotonic. */
export function commitRuntimeSeq(cursor: RuntimeCursor, seq: number | undefined): RuntimeCursor {
  if (typeof seq !== "number" || seq <= (cursor.committedSeq ?? 0)) return cursor;
  return { ...cursor, committedSeq: seq };
}

/**
 * Adopt a session-level cursor written outside the live stream. Deliberately
 * NON-monotonic: Pi's per-runtime seq restarts when a new prompt begins on the
 * same Pi session (`lastEventSeq: 0` on turn accept) and replay hydration
 * reseeds it (`replayCursorAfterRuntimeHydration`), so resets must move the
 * gate backwards. Making this monotonic reintroduces the dropped-second-turn
 * bug.
 */
export function adoptExternalCursor(sessionLastEventSeq?: number): RuntimeCursor {
  return { receivedSeq: sessionLastEventSeq, committedSeq: sessionLastEventSeq };
}

/**
 * Where a reconnecting SSE subscription resumes from: the highest RECEIVED
 * seq, not the committed one. An unflushed coalesced delta is still in memory,
 * so replaying it would double-apply; anything newer has genuinely not been
 * seen.
 */
export function reconnectAfter(cursor: RuntimeCursor): number {
  return cursor.receivedSeq ?? 0;
}

// A prompt's optimistic "starting" phase deliberately does not subscribe yet:
// the runtime can still be idle from the previous turn, and subscribing too
// early can receive a final idle status before `/turn` has restarted Pi.
export function shouldSubscribeRuntimeEvents(status: string): boolean {
  return status === "running" || status === "stopping";
}
