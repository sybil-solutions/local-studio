// THE single owner of live session event ordering AND of runtime-derived
// session status. This module — and only this module — opens runtime SSE
// subscriptions, tracks per-session event cursors, reconnects, flushes the
// text-delta coalescer, reduces runtime events into session state, and runs
// the runtime-list poll that arbitrates running/idle. React integrates
// through a thin binding (use-workspace-runtime-sync.ts); nothing else may
// subscribe to runtime events, gate event seqs, or settle a session's
// runtime status. (Turn-intent status — "starting", accept, abort — stays
// with prompt-stream/engine; hydration status with loadAndReplay.)

import { isAgentEndEvent } from "@/features/agent/pi-runtime-state";
import {
  drainQueueAfterAgentEnd,
  newId,
  nowLabel,
  piSessionIdFromEvent,
} from "@/features/agent/messages";
import {
  listRuntimeSessions,
  loadRuntimeStatus,
  runtimeContextUsage,
  subscribeRuntimeEvents,
  type RuntimeEventPayload,
  type RuntimeEventSubscription,
  type RuntimeSessionSummary,
  type RuntimeStatus,
} from "@/features/agent/runtime/api";
import {
  reduceSessionEvent,
  type SessionStreamContext,
} from "@/features/agent/runtime/pi-event-applier";
import {
  acceptRuntimeSeq,
  adoptExternalCursor,
  commitRuntimeSeq,
  reconnectAfter,
  shouldSubscribeRuntimeEvents,
  type RuntimeCursor,
} from "@/features/agent/runtime/runtime-cursor";
import { createEffectTextDeltaCoalescer } from "@/features/agent/runtime/effect-coalescer";
import { Effect, Fiber, Schedule } from "effect";
import type { Session, SessionId } from "@/features/agent/runtime/types";

const RESUME_IDLE_RECONNECT_MS = 15_000;
const RESUME_RECONNECT_DELAY_MS = 1_000;
const RUNTIME_POLL_INTERVAL_MS = 5_000;
const RUNTIME_POLL_IDLE_GRACE_MS = 10_000;

type ScheduleFrame = (callback: () => void) => { cancel: () => void };

export type SessionRuntimeBinding = {
  /** Single state commit boundary — one patchSession dispatch per call. */
  commit: (sessionId: SessionId, patch: (session: Session) => Session) => void;
  /** Read the current session snapshot (never cached by the controller). */
  getSession: (sessionId: SessionId) => Session | undefined;
  /** Read all current workspace sessions (the binding's live ref). */
  getSessions: () => readonly Session[];
};

export type SessionRuntimeControllerDeps = {
  api?: Partial<{
    listRuntimeSessions: typeof listRuntimeSessions;
    loadRuntimeStatus: typeof loadRuntimeStatus;
    subscribeRuntimeEvents: typeof subscribeRuntimeEvents;
  }>;
  scheduleFrame?: ScheduleFrame;
  reconnectDelayMs?: number;
  idleReconnectMs?: number;
  pollIntervalMs?: number;
  pollIdleGraceMs?: number;
};

export type SessionRuntimeController = {
  bind(binding: SessionRuntimeBinding): void;
  unbind(): void;
  /**
   * Reconcile live SSE attachments against the session set: attach sessions
   * entering the live set, detach those leaving, recreate only when the
   * connection params (runtime/pi id) change.
   */
  reconcile(sessions: readonly Session[]): void;
  /**
   * A `/turn` command was accepted: Pi's per-runtime event seq restarts, so
   * reset the cursor to 0, drop any pending deltas from the previous epoch,
   * and persist the reset. The deliberate backwards move — without it the
   * gate silently drops the entire next turn.
   */
  noteTurnAccepted(sessionId: SessionId): void;
  /**
   * loadAndReplay hydrated the transcript from canonical + runtime logs up to
   * `committedSeq` (undefined when the runtime is idle): reattach from there
   * so EventSource does not replay already-rendered content.
   */
  noteReplayHydrated(sessionId: SessionId, committedSeq: number | undefined): void;
  /** Apply any coalesced-but-unflushed deltas for a session right now. */
  flush(sessionId: SessionId): void;
  /**
   * Subscribe to changes in the set of session ids (runtime + pi) the runtime
   * reports as actively working. Drives the sidebar's background-activity
   * indicator. Returns an unsubscribe fn.
   */
  subscribeActiveRuntimeIds(listener: () => void): () => void;
  /** Current set of actively-working session ids (stable identity until change). */
  getActiveRuntimeIds(): ReadonlySet<string>;
  /** Session ids that finished working while unseen (drives the sidebar dot). */
  getUnseenFinishedIds(): ReadonlySet<string>;
  /** Clear a session's unseen-activity flag (the user opened/looked at it). */
  markRuntimeSeen(sessionId: string): void;
  /**
   * Reconcile every session against the runtime list right now, then restart
   * the steady poll. Called by the React binding when poll-relevant session
   * identity (membership / runtime id / pi id / status) changes.
   */
  pollNow(): void;
  /** Flush everything and close every SSE attachment (workspace unmount). */
  closeAll(): void;
};

