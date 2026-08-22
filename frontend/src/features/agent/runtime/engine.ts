import { useCallback, useMemo, useRef } from "react";
import { Effect } from "effect";
import {
  asRecord,
  finalizeRunningToolBlocks,
  replayCursorAfterRuntimeHydration,
  type ChatMessage,
  type RuntimeLoggedEvent,
} from "@/features/agent/messages";
import { foldSessionEvents } from "@/features/agent/runtime/pi-event-applier";
import {
  runtimeCanHydrateCanonicalSession,
  runtimeStatusAcceptsControl,
  settleTurnFinalizingTools,
} from "@/features/agent/runtime/session-status";
import {
  selectedContextPrompt,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { Session, SessionId, UpdateSession } from "@/features/agent/runtime/types";
import type { BrowserBackend, ToolSelection } from "@/features/agent/tools/types";
import type {
  AgentQueueAction,
  AgentThinkingLevel,
  AgentToolAccess,
} from "@/features/agent/contracts";
import * as api from "@/features/agent/runtime/api";
import {
  applyTurnAccepted,
  submitPromptTurn,
  type SubmitArgs,
} from "@/features/agent/runtime/prompt-stream";
import { readTranscriptSnapshot } from "@/features/agent/workspace/transcript-cache";

import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";

const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];
const inFlightReplays = new Set<SessionId>();

export type UseSessionEngineDeps = {
  /** Latest `tabs` snapshot — engine reads via a ref so it doesn't restart on every frame. */
  tabs: Session[];
  activeTabId: SessionId;
  modelId: string;
  thinkingLevel: AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  cwd: string;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onPiSessionIdChange?: (piSessionId: string) => void;
  /** Mutate a single session record. */
  updateSession: UpdateSession;
  /** Look up the per-session tool selection from the tools subsystem. */
  selectionFor: (sessionId: SessionId) => ToolSelection;
};

export type SessionEngine = {
  /** Send a freshly-typed prompt — orchestrates optimistic update + streaming. */
  submitPrompt: (args: SubmitArgs) => Promise<void>;
  /** Send a steer/follow-up control message while a turn is in progress. */
  sendControl: (request: AgentControlRequest) => Promise<{ ok: boolean; error?: string }>;
  loadRuntimeStatus: (
    runtime: string,
    piSessionId?: string | null,
  ) => Promise<api.RuntimeStatus | null>;
  abortTurn: (sessionId: SessionId) => Promise<api.AbortSessionResult>;
  loadAndReplay: (piSessionId: string, sessionId: SessionId) => Promise<void>;
  /** Fetch and prepend the previous page of older history (tail paging). */
  loadEarlier: (sessionId: SessionId) => Promise<void>;
  compact: (sessionId: SessionId) => Promise<void>;
  /** Probe whether the session's live runtime accepts steer/follow-up right
   * now: running/starting locally, and the runtime's reported pi session (if
   * any) matches ours. A failed probe counts as accepting — the turn API
   * itself is the authority and will reject if not. */
  acceptsControl: (
    tab: { status: Session["status"]; piSessionId?: string | null },
    runtime: string,
  ) => Promise<boolean>;
};

export type AgentControlRequest = {
  mode: "steer" | "follow_up";
  text: string;
  runtime: string;
  sessionId: SessionId;
  piSessionId?: string | null;
  queueAction?: AgentQueueAction;
  queueReplacement?: string;
};

