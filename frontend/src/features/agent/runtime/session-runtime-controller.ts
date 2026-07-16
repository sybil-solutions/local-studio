// THE single owner of live session event ordering AND of runtime-derived
// session status. This module — and only this module — opens runtime SSE
// subscriptions, tracks per-session event cursors, reconnects, flushes the
// text-delta coalescer, reduces runtime events into session state, and runs
// the runtime-list poll that arbitrates running/idle. React integrates
// through a thin binding (use-workspace-runtime-sync.ts); nothing else may
// subscribe to runtime events, gate event seqs, or settle a session's
// runtime status. (Turn-intent status — "starting", accept, abort — stays
// with prompt-stream/engine; hydration status with loadAndReplay.)

import { isAgentEndEvent } from "@shared/agent/pi-events";
import { drainQueueAfterAgentEnd, piSessionIdFromEvent } from "@/features/agent/messages";
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
import { publishRuntimeActivity } from "@/features/agent/session-index";
import { settleTurn } from "@/features/agent/runtime/session-status";

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
   * A `/turn` command was accepted. Pi's per-runtime event seq restarts ONLY
   * when the runtime itself restarts (piSessionId adoption on the second turn,
   * or a post-compaction/session swap) — `runtimeEventSeq` is the runtime's
   * current seq from the accept response. Rewind the gate to 0 only when that
   * seq sits below what we've already received (a genuine restart); otherwise
   * keep the cursor where it is. Rewinding on every steady-state turn would make
   * the next SSE reconnect re-apply the entire accumulated event log and
   * duplicate every prior turn — the 502-retry-storm message explosion.
   */
  noteTurnAccepted(sessionId: SessionId, assistantId?: string, runtimeEventSeq?: number): void;
  /**
   * loadAndReplay hydrated the transcript from canonical + runtime logs up to
   * `committedSeq` (undefined when the runtime is idle): reattach from there
   * so EventSource does not replay already-rendered content.
   */
  noteReplayHydrated(sessionId: SessionId, committedSeq: number | undefined): void;
  /** Apply any coalesced-but-unflushed deltas for a session right now. */
  flush(sessionId: SessionId): void;
  /**
   * Reconcile every session against the runtime list right now, then restart
   * the steady poll. Called by the React binding when poll-relevant session
   * identity (membership / pi id / status) changes.
   */
  pollNow(): void;
  /** Flush everything and close every SSE attachment (workspace unmount). */
  closeAll(): void;
  /**
   * The connection key a session is currently addressed by on the runtime API.
   * Normally the session's own runtime key; after a restart adoption it is the
   * controller-internal override recorded by the poll's pi-session match.
   */
  connectionKey(sessionId: SessionId): string;
  /**
   * Seed the connection-key override from a legacy persisted runtime id (a
   * pre-alias `rt-*` value read once from old localStorage state), so a session
   * that was RUNNING under that key across the upgrade reattaches to it.
   */
  seedConnectionKey(sessionId: SessionId, runtimeKey: string): void;
};

type Attachment = { key: string; close: () => void };

function resumeConnectionKey(connectionKey: string, piSessionId: string | null): string {
  return `${connectionKey}|${piSessionId ?? ""}`;
}

function patchRuntimeStatus(status: RuntimeStatus): Partial<Session> {
  return {
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
  };
}