type Attachment = { key: string; close: () => void };

function resumeConnectionKey(runtimeSessionId: string, piSessionId: string | null): string {
  return `${runtimeSessionId}|${piSessionId ?? ""}`;
}

function patchRuntimeStatus(status: RuntimeStatus): Partial<Session> {
  return {
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
  };
}

function sameRuntimePatch(
  session: Session,
  patch: Partial<Session>,
  status: string,
  runtimeSessionId = session.runtimeSessionId,
): boolean {
  return (
    session.status === status &&
    session.runtimeSessionId === runtimeSessionId &&
    (patch.piSessionId === undefined || session.piSessionId === patch.piSessionId) &&
    (patch.modelId === undefined || session.modelId === patch.modelId) &&
    (patch.contextUsage === undefined ||
      JSON.stringify(session.contextUsage ?? null) === JSON.stringify(patch.contextUsage ?? null))
  );
}

export function createSessionRuntimeController(
  deps: SessionRuntimeControllerDeps = {},
): SessionRuntimeController {
  const api = { listRuntimeSessions, loadRuntimeStatus, subscribeRuntimeEvents, ...deps.api };
  const reconnectDelayMs = deps.reconnectDelayMs ?? RESUME_RECONNECT_DELAY_MS;
  const idleReconnectMs = deps.idleReconnectMs ?? RESUME_IDLE_RECONNECT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? RUNTIME_POLL_INTERVAL_MS;
  const pollIdleGraceMs = deps.pollIdleGraceMs ?? RUNTIME_POLL_IDLE_GRACE_MS;

  let binding: SessionRuntimeBinding | null = null;
  const cursors = new Map<SessionId, RuntimeCursor>();
  const streamContext: SessionStreamContext = { liveAssistantIds: new Map() };
  const attachments = new Map<SessionId, Attachment>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollEpoch = 0;
  const turnAcceptedAt = new Map<SessionId, number>();

  // The set of session ids (runtime AND pi ids) the runtime reports as actively
  // working, refreshed every poll. The sidebar subscribes so a session running
  // in the BACKGROUND (not open in any pane) still shows a working indicator —
  // the poll sees server-side runtimes regardless of pane membership. A new Set
  // identity is produced only on change, so useSyncExternalStore stays stable.
  let activeRuntimeIds: ReadonlySet<string> = new Set();
  // Sessions that finished working while not being looked at — the sidebar
  // "unseen activity" dot. Set when a session leaves the active set; cleared
  // when the user opens it (markRuntimeSeen) or it starts working again.
  let unseenFinishedIds: ReadonlySet<string> = new Set();
  const activeRuntimeListeners = new Set<() => void>();
  const notifyRuntimeListeners = () => activeRuntimeListeners.forEach((listener) => listener());
  const setsEqual = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
    a.size === b.size && [...a].every((id) => b.has(id));
  const updateActiveRuntimeIds = (entries: RuntimeSessionSummary[]): void => {
    const next = new Set<string>();
    for (const entry of entries) {
      if (entry.status.active !== true) continue;
      if (entry.sessionId) next.add(entry.sessionId);
      if (entry.status.piSessionId) next.add(entry.status.piSessionId);
    }
    let nextUnseen: Set<string> | null = null;
    // Active -> inactive = finished in the background -> unseen.
    for (const id of activeRuntimeIds) {
      if (!next.has(id)) (nextUnseen ??= new Set(unseenFinishedIds)).add(id);
    }
    // Re-entered active = working again -> not unseen anymore.
    for (const id of next) {
      if (unseenFinishedIds.has(id)) (nextUnseen ??= new Set(unseenFinishedIds)).delete(id);
    }
    const activeChanged = !setsEqual(activeRuntimeIds, next);
    if (!activeChanged && !nextUnseen) return;
    if (activeChanged) activeRuntimeIds = next;
    if (nextUnseen) unseenFinishedIds = nextUnseen;
    notifyRuntimeListeners();
  };
  const markRuntimeSeen = (sessionId: string): void => {
    if (!unseenFinishedIds.has(sessionId)) return;
    const next = new Set(unseenFinishedIds);
    next.delete(sessionId);
    unseenFinishedIds = next;
    notifyRuntimeListeners();
  };

  const commit = (sessionId: SessionId, patch: (session: Session) => Session) => {
    binding?.commit(sessionId, patch);
  };
  const getSession = (sessionId: SessionId) => binding?.getSession(sessionId);

  // Stamp the committed cursor onto the session in the SAME commit that
  // applies the event's effects — content and cursor land atomically, so a
  // teardown can never persist a cursor ahead of rendered content.
  const stampSeq = (session: Session, seq: number | undefined): Session => {
    if (typeof seq !== "number") return session;
    if (typeof session.lastEventSeq === "number" && seq <= session.lastEventSeq) return session;
    return { ...session, lastEventSeq: seq };
  };

  const applyEvent = (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    seq?: number,
    decorate: (session: Session) => Session = (session) => session,
  ) => {
    commit(sessionId, (session) =>
      decorate(stampSeq(reduceSessionEvent(session, streamContext, assistantId, event), seq)),
    );
    cursors.set(
      sessionId,
      commitRuntimeSeq(cursors.get(sessionId) ?? adoptExternalCursor(undefined), seq),
    );
  };

  // Text-delta coalescer is now an Effect program (effect-coalescer.ts): a
  // per-session pending snapshot drained on the animation-frame clock. The
  // imperative facade is unchanged so the controller's contract holds.
  const coalescer = createEffectTextDeltaCoalescer({
    applyPiEvent: applyEvent,
    scheduleFrame: deps.scheduleFrame,
  });

  const enqueueEvent = (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    seq: number | undefined,
  ) => {
    if (coalescer.enqueuePiEvent(sessionId, assistantId, event, { seq })) return;
    // Non-delta events flush any pending merge first so ordering is preserved.
    coalescer.flushNow(sessionId);
    applyEvent(sessionId, assistantId, event, seq);
  };

  // Receive gate: advance receivedSeq immediately (dedup + reconnect cursor);
  // committedSeq — and the persisted lastEventSeq — only advance when the
  // event's effects are actually committed (see applyEvent).
  const acceptSeq = (sessionId: SessionId, seq?: number): boolean => {
    const current = cursors.get(sessionId) ?? adoptExternalCursor(undefined);
    const decision = acceptRuntimeSeq(current, seq);
    if (decision.accept) cursors.set(sessionId, decision.cursor);
    return decision.accept;
  };

  const adoptCursor = (sessionId: SessionId, committedSeq: number | undefined) => {
    coalescer.discard(sessionId);
    cursors.set(sessionId, adoptExternalCursor(committedSeq));
    commit(sessionId, (session) =>
      session.lastEventSeq === committedSeq ? session : { ...session, lastEventSeq: committedSeq },
    );
  };

  // Resolve (or create) the assistant bubble that live events should target.
  const ensureAssistantId = (sessionId: SessionId): string => {
    const current = getSession(sessionId);
    const existing =
      (current?.activeAssistantId &&
        current.messages.some((message) => message.id === current.activeAssistantId) &&
        current.activeAssistantId) ||
      [...(current?.messages ?? [])].reverse().find((message) => message.role === "assistant")?.id;
    if (existing) {
      commit(sessionId, (session) =>
        session.activeAssistantId === existing
          ? session
          : { ...session, activeAssistantId: existing },
      );
      return existing;
    }

    const assistantId = newId("assistant");
    commit(sessionId, (session) => ({
      ...session,
      activeAssistantId: assistantId,
      messages: [
        ...session.messages,
        { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
      ],
    }));
    return assistantId;
  };

  const applyStatusPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "status" }>,
  ) => {
    const idle = payload.phase === "done" || payload.phase === "idle";
    commit(sessionId, (session) => ({
      ...session,
      piSessionId: payload.session?.piSessionId || session.piSessionId,
      contextUsage: runtimeContextUsage(payload.session, session.contextUsage),
      status: idle ? "idle" : "running",
      activeAssistantId: idle ? undefined : session.activeAssistantId,
    }));
  };

  const applyPiPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "pi" }>,
  ) => {
    const eventId = piSessionIdFromEvent(payload.event);
    if (!acceptSeq(sessionId, payload.seq)) return;
    const assistantId = ensureAssistantId(sessionId);

    if (isAgentEndEvent(payload.event)) {
      // Flush pending deltas first, then settle the turn in ONE commit:
      // finalize tool blocks, stamp the cursor, and clear the live status
      // together.
      coalescer.flushNow(sessionId);
      applyEvent(sessionId, assistantId, payload.event, payload.seq, (session) => ({
        ...session,
        piSessionId: eventId || session.piSessionId,
        status: "idle",
        activeAssistantId: undefined,
      }));
      // The turn is over: drop any mid-stream user-message redirect. The
      // liveAssistantIds override only bridges the React-commit lag WITHIN a
      // turn; left set, it would silently retarget the NEXT turn's events onto
      // this (now settled) bubble, so the next bubble renders empty — tool
      // calls and reasoning land off-screen and no final content appears.
      streamContext.liveAssistantIds.delete(sessionId);
      // Queue display reconciliation only: Pi drains its own follow_up queue
      // server-side, so locally we just drop the drained head and any
      // already-sent items from the visible queue.
      commit(sessionId, (session) =>
        (session.queue ?? []).length === 0
          ? session
          : { ...session, queue: drainQueueAfterAgentEnd(session.queue ?? []).remaining },
      );
      return;
    }

    commit(sessionId, (session) =>
      session.status === "running" &&
      session.activeAssistantId === assistantId &&
      (!eventId || session.piSessionId === eventId)
        ? session
        : {
            ...session,
            piSessionId: eventId || session.piSessionId,
            status: "running",
            activeAssistantId: assistantId,
          },
    );
    enqueueEvent(sessionId, assistantId, payload.event, payload.seq);
  };

  // Reconcile the workspace sessions against one runtime-list snapshot. The
  // poll is the second leg of status arbitration next to the SSE attachments:
  // it promotes sessions whose runtime is active (including adopting a new
  // runtimeSessionId via the pi-session match) and idles sessions the runtime
  // no longer reports as active.
  const applyRuntimeList = (runtimeSessions: RuntimeSessionSummary[], fetchStartedAt: number) => {
    const byRuntime = new Map(runtimeSessions.map((entry) => [entry.sessionId, entry.status]));
    const byPi = new Map(
      runtimeSessions
        .filter((entry) => entry.status.piSessionId)
        .map((entry) => [
          entry.status.piSessionId!,
          { runtimeSessionId: entry.sessionId, status: entry.status },
        ]),
    );
    for (const session of binding?.getSessions() ?? []) {
      const direct = byRuntime.get(session.runtimeSessionId);
      const piMatch = session.piSessionId ? byPi.get(session.piSessionId) : undefined;
      const status = direct ?? piMatch?.status;
      if (!status) continue;
      if (status.active === true) {
        const patch = patchRuntimeStatus(status);
        const nextRuntimeSessionId = piMatch?.runtimeSessionId ?? session.runtimeSessionId;
        commit(session.id, (current) => {
          if (sameRuntimePatch(current, patch, "running", nextRuntimeSessionId)) return current;
          return {
            ...current,
            ...(current.runtimeSessionId !== nextRuntimeSessionId
              ? { runtimeSessionId: nextRuntimeSessionId }
              : {}),
            ...patch,
            status: "running",
          };
        });
      } else if (session.status === "running") {
        // Only a session the runtime once acknowledged (status "running") may be
        // idled by the poll. A freshly-sent "starting" turn is not yet in the
        // runtime list during prefill/TTFT; idling it here would hide the
        // working indicator for several seconds until the first token lands.
        // The prompt stream's own `finally` owns the starting->terminal
        // transition, so the poll must not race it.
        //
        // Accept-vs-poll grace: a list snapshot fetched before — or shortly
        // after — a `/turn` acceptance cannot speak for the new turn, so it
        // may not idle the session either. Only the idle branch is suppressed;
        // the active branch is the recovery path and must always apply.
        const acceptedAt = turnAcceptedAt.get(session.id);
        if (acceptedAt !== undefined && fetchStartedAt - acceptedAt < pollIdleGraceMs) continue;
        const patch = patchRuntimeStatus(status);
        commit(session.id, (current) => {
          if (current.status !== "running") return current;
          if (sameRuntimePatch(current, patch, "idle") && !current.activeAssistantId) {
            return current;
          }
          return {
            ...current,
            ...patch,
            status: "idle",
            activeAssistantId: undefined,
          };
        });
      }
    }
  };

  const stopPoll = () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Invalidate any in-flight fetch: a stale snapshot from the previous
    // session registry must not apply after a fresher immediate reconcile.
    pollEpoch += 1;
  };

  const pollOnce = async () => {
    const epoch = pollEpoch;
    const fetchStartedAt = Date.now();
    const entries = await api.listRuntimeSessions();
    if (epoch !== pollEpoch || !binding) return;
    updateActiveRuntimeIds(entries);
    applyRuntimeList(entries, fetchStartedAt);
  };

  // One SSE attachment per live session: connect, reconnect with a fixed
  // delay, watchdog the stream, and probe runtime liveness on errors.
  const openAttachment = (
    sessionId: SessionId,
    runtime: string,
    piSessionId: string | null,
  ): Attachment => {
    let closed = false;
    let reconnecting = false;
    let sub: RuntimeEventSubscription | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPayloadAt = Date.now();

    const reconnect = () => {
      if (closed || reconnecting) return;
      reconnecting = true;
      sub?.close();
      // Capped fixed-delay reconnect on a real timer so it is interruptible on
      // close and deterministically drivable under test clocks.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnecting = false;
        if (!closed) connect();
      }, reconnectDelayMs);
    };

    const reconcileLiveness = async () => {
      const status = await api.loadRuntimeStatus(runtime, piSessionId);
      if (closed) return;
      // Inconclusive probe (network blip / proxy idle-timeout / transient
      // 5xx): loadRuntimeStatus returns null only on error. Do NOT tear down
      // or mark the session idle — pi is almost certainly still running.
      if (!status) {
        reconnect();
        return;
      }
      if (status.active) {
        commit(sessionId, (session) => ({
          ...session,
          piSessionId: status.piSessionId || session.piSessionId,
          contextUsage: runtimeContextUsage(status, session.contextUsage),
          status: "running",
        }));
        reconnect();
        return;
      }
      // Definitively idle — close the stream, flush pending deltas, then
      // settle the session. Order matters: the last coalesced delta must land
      // before the idle patch.
      sub?.close();
      coalescer.flushNow(sessionId);
      commit(sessionId, (session) =>
        session.status === "running" || session.status === "starting"
          ? {
              ...session,
              status: "idle",
              activeAssistantId: undefined,
              contextUsage: runtimeContextUsage(status, session.contextUsage),
            }
          : session,
      );
    };

    const connect = () => {
      // (Re)connect from the highest RECEIVED seq — an unflushed coalesced
      // delta is still in memory, so replaying it would double-apply.
      const after = reconnectAfter(cursors.get(sessionId) ?? adoptExternalCursor(undefined));
      sub = api.subscribeRuntimeEvents(runtime, after, piSessionId, {
        onPayload: (payload) => {
          if (closed) return;
          lastPayloadAt = Date.now();
          if (payload.type === "status") applyStatusPayload(sessionId, payload);
          else applyPiPayload(sessionId, payload);
        },
        onError: () => {
          if (closed) return;
          void reconcileLiveness();
        },
      });
    };

    connect();

    const watchdogFiber = Effect.runFork(
      Effect.sync(() => {
        if (closed || Date.now() - lastPayloadAt < idleReconnectMs) return;
        void reconcileLiveness();
      }).pipe(Effect.repeat(Schedule.spaced(idleReconnectMs))),
    ) as never;

    return {
      key: resumeConnectionKey(runtime, piSessionId),
      close: () => {
        closed = true;
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        void Promise.resolve(Fiber.interrupt(watchdogFiber as never));
        coalescer.flushNow(sessionId);
        sub?.close();
      },
    };
  };

  return {
    bind: (next) => {
      binding = next;
    },
    unbind: () => {
      stopPoll();
      binding = null;
    },
    noteTurnAccepted: (sessionId) => {
      turnAcceptedAt.set(sessionId, Date.now());
      adoptCursor(sessionId, 0);
      // A new turn's authoritative bubble is its optimistic activeAssistantId;
      // discard any stale mid-stream redirect left over from a prior turn that
      // settled without an agent_end (e.g. idled by the runtime poll).
      streamContext.liveAssistantIds.delete(sessionId);
    },
    noteReplayHydrated: (sessionId, committedSeq) => adoptCursor(sessionId, committedSeq),
    reconcile: (sessions) => {
      const desired = new Map<
        SessionId,
        { runtimeSessionId: string; piSessionId: string | null; lastEventSeq: number | undefined }
      >();
      for (const session of sessions) {
        if (shouldSubscribeRuntimeEvents(session.status) && session.runtimeSessionId) {
          desired.set(session.id, {
            runtimeSessionId: session.runtimeSessionId,
            piSessionId: session.piSessionId ?? null,
            lastEventSeq: session.lastEventSeq,
          });
        }
      }

      for (const [sessionId, attachment] of [...attachments]) {
        const want = desired.get(sessionId);
        const key = want ? resumeConnectionKey(want.runtimeSessionId, want.piSessionId) : "";
        if (!want || attachment.key !== key) {
          attachment.close();
          attachments.delete(sessionId);
        }
      }

      for (const [sessionId, want] of desired) {
        if (attachments.has(sessionId)) continue;
        // Seed the gate from the persisted cursor when a session (re)enters
        // the live set — e.g. restored from storage as "running".
        cursors.set(sessionId, adoptExternalCursor(want.lastEventSeq));
        attachments.set(
          sessionId,
          openAttachment(sessionId, want.runtimeSessionId, want.piSessionId),
        );
      }
    },
    flush: (sessionId) => coalescer.flushNow(sessionId),
    subscribeActiveRuntimeIds: (listener) => {
      activeRuntimeListeners.add(listener);
      return () => activeRuntimeListeners.delete(listener);
    },
    getActiveRuntimeIds: () => activeRuntimeIds,
    getUnseenFinishedIds: () => unseenFinishedIds,
    markRuntimeSeen,
    pollNow: () => {
      stopPoll();
      if (!binding || binding.getSessions().length === 0) return;
      // One immediate reconcile, then a steady interval. setInterval (unlike
      // Effect.repeat) does not fire an extra immediate iteration, so pollNow
      // produces exactly one fetch up front, and the timer is drivable under a
      // test clock.
      void pollOnce();
      pollTimer = setInterval(() => void pollOnce(), pollIntervalMs);
    },
    closeAll: () => {
      stopPoll();
      for (const attachment of attachments.values()) attachment.close();
      attachments.clear();
      coalescer.flushAll();
    },
  };
}

let singleton: SessionRuntimeController | null = null;

/** Lazy app-wide controller instance (one per page lifetime). */
export function sessionRuntimeController(): SessionRuntimeController {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