export function useSessionEngine(deps: UseSessionEngineDeps): SessionEngine {
  const {
    tabs,
    activeTabId,
    modelId,
    thinkingLevel,
    toolAccess,
    cwd,
    browserToolEnabled,
    browserBackend,
    onPiSessionIdChange,
    updateSession,
    selectionFor,
  } = deps;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectionForRef = useRef(selectionFor);
  selectionForRef.current = selectionFor;
  // Sessions with an in-flight "load earlier" page, so a double click / repeated
  // scroll doesn't fetch and prepend the same chunk twice.
  const loadingEarlierRef = useRef<Set<SessionId>>(new Set());

  const loadRuntimeStatusCb = useCallback(api.loadRuntimeStatus, []);

  const sendControl = useCallback(
    (request: AgentControlRequest): Promise<{ ok: boolean; error?: string }> => {
      const { mode, text, runtime, sessionId, piSessionId, queueAction, queueReplacement } =
        request;
      if (!text.trim() || !modelId) return Promise.resolve({ ok: false });
      return Effect.runPromise(
        Effect.gen(function* () {
          const selection = selectionForRef.current(sessionId);
          const skills = selection.skills ?? EMPTY_SKILLS;
          const promptTemplates = selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;
          const browserEnabledForTurn = browserToolEnabled;
          const message = selectedContextPrompt(text, skills);
          const contextualQueueReplacement = queueReplacement
            ? selectedContextPrompt(queueReplacement, skills)
            : undefined;
          const result = yield* Effect.tryPromise({
            try: () =>
              api.submitTurnCommand({
                sessionId: runtime,
                modelId,
                thinkingLevel,
                toolAccess,
                message,
                cwd: cwd.trim() || undefined,
                piSessionId,
                mode,
                queueAction,
                queueReplacement: contextualQueueReplacement,
                browserToolEnabled: browserEnabledForTurn,
                browserSessionId: runtime,
                browserBackend,
                skills,
                promptTemplates,
              }),
            catch: (error) => error,
          });
          applyTurnAccepted({ updateSession, onPiSessionIdChange }, sessionId, result);
          return { ok: true };
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              ok: false,
              error: error instanceof Error ? error.message : "Message failed",
            }),
          ),
        ),
      );
    },
    [
      browserToolEnabled,
      browserBackend,
      cwd,
      modelId,
      thinkingLevel,
      toolAccess,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  const submitPrompt = useCallback(
    (args: SubmitArgs) =>
      submitPromptTurn(
        {
          activeTabId,
          browserToolEnabled,
          browserBackend,
          cwd,
          modelId,
          thinkingLevel,
          toolAccess,
          onPiSessionIdChange,
          selectionFor: selectionForRef.current,
          tabsRef,
          updateSession,
        },
        args,
      ),
    [
      activeTabId,
      modelId,
      thinkingLevel,
      toolAccess,
      cwd,
      browserToolEnabled,
      browserBackend,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  const abortTurn = useCallback(
    (sessionId: SessionId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          // Abort by the CONNECTION key (override-aware): after a server
          // restart the session's runtime lives under a different server key,
          // and /abort has no piSessionId fallback lookup.
          const runtime = sessionRuntimeController().connectionKey(sessionId);
          updateSession(sessionId, (session) => ({ ...session, status: "stopping" }));
          const cleared = yield* Effect.tryPromise({
            try: () => api.abortSession(runtime),
            catch: (error) => error,
          });
          // Settle the session fully. A direct status write bypasses the reducer
          // that normally finalizes tool badges on agent_end, and idling the
          // session detaches the SSE — so if the runtime's terminal event never
          // lands, any in-flight tool would render a perpetual "running" badge
          // and activeAssistantId would linger. Flush pending deltas first so the
          // last streamed text is committed before we finalize.
          sessionRuntimeController().flush(sessionId);
          updateSession(sessionId, settleTurnFinalizingTools);
          return cleared;
        }),
      ),
    [updateSession],
  );

  const loadAndReplay = useCallback(
    (piSessionId: string, sessionId: SessionId) => {
      if (inFlightReplays.has(sessionId)) return Promise.resolve();
      inFlightReplays.add(sessionId);
      return Effect.runPromise(
        Effect.gen(function* () {
          const cachedMessages = readTranscriptSnapshot(piSessionId);
          const seedCached = (session: Session) =>
            session.messages.length === 0 && cachedMessages
              ? { ...session, messages: cachedMessages }
              : session;
          if (!cwd) {
            updateSession(sessionId, (session) =>
              seedCached(session.status === "loading" ? { ...session, status: "idle" } : session),
            );
            return;
          }
          updateSession(sessionId, (session) => ({
            ...seedCached(session),
            status: "loading",
            error: "",
          }));
          // Canonical replay and the runtime-status probe are independent — the
          // status key is derived synchronously — so run them concurrently
          // instead of blocking the (now tail-limited) canonical read on the
          // status round-trip.
          const runtimeId = sessionRuntimeController().connectionKey(sessionId);
          const [replayResult, runtimeStatus] = yield* Effect.all(
            [
              Effect.tryPromise({
                try: () => api.loadCanonicalSession(piSessionId, cwd),
                catch: (error) => error,
              }).pipe(Effect.result),
              Effect.tryPromise({
                try: () => api.loadRuntimeStatus(runtimeId, piSessionId),
                catch: () => null,
              }),
            ],
            { concurrency: "unbounded" },
          );
          if (replayResult._tag === "Success") {
            const { events, cursor, meta } = replayResult.success;
            const runtimeActive = runtimeCanHydrateCanonicalSession(runtimeStatus, piSessionId);
            const replayEvents = mergeCanonicalAndRuntimeEvents(
              events,
              runtimeActive ? runtimeStatus?.events : [],
            );
            const {
              messages,
              title,
              startedAt,
              modelId: replayModelId,
              tokenStats,
            } = foldSessionEvents(replayEvents);
            const replaySeq = replayCursorAfterRuntimeHydration(runtimeStatus, piSessionId);
            updateSession(sessionId, (session) => ({
              ...session,
              messages: reconcileReplayMessages(session.messages, messages),
              piSessionId,
              cwd: session.cwd || cwd,
              // Head-scan meta carries the real session model/title; the fold's
              // own title would be the tail slice's first user message, not the
              // session's first prompt.
              modelId:
                session.modelId ||
                meta?.modelId ||
                replayModelId ||
                runtimeStatus?.modelId ||
                modelId,
              title: meta?.title ?? title ?? session.title,
              startedAt: meta?.startedAt ?? startedAt ?? session.startedAt,
              tokenStats: tokenStats ?? undefined,
              // Lifetime spend is computed server-side from the whole rollout,
              // so it survives both compaction and the tail load's cutoff.
              usageTotals: meta?.usage ?? session.usageTotals,
              contextUsage: api.runtimeContextUsage(runtimeStatus, session.contextUsage),
              status: runtimeActive ? "running" : "idle",
              activeAssistantId: undefined,
              // A non-null cursor means the tail load left older history unread;
              // the timeline shows a "Load earlier" affordance while it is set.
              historyCursor: messages.length > 0 ? cursor : (session.historyCursor ?? null),
              // The replay has landed, so whatever came from the snapshot has
              // been superseded and must not keep asking to be replayed.
              hydratedFromCache: false,
              error: "",
            }));
            // Reattach the live stream from the hydrated cursor so EventSource
            // does not replay already-rendered content.
            sessionRuntimeController().noteReplayHydrated(sessionId, replaySeq);
          } else {
            const err = replayResult.failure;
            // Canonical read failed. If the runtime is still alive, don't strand the
            // session idle (which would drop the live stream — reconcile only
            // subscribes for live statuses): keep the seeded history, mark it running,
            // and reset the cursor so the reattached SSE replays the runtime backlog.
            if (runtimeCanHydrateCanonicalSession(runtimeStatus, piSessionId)) {
              updateSession(sessionId, (session) => ({
                ...session,
                contextUsage: api.runtimeContextUsage(runtimeStatus, session.contextUsage),
                status: "running",
                activeAssistantId: undefined,
                error: "",
              }));
              sessionRuntimeController().noteReplayHydrated(sessionId, undefined);
              return;
            }
            updateSession(sessionId, (session) => ({
              ...session,
              error: err instanceof Error ? err.message : "Failed to load session",
              status: "idle",
            }));
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              inFlightReplays.delete(sessionId);
            }),
          ),
        ),
      );
    },
    [cwd, modelId, updateSession],
  );

  // Page the previous (older) chunk of a tail-loaded transcript into view and
  // prepend it. Each page is snapped to a user-turn boundary and abuts the
  // current first message exactly (cursor = first loaded byte), so folding the
  // page on its own and prepending is equivalent to a single larger fold.
  const loadEarlier = useCallback(
    (sessionId: SessionId): Promise<void> => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const cursor = session?.historyCursor;
      if (!session || !session.piSessionId || !cwd || cursor == null) return Promise.resolve();
      if (loadingEarlierRef.current.has(sessionId)) return Promise.resolve();
      loadingEarlierRef.current.add(sessionId);
      const piSessionId = session.piSessionId;
      return Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => api.loadCanonicalSession(piSessionId, cwd, { before: cursor }),
            catch: (error) => error,
          }).pipe(Effect.result);
          if (result._tag !== "Success") return;
          const { messages: earlier } = foldSessionEvents(result.success.events);
          updateSession(sessionId, (current) => ({
            ...current,
            messages: earlier.length > 0 ? [...earlier, ...current.messages] : current.messages,
            historyCursor: result.success.cursor,
          }));
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              loadingEarlierRef.current.delete(sessionId);
            }),
          ),
        ),
      );
    },
    [cwd, updateSession],
  );

  const compact = useCallback(
    (sessionId: SessionId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const session = tabsRef.current.find((tab) => tab.id === sessionId);
          if (!session || !modelId) return;
          updateSession(sessionId, (s) => ({ ...s, error: "" }));
          const result = yield* Effect.tryPromise({
            try: () =>
              api.compactSession({
                sessionId: session.id,
                modelId,
                thinkingLevel,
                toolAccess,
                cwd: cwd.trim() || undefined,
                piSessionId: session.piSessionId,
                browserToolEnabled,
                browserSessionId: session.id,
                browserBackend,
                skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
                promptTemplates:
                  selectionForRef.current(sessionId).promptTemplates ?? EMPTY_PROMPT_TEMPLATES,
              }),
            catch: (error) => error,
          });
          const nextSessionId = result.status?.piSessionId || session.piSessionId;
          if (nextSessionId) {
            yield* Effect.tryPromise({
              try: () => loadAndReplay(nextSessionId, sessionId),
              catch: (error) => error,
            });
          }
          updateSession(sessionId, (s) => ({
            ...s,
            contextUsage: api.runtimeContextUsage(result.status ?? null, null),
            tokenStats: undefined,
          }));
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              updateSession(sessionId, (s) => ({
                ...s,
                error: error instanceof Error ? error.message : "Compaction failed",
              }));
            }),
          ),
        ),
      ),
    [browserToolEnabled, browserBackend, cwd, loadAndReplay, modelId, thinkingLevel, updateSession],
  );

  const acceptsControl = useCallback(
    async (
      tab: { status: Session["status"]; piSessionId?: string | null },
      runtime: string,
    ): Promise<boolean> => {
      // "stopping" counts: the composer still draws itself as running there, and
      // a turn being torn down can still take a follow-up for the next one.
      if (tab.status !== "running" && tab.status !== "starting" && tab.status !== "stopping") {
        return false;
      }
      const status = await loadRuntimeStatusCb(runtime, tab.piSessionId).catch(() => null);
      return runtimeStatusAcceptsControl(status, tab.piSessionId);
    },
    [loadRuntimeStatusCb],
  );

  return useMemo<SessionEngine>(
    () => ({
      submitPrompt,
      sendControl,
      loadRuntimeStatus: loadRuntimeStatusCb,
      abortTurn,
      loadAndReplay,
      loadEarlier,
      compact,
      acceptsControl,
    }),
    [
      submitPrompt,
      sendControl,
      loadRuntimeStatusCb,
      abortTurn,
      loadAndReplay,
      loadEarlier,
      compact,
      acceptsControl,
    ],
  );
}