function sameRuntimePatch(session: Session, patch: Partial<Session>, status: string): boolean {
  return (
    session.status === status &&
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
  // When the SSE delivered an authoritative `agent_end` for a session. The
  // server's runtime list drops the just-finished runtime lazily, so for a few
  // seconds after the turn ends the poll can still see it as active. Without a
  // guard the poll's active branch re-promotes the session to "running",
  // fighting the SSE's idle and oscillating status (visible flicker + SSE
  // reopen churn). This stamp lets the active branch honor the finish grace.
  const turnFinishedAt = new Map<SessionId, number>();
  // Ephemeral per-session connection-key overrides — reconnection plumbing, not
  // session state. Set when the poll's pi-session match finds this session's
  // runtime living under a DIFFERENT server key (a restart adoption, or a
  // legacy pre-alias `rt-*` key seeded across an upgrade); every runtime API
  // address for the session then uses the override instead of the session id.
  const connectionKeyOverrides = new Map<SessionId, string>();
  const connectionKeyFor = (session: Session): string =>
    connectionKeyOverrides.get(session.id) ?? session.id;

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
    event: Record<string, unknown>,
    seq?: number,
    decorate: (session: Session) => Session = (session) => session,
  ) => {
    commit(sessionId, (session) =>
      decorate(stampSeq(reduceSessionEvent(session, streamContext, event), seq)),
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
    event: Record<string, unknown>,
    seq: number | undefined,
  ) => {
    if (coalescer.enqueuePiEvent(sessionId, event, { seq })) return;
    // Non-delta events flush any pending merge first so ordering is preserved.
    coalescer.flushNow(sessionId);
    applyEvent(sessionId, event, seq);
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

    if (isAgentEndEvent(payload.event)) {
      // Record the authoritative end-of-turn so the runtime poll won't
      // resurrect "running" off a stale still-active list snapshot.
      turnFinishedAt.set(sessionId, Date.now());
      // Flush pending deltas first, then settle the turn in ONE commit:
      // finalize tool blocks, stamp the cursor, and clear the live status
      // together.
      coalescer.flushNow(sessionId);
      applyEvent(sessionId, payload.event, payload.seq, (session) => ({
        ...settleTurn(session),
        piSessionId: eventId || session.piSessionId,
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

    // Status-only commit: promote to running and adopt the pi session id. The
    // assistant bubble itself is resolved inside reduceSessionEvent when the
    // event's effects commit (targeting lives in the reducer now), so this
    // leaves activeAssistantId to the reducer.
    commit(sessionId, (session) =>
      session.status === "running" && (!eventId || session.piSessionId === eventId)
        ? session
        : {
            ...session,
            piSessionId: eventId || session.piSessionId,
            status: "running",
          },
    );
    enqueueEvent(sessionId, payload.event, payload.seq);
  };

  // True while a session sits in its post-`agent_end` grace: the SSE already
  // settled the turn to idle, but the server's runtime list can still report
  // the finished runtime as active for a beat. A newer accepted turn supersedes
  // the finish (genuine restart) and ends the grace early.
  const withinFinishGrace = (sessionId: SessionId, fetchStartedAt: number): boolean => {
    const finishedAt = turnFinishedAt.get(sessionId);
    if (finishedAt === undefined || fetchStartedAt - finishedAt >= pollIdleGraceMs) return false;
    const acceptedAt = turnAcceptedAt.get(sessionId);
    return acceptedAt === undefined || acceptedAt <= finishedAt;
  };

  // Restart adoption: the pi match found this session's runtime under a new
  // server key. Record the connection-key override (controller-internal —
  // reconnection plumbing, not session state), reset the cursor, and reopen an
  // existing attachment under the new key.
  const adoptConnectionKey = (
    session: Session,
    nextConnectionKey: string,
    piSessionId: string | null,
  ) => {
    // Adopting a different server key means the session is now served by a
    // fresh runtime whose event seq restarts from 0. The cursor is keyed by
    // the stable sessionId and still holds the OLD runtime's seq, so a
    // reconnect would resume "after <old seq>" and skip the new runtime's
    // early events. Reset it (as noteTurnAccepted does on a restart) before
    // the SSE reopens.
    adoptCursor(session.id, undefined);
    if (nextConnectionKey === session.id) {
      connectionKeyOverrides.delete(session.id);
    } else {
      connectionKeyOverrides.set(session.id, nextConnectionKey);
    }
    // The override is controller-internal — no session state changes, so the
    // React binding's reconcile will not fire. Reopen an existing attachment
    // under the new key ourselves; openAttachment connects from the
    // freshly-reset in-memory cursor. A session without an attachment
    // (idle -> running promotion) is picked up by the binding's reconcile
    // when the status commit lands.
    const attachment = attachments.get(session.id);
    if (attachment) {
      attachment.close();
      attachments.set(session.id, openAttachment(session.id, nextConnectionKey, piSessionId));
    }
  };

  // Reconcile the workspace sessions against one runtime-list snapshot. The
  // poll is the second leg of status arbitration next to the SSE attachments:
  // it promotes sessions whose runtime is active (including adopting a new
  // connection key via the pi-session match) and idles sessions the runtime
  // no longer reports as active.
  const applyRuntimeList = (runtimeSessions: RuntimeSessionSummary[], fetchStartedAt: number) => {
    const byRuntime = new Map(runtimeSessions.map((entry) => [entry.sessionId, entry.status]));
    const byPi = new Map(
      runtimeSessions
        .filter((entry) => entry.status.piSessionId)
        .map((entry) => [
          entry.status.piSessionId!,
          { serverKey: entry.sessionId, status: entry.status },
        ]),
    );
    const sessions = binding?.getSessions() ?? [];
    // A piSessionId held by 2+ open sessions (forked/duplicated tab, pref copy,
    // or the mid-turn adoption window before one settles) can't disambiguate
    // which session a runtime entry belongs to. Trusting the pi reverse-index
    // there would let ONE runtime entry promote/idle AND repoint every session
    // sharing the id — direct two-session crosstalk. Collect the collided ids so
    // we fall back to the unambiguous direct runtime match for them.
    const sharedPiIds = new Set<string>();
    const seenPiIds = new Set<string>();
    for (const session of sessions) {
      if (!session.piSessionId) continue;
      if (seenPiIds.has(session.piSessionId)) sharedPiIds.add(session.piSessionId);
      else seenPiIds.add(session.piSessionId);
    }
    for (const session of sessions.filter((entry) => entry.status !== "loading")) {
      const connectionKey = connectionKeyFor(session);
      const direct = byRuntime.get(connectionKey);
      const piMatch =
        session.piSessionId && !sharedPiIds.has(session.piSessionId)
          ? byPi.get(session.piSessionId)
          : undefined;
      const status = direct ?? piMatch?.status;
      if (!status) continue;
      if (status.active === true) {
        // Post-finish grace (symmetric to the idle branch's accept grace): the
        // SSE's `agent_end` is the authoritative end of a turn. For a few
        // seconds after it, the server's runtime list can still report the
        // just-finished runtime as active. Re-promoting to "running" off that
        // stale snapshot fights the SSE's idle and oscillates status —
        // flicker plus SSE reopen churn on every poll tick. Suppress the active
        // branch inside the grace window UNLESS a newer turn was accepted after
        // the finish (a genuine restart supersedes the finish and must recover).
        if (withinFinishGrace(session.id, fetchStartedAt)) continue;
        const patch = patchRuntimeStatus(status);
        const nextConnectionKey = piMatch?.serverKey ?? connectionKey;
        if (nextConnectionKey !== connectionKey) {
          adoptConnectionKey(
            session,
            nextConnectionKey,
            status.piSessionId ?? session.piSessionId ?? null,
          );
        }
        commit(session.id, (current) => {
          if (sameRuntimePatch(current, patch, "running")) return current;
          return {
            ...current,
            ...patch,
            status: "running",
          };
        });
      } else if (session.status === "running") {
        idleFromRuntimeList(session, status, fetchStartedAt);
      }
    }
  };

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
  const idleFromRuntimeList = (session: Session, status: RuntimeStatus, fetchStartedAt: number) => {
    const acceptedAt = turnAcceptedAt.get(session.id);
    if (acceptedAt !== undefined && fetchStartedAt - acceptedAt < pollIdleGraceMs) return;
    const patch = patchRuntimeStatus(status);
    commit(session.id, (current) => {
      if (current.status !== "running") return current;
      if (sameRuntimePatch(current, patch, "idle") && !current.activeAssistantId) {
        return current;
      }
      return { ...settleTurn(current), ...patch };
    });
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

  const pollOnce = () => {
    void Effect.runPromise(
      Effect.gen(function* () {
        const epoch = pollEpoch;
        const fetchStartedAt = Date.now();
        const entries = yield* Effect.tryPromise({
          try: () => api.listRuntimeSessions(),
          catch: (error) => error,
        });
        if (epoch !== pollEpoch || !binding) return;
        publishRuntimeActivity(entries);
        applyRuntimeList(entries, fetchStartedAt);
      }),
    );
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

    const cancelReconnect = () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnecting = false;
    };

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

    const reconcileLiveness = () => {
      void Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* Effect.tryPromise({
            try: () => api.loadRuntimeStatus(runtime, piSessionId),
            catch: () => null,
          });
          if (closed) return;
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
          // A reconnect armed by a prior onError must not fire connect() after
          // we've decided this runtime is idle — it would reopen an SSE against
          // a session we just idled.
          cancelReconnect();
          sub?.close();
          coalescer.flushNow(sessionId);
          commit(sessionId, (session) =>
            session.status === "running" || session.status === "starting"
              ? {
                  ...settleTurn(session),
                  contextUsage: runtimeContextUsage(status, session.contextUsage),
                }
              : session,
          );
        }),
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

    const watchdogFiber =
      idleReconnectMs > 0
        ? (Effect.runFork(
            Effect.sync(() => {
              if (closed || Date.now() - lastPayloadAt < idleReconnectMs) return;
              void reconcileLiveness();
            }).pipe(Effect.repeat(Schedule.spaced(idleReconnectMs))),
          ) as never)
        : null;

    return {
      key: resumeConnectionKey(runtime, piSessionId),
      close: () => {
        closed = true;
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        if (watchdogFiber) void Effect.runPromise(Fiber.interrupt(watchdogFiber));
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
    noteTurnAccepted: (sessionId, assistantId, runtimeEventSeq) => {
      turnAcceptedAt.set(sessionId, Date.now());
      // A new turn supersedes any prior finish; drop the stamp so its own
      // eventual end owns the next grace window.
      turnFinishedAt.delete(sessionId);
      // Rewind the gate to 0 only on a genuine runtime restart — when the
      // runtime's reported seq is now below what we've already received. On a
      // steady-state turn the seq keeps climbing, so an unconditional rewind
      // would make the next reconnect re-apply the whole accumulated log (the
      // 502-retry-storm duplication). A missing seq falls back to the old
      // always-rewind behavior to preserve the dropped-second-turn guarantee.
      const received = (cursors.get(sessionId) ?? adoptExternalCursor(undefined)).receivedSeq ?? 0;
      if (runtimeEventSeq === undefined || runtimeEventSeq < received) {
        adoptCursor(sessionId, 0);
      }
      // A new turn's authoritative bubble is its optimistic activeAssistantId;
      // discard any stale mid-stream redirect left over from a prior turn that
      // settled without an agent_end (e.g. idled by the runtime poll).
      if (assistantId) streamContext.liveAssistantIds.set(sessionId, assistantId);
      else streamContext.liveAssistantIds.delete(sessionId);
    },
    noteReplayHydrated: (sessionId, committedSeq) => {
      // Replay mints fresh ids for every message, so any in-flight live-target
      // pin now points at a bubble that no longer exists. Drop it or post-replay
      // events would land on a dead id (silently discarded) while the seq cursor
      // still advances — the reopen-mid-turn content-drop. The reducer's target
      // resolution then falls back to the rebuilt transcript's own bubble.
      streamContext.liveAssistantIds.delete(sessionId);
      adoptCursor(sessionId, committedSeq);
    },
    reconcile: (sessions) => {
      const desired = new Map<
        SessionId,
        { connectionKey: string; piSessionId: string | null; lastEventSeq: number | undefined }
      >();
      for (const session of sessions) {
        if (shouldSubscribeRuntimeEvents(session.status)) {
          desired.set(session.id, {
            connectionKey: connectionKeyFor(session),
            piSessionId: session.piSessionId ?? null,
            lastEventSeq: session.lastEventSeq,
          });
        }
      }

      for (const [sessionId, attachment] of [...attachments]) {
        const want = desired.get(sessionId);
        const key = want ? resumeConnectionKey(want.connectionKey, want.piSessionId) : "";
        if (!want || attachment.key !== key) {
          attachment.close();
          attachments.delete(sessionId);
        }
      }

      for (const [sessionId, want] of desired) {
        if (attachments.has(sessionId)) continue;
        // Seed the gate from the persisted cursor ONLY on a genuine first attach
        // (no live cursor yet) — e.g. a session restored from storage as
        // "running". When an attachment is torn down and reopened for an
        // already-live session — a mid-turn piSessionId adoption changes the
        // connection key, so reconcile closes the old SSE and opens a new one —
        // the in-memory cursor already holds the highest RECEIVED seq.
        // Overwriting it with the persisted lastEventSeq, which only tracks
        // COMMITTED seqs and therefore lags, would rewind the gate and make the
        // reopened SSE re-deliver the backlog (the first-turn duplication).
        const existing = cursors.get(sessionId);
        if (!existing || (want.lastEventSeq ?? 0) > (existing.receivedSeq ?? 0)) {
          cursors.set(sessionId, adoptExternalCursor(want.lastEventSeq));
        }
        attachments.set(sessionId, openAttachment(sessionId, want.connectionKey, want.piSessionId));
      }
    },
    flush: (sessionId) => coalescer.flushNow(sessionId),
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
      publishRuntimeActivity([]);
      for (const attachment of attachments.values()) attachment.close();
      attachments.clear();
      coalescer.clear();
      // Workspace teardown: drop every per-session map so the app-lifetime
      // singleton doesn't retain one entry per session ever opened. Also drops
      // every live-target pin so a remount can't inherit a stale id.
      cursors.clear();
      turnAcceptedAt.clear();
      turnFinishedAt.clear();
      connectionKeyOverrides.clear();
      streamContext.liveAssistantIds.clear();
    },
    connectionKey: (sessionId) => connectionKeyOverrides.get(sessionId) ?? sessionId,
    seedConnectionKey: (sessionId, runtimeKey) => {
      // One-shot legacy seed: never clobber an override the poll already owns.
      if (!runtimeKey || runtimeKey === sessionId) return;
      if (connectionKeyOverrides.has(sessionId)) return;
      connectionKeyOverrides.set(sessionId, runtimeKey);
    },
  };
}

let singleton: SessionRuntimeController | null = null;

/** Lazy app-wide controller instance (one per page lifetime). */
export function sessionRuntimeController(): SessionRuntimeController {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