function eventKey(event: Record<string, unknown>): string {
  try {
    return JSON.stringify(event);
  } catch {
    return `${String(event.type ?? "event")}:${Object.keys(event).join(",")}`;
  }
}

function messageFingerprint(event: Record<string, unknown>): string | null {
  const message = asRecord(event.message);
  if (!message || typeof message.role !== "string") return null;
  return eventKey(message);
}

function canonicalEventsBeforeRuntimeTail(
  canonicalEvents: Record<string, unknown>[],
  runtime: Record<string, unknown>[],
): Record<string, unknown>[] {
  const canonicalMessages = canonicalEvents.flatMap((event, eventIndex) => {
    const fingerprint = messageFingerprint(event);
    return fingerprint ? [{ eventIndex, fingerprint }] : [];
  });
  const runtimeMessages = runtime.flatMap((event) => {
    if (event.type !== "message" && event.type !== "message_end") return [];
    const fingerprint = messageFingerprint(event);
    return fingerprint ? [fingerprint] : [];
  });
  const firstRuntimeMessage = runtimeMessages[0];
  if (!firstRuntimeMessage) return canonicalEvents;
  let best: { eventIndex: number; score: number } | null = null;
  for (let index = 0; index < canonicalMessages.length; index += 1) {
    if (canonicalMessages[index]?.fingerprint !== firstRuntimeMessage) continue;
    let score = 0;
    while (
      canonicalMessages[index + score]?.fingerprint === runtimeMessages[score] &&
      runtimeMessages[score]
    ) {
      score += 1;
    }
    const candidate = { eventIndex: canonicalMessages[index]?.eventIndex ?? 0, score };
    if (!best || candidate.score >= best.score) best = candidate;
  }
  if (best) {
    return canonicalEvents.slice(0, best.eventIndex);
  }
  return canonicalEvents;
}

function runtimeEventsInOrder(
  runtimeEvents: readonly RuntimeLoggedEvent[],
): Record<string, unknown>[] {
  return [...runtimeEvents]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .flatMap((entry) => {
      if (entry.event && typeof entry.event === "object") {
        return [entry.event];
      }
      return [];
    });
}

function dedupeAdjacentEvents(events: Record<string, unknown>[]): Record<string, unknown>[] {
  let previous = "";
  return events.filter((event) => {
    const key = eventKey(event);
    if (key === previous) return false;
    previous = key;
    return true;
  });
}

function mergeCanonicalAndRuntimeEvents(
  canonicalEvents: Record<string, unknown>[],
  runtimeEvents: readonly RuntimeLoggedEvent[] = [],
): Record<string, unknown>[] {
  const runtime = runtimeEventsInOrder(runtimeEvents);
  return dedupeAdjacentEvents([
    ...canonicalEventsBeforeRuntimeTail(canonicalEvents, runtime),
    ...runtime,
  ]);
}

function reconcileReplayMessages(
  current: ChatMessage[],
  canonical: ChatMessage[],
): ChatMessage[] {
  if (canonical.length === 0) return current;
  if (canonical.length >= current.length) return canonical;
  return current;
}
