import { useCallback, useMemo, useRef } from "react";
import {
  useSessionEngineBatchCleanupEffect,
  useSessionEnginePromptStreamCleanupEffect,
  useSessionEngineRuntimeResumeEffect,
  useSessionEngineTextDeltaCleanupEffect,
} from "@/hooks/agent/use-session-engine-effects";
import { isAgentEndEvent } from "@/lib/agent/pi-events";
import {
  type ChatMessage,
  type ChatMessageAttachment,
  mergeCanonicalAndRuntimeEvents,
  newId,
  nowLabel,
  piSessionIdFromEvent,
  replayCursorAfterRuntimeHydration,
  replaySessionEvents,
  runtimeStatusAcceptsControl,
  sessionTitleFromPrompt,
  statusAfterControlPhase,
  type TokenStats,
  usageFromEvent,
} from "@/lib/agent/session";
import {
  activeComposerPlugins,
  selectedContextPrompt,
  type ComposerExtensionOverride,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import { promptRequestsBrowser } from "@/lib/agent/browser/intent";
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type { Session, SessionId, SessionStatus } from "@/lib/agent/sessions/types";
import type { ToolSelection } from "@/lib/agent/tools/types";
import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import * as api from "./api";
import {
  resolveResumeRuntimeTarget,
  resolveRuntimeSessionId,
  runtimeCanHydrateCanonicalSession,
  runtimeIsActiveForPiSession,
} from "./engine-helpers";
import { applyPiEventToSession } from "./pi-event-applier";
import { drainQueuedTurnAfterAgentEnd } from "./queue-drain";
import { claimRuntimePromptStream, releaseRuntimePromptStream } from "./stream-ownership";
import { createTextDeltaCoalescer, type TextDeltaCoalescer } from "./text-delta-coalescer";

const EMPTY_PLUGINS: ComposerPluginRef[] = [];
const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];
const EMPTY_EXTENSION_OVERRIDES: ComposerExtensionOverride[] = [];

function mergeSkills(
  existing: ComposerSkillRef[] | undefined,
  next: ComposerSkillRef[],
): ComposerSkillRef[] | undefined {
  if (!existing?.length && next.length === 0) return existing;
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of existing ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  for (const skill of next) byId.set(skill.id || skill.path || skill.name, skill);
  return [...byId.values()];
}

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  images?: AgentImageInput[];
  attachments?: ChatMessageAttachment[];
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  extensionOverrides?: ComposerExtensionOverride[];
  targetSessionId?: SessionId;
};

export type UseSessionEngineDeps = {
  /** Latest `tabs` snapshot — engine reads via a ref so it doesn't restart on every frame. */
  tabs: Session[];
  activeTabId: SessionId;
  /** Runtime session id used when a session doesn't carry its own. */
  runtimeSessionId: string;
  modelId: string;
  cwd: string;
  browserToolEnabled: boolean;
  canvasEnabled: boolean;
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
  sendControl: (
    mode: "steer" | "follow_up",
    text: string,
    runtime: string,
    sessionId: SessionId,
    piSessionId?: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  loadRuntimeStatus: (runtime: string) => Promise<api.RuntimeStatus | null>;
  abortTurn: (sessionId: SessionId) => Promise<void>;
  loadAndReplay: (piSessionId: string, sessionId: SessionId) => Promise<void>;
  compact: (sessionId: SessionId) => Promise<void>;
  /** Helpers exposed for the composer's send/queue logic. */
  acceptsControl: typeof runtimeStatusAcceptsControl;
};

export function useSessionEngine(deps: UseSessionEngineDeps): SessionEngine {
  const {
    tabs,
    activeTabId,
    runtimeSessionId,
    modelId,
    cwd,
    browserToolEnabled,
    canvasEnabled,
    onPiSessionIdChange,
    updateSession,
    selectionFor,
  } = deps;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectionForRef = useRef(selectionFor);
  selectionForRef.current = selectionFor;

  // Tracks which sessions own their stream right now (we own = don't double-
  // subscribe via the resume-runtime SSE). Keyed by session id.
  const localStreamRef = useRef<Set<SessionId>>(new Set());
  // The "live" assistant message id we're currently appending to, per session.
  // Pi can split a single user turn across multiple assistant messages (after
  // a queue_update / message_start), and we need a stable id to patch.
  const liveAssistantIdsRef = useRef<Map<SessionId, string>>(new Map());
  const piEventBatchesRef = useRef<
    Map<
      SessionId,
      {
        assistantId: string;
        events: Record<string, unknown>[];
        timer: ReturnType<typeof setTimeout> | null;
      }
    >
  >(new Map());
  const promptStreamControllersRef = useRef<Map<string, AbortController>>(new Map());

  const patchAssistant = useCallback(
    (sessionId: SessionId, assistantId: string, patch: (msg: ChatMessage) => ChatMessage) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((m) => (m.id === assistantId ? patch(m) : m)),
      }));
    },
    [updateSession],
  );

  // Apply a single pi event to a session through a deep Module that owns Pi
  // event routing while the hook owns React lifecycle and runtime streams.
  const applyPiEvent = useCallback(
    (sessionId: SessionId, assistantId: string, event: Record<string, unknown>) => {
      applyPiEventToSession(
        { liveAssistantIdsRef, patchAssistant, tabsRef, updateSession },
        sessionId,
        assistantId,
        event,
      );
    },
    [patchAssistant, updateSession],
  );
  const applyPiEventRef = useRef(applyPiEvent);
  applyPiEventRef.current = applyPiEvent;
  const textDeltaCoalescerRef = useRef<TextDeltaCoalescer | null>(null);
  if (!textDeltaCoalescerRef.current) {
    textDeltaCoalescerRef.current = createTextDeltaCoalescer({
      applyPiEvent: (sessionId, assistantId, event) => {
        applyPiEventRef.current(sessionId, assistantId, event);
      },
    });
  }

  useSessionEngineTextDeltaCleanupEffect({ textDeltaCoalescerRef });

  const flushPiEventBatch = useCallback(
    (sessionId: SessionId) => {
      textDeltaCoalescerRef.current?.flushNow(sessionId);
      const batch = piEventBatchesRef.current.get(sessionId);
      if (!batch) return;
      if (batch.timer) clearTimeout(batch.timer);
      piEventBatchesRef.current.delete(sessionId);
      for (const event of batch.events) {
        applyPiEvent(sessionId, batch.assistantId, event);
      }
    },
    [applyPiEvent],
  );

  const enqueuePiEvent = useCallback(
    (
      sessionId: SessionId,
      assistantId: string,
      event: Record<string, unknown>,
      options: { flushNow?: boolean } = {},
    ) => {
      if (textDeltaCoalescerRef.current?.enqueuePiEvent(sessionId, assistantId, event, options)) {
        return;
      }
      textDeltaCoalescerRef.current?.flushNow(sessionId);
      if (options.flushNow) flushPiEventBatch(sessionId);
      applyPiEvent(sessionId, assistantId, event);
    },
    [applyPiEvent, flushPiEventBatch],
  );

  useSessionEngineBatchCleanupEffect({ piEventBatchesRef });
  useSessionEnginePromptStreamCleanupEffect({ promptStreamControllersRef });

  const loadRuntimeStatusCb = useCallback(api.loadRuntimeStatus, []);

  const shouldApplyRuntimeSeq = useCallback(
    (sessionId: SessionId, seq?: number): boolean => {
      if (typeof seq !== "number") return true;
      let shouldApply = true;
      updateSession(sessionId, (session) => {
        if (typeof session.lastEventSeq === "number" && seq <= session.lastEventSeq) {
          shouldApply = false;
          return session;
        }
        return { ...session, lastEventSeq: seq };
      });
      return shouldApply;
    },
    [updateSession],
  );

  const sendControl = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      runtime: string,
      sessionId: SessionId,
      piSessionId?: string | null,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!text.trim() || !modelId) return { ok: false };
      const selection = selectionForRef.current(sessionId);
      const plugins = activeComposerPlugins(selection.plugins ?? EMPTY_PLUGINS);
      const skills = selection.skills ?? EMPTY_SKILLS;
      const promptTemplates = selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;
      const extensionOverrides = selection.extensionOverrides ?? EMPTY_EXTENSION_OVERRIDES;
      const browserEnabledForTurn = browserToolEnabled || promptRequestsBrowser(text);
      const message = selectedContextPrompt(text, plugins, skills);
      const ensureAssistantId = () => {
        const current = tabsRef.current.find((tab) => tab.id === sessionId);
        const existing =
          (current?.activeAssistantId &&
            current.messages.some((entry) => entry.id === current.activeAssistantId) &&
            current.activeAssistantId) ||
          [...(current?.messages ?? [])].reverse().find((entry) => entry.role === "assistant")?.id;
        if (existing) return existing;
        const assistantId = newId("assistant");
        updateSession(sessionId, (session) => ({
          ...session,
          activeAssistantId: assistantId,
          messages: [
            ...session.messages,
            { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
          ],
        }));
        return assistantId;
      };
      try {
        let controlError = "";
        let queuedControlAccepted = false;
        const controller = new AbortController();
        await api.submitTurnStream(
          {
            sessionId: runtime,
            modelId,
            message,
            cwd: cwd.trim() || undefined,
            piSessionId,
            mode,
            browserToolEnabled: browserEnabledForTurn,
            browserSessionId: runtime,
            canvasEnabled,
            plugins: plugins as ComposerPluginRef[],
            skills,
            promptTemplates,
            extensionOverrides,
          },
          (payload) => {
            if (controller.signal.aborted) return;
            if (payload.type === "error") controlError = payload.error;
            if (payload.type === "status") {
              if (payload.phase === "queued") queuedControlAccepted = true;
              updateSession(sessionId, (session) => ({
                ...session,
                piSessionId: payload.piSessionId || session.piSessionId,
                status: statusAfterControlPhase(session.status, payload.phase, {
                  queuedControlAccepted,
                }),
              }));
            }
            if (payload.type === "pi") {
              if (!shouldApplyRuntimeSeq(sessionId, payload.seq)) return;
              const eventId = piSessionIdFromEvent(payload.event);
              const assistantId = ensureAssistantId();
              const agentEnded = isAgentEndEvent(payload.event);
              updateSession(sessionId, (session) => ({
                ...session,
                piSessionId: eventId || session.piSessionId,
                status: agentEnded ? "idle" : session.status,
                activeAssistantId: agentEnded ? undefined : assistantId,
              }));
              if (eventId) onPiSessionIdChange?.(eventId);
              enqueuePiEvent(sessionId, assistantId, payload.event, { flushNow: agentEnded });
            }
          },
          { signal: controller.signal },
        );
        if (controlError) throw new Error(controlError);
        return { ok: true };
      } catch (error) {
        flushPiEventBatch(sessionId);
        return { ok: false, error: error instanceof Error ? error.message : "Message failed" };
      }
    },
    [
      browserToolEnabled,
      canvasEnabled,
      cwd,
      enqueuePiEvent,
      flushPiEventBatch,
      modelId,
      onPiSessionIdChange,
      shouldApplyRuntimeSeq,
      updateSession,
    ],
  );

  // Stable ref for the queue-drain self-call from inside submitPrompt and the
  // resume-runtime SSE handler.
  const submitPromptRef = useRef<(args: SubmitArgs) => Promise<void>>(() => Promise.resolve());

  const submitPrompt = useCallback(
    async (args: SubmitArgs) => {
      const sessionId = args.targetSessionId ?? activeTabId;
      const selected = tabsRef.current.find((tab) => tab.id === sessionId);
      if (!selected || !modelId) return;

      const userId = newId("user");
      const assistantId = newId("assistant");
      const runtime = selected.runtimeSessionId || runtimeSessionId;
      const browserEnabledForTurn = browserToolEnabled || promptRequestsBrowser(args.userText);
      const selection = selectionForRef.current(sessionId);
      const plugins = args.plugins ?? activeComposerPlugins(selection.plugins ?? EMPTY_PLUGINS);
      const skills = args.skills ?? selection.skills ?? EMPTY_SKILLS;
      const promptTemplates =
        args.promptTemplates ?? selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;
      const extensionOverrides =
        args.extensionOverrides ?? selection.extensionOverrides ?? EMPTY_EXTENSION_OVERRIDES;

      // Optimistic: push a user message + a blank assistant placeholder so the
      // UI shows "we received it" even before the first SSE chunk lands.
      updateSession(sessionId, (session) => ({
        ...session,
        cwd: session.cwd || cwd,
        modelId: session.modelId || modelId,
        startedAt: session.startedAt ?? new Date().toISOString(),
        input: "",
        error: "",
        status: "starting",
        usedSkills: mergeSkills(session.usedSkills, skills),
        activeAssistantId: assistantId,
        title:
          session.messages.filter((m) => m.role === "user").length === 0
            ? sessionTitleFromPrompt(args.userText)
            : session.title,
        messages: [
          ...session.messages,
          {
            id: userId,
            role: "user",
            text: args.displayText,
            attachments: args.attachments,
            skills,
            timestamp: nowLabel(),
          },
          { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
        ],
      }));

      let agentEnded = false;
      let streamError = "";
      const controller = new AbortController();
      const streamOwnerId = `${sessionId}:${assistantId}`;
      liveAssistantIdsRef.current.set(sessionId, assistantId);
      localStreamRef.current.add(sessionId);
      promptStreamControllersRef.current.set(runtime, controller);
      claimRuntimePromptStream(runtime, streamOwnerId, controller);
      try {
        await api.submitTurnStream(
          {
            sessionId: runtime,
            modelId,
            message: args.prompt,
            images: args.images,
            cwd: cwd.trim() || undefined,
            piSessionId:
              tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
              selected.piSessionId,
            browserToolEnabled: browserEnabledForTurn,
            browserSessionId: runtime,
            canvasEnabled,
            plugins: plugins as ComposerPluginRef[],
            skills,
            promptTemplates,
            extensionOverrides,
          },
          (payload) => {
            if (controller.signal.aborted) return;
            if (payload.type === "status") {
              const phase = payload.phase;
              updateSession(sessionId, (session) => ({
                ...session,
                piSessionId: payload.piSessionId || session.piSessionId,
                status: (phase === "done" ? "idle" : phase) as SessionStatus,
                activeAssistantId: phase === "done" ? undefined : session.activeAssistantId,
              }));
              if (payload.piSessionId) onPiSessionIdChange?.(payload.piSessionId);
            } else if (payload.type === "error") {
              streamError = payload.error;
              flushPiEventBatch(sessionId);
              updateSession(sessionId, (session) => ({
                ...session,
                error: payload.error,
                status: "idle",
              }));
            } else if (payload.type === "pi") {
              if (!shouldApplyRuntimeSeq(sessionId, payload.seq)) return;
              const piEvent = payload.event;
              traceAgentReasoning("engine.pi", {
                sessionId,
                assistantId,
                seq: payload.seq,
                event: piEvent,
              });
              const eventId = piSessionIdFromEvent(piEvent);
              if (eventId) {
                updateSession(sessionId, (session) => ({ ...session, piSessionId: eventId }));
                onPiSessionIdChange?.(eventId);
              }
              if (isAgentEndEvent(piEvent)) {
                agentEnded = true;
                const latestPiSessionId =
                  eventId ??
                  tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
                  selected.piSessionId ??
                  "";
                onPiSessionIdChange?.(latestPiSessionId);
              }
              enqueuePiEvent(sessionId, assistantId, piEvent, { flushNow: agentEnded });
            }
          },
          { signal: controller.signal },
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          streamError = err instanceof Error ? err.message : "Agent request failed";
        }
      } finally {
        flushPiEventBatch(sessionId);
        localStreamRef.current.delete(sessionId);
        promptStreamControllersRef.current.delete(runtime);
        releaseRuntimePromptStream(runtime, streamOwnerId);
        liveAssistantIdsRef.current.delete(sessionId);
        const currentPiSessionId =
          tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
          selected.piSessionId ??
          null;
        const runtimeStatus = await api.loadRuntimeStatus(runtime, currentPiSessionId);
        const runtimeStillActive =
          !agentEnded && runtimeIsActiveForPiSession(runtimeStatus, currentPiSessionId);
        updateSession(sessionId, (session) => ({
          ...session,
          status: runtimeStillActive ? "running" : "idle",
          activeAssistantId: runtimeStillActive ? assistantId : undefined,
          error: streamError && !runtimeStillActive ? streamError : session.error,
          contextUsage: runtimeStatus?.contextUsage ?? session.contextUsage ?? null,
        }));
      }

      // Drain the per-session queue once the agent finished its turn.
      if (agentEnded) {
        drainQueuedTurnAfterAgentEnd({ submitPromptRef, tabsRef, updateSession }, sessionId);
      }
    },
    [
      activeTabId,
      modelId,
      runtimeSessionId,
      cwd,
      browserToolEnabled,
      canvasEnabled,
      onPiSessionIdChange,
      enqueuePiEvent,
      flushPiEventBatch,
      updateSession,
      shouldApplyRuntimeSeq,
    ],
  );

  submitPromptRef.current = submitPrompt;

  const abortTurn = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const runtime = resolveRuntimeSessionId(session, runtimeSessionId);
      await api.abortSession(runtime);
      flushPiEventBatch(sessionId);
      updateSession(sessionId, (s) => ({ ...s, status: "idle" }));
    },
    [flushPiEventBatch, runtimeSessionId, updateSession],
  );

  const loadAndReplay = useCallback(
    async (piSessionId: string, sessionId: SessionId) => {
      if (!cwd) {
        // No cwd yet — we can't hydrate session history. Make sure the
        // session isn't left in a permanent "loading" state (which blocks
        // the composer's send button) just because the snapshot reducer
        // optimistically tagged it as loading on hydration.
        updateSession(sessionId, (session) =>
          session.status === "loading" ? { ...session, status: "idle" } : session,
        );
        return;
      }
      updateSession(sessionId, (session) => ({ ...session, status: "loading", error: "" }));
      try {
        const { events } = await api.loadCanonicalSession(piSessionId, cwd);
        const runtimeId = resolveRuntimeSessionId(
          tabsRef.current.find((tab) => tab.id === sessionId),
          runtimeSessionId,
        );
        const runtimeStatus = await api.loadRuntimeStatus(runtimeId, piSessionId);
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
        } = replaySessionEvents(replayEvents);
        const tokenStats = [...replayEvents]
          .reverse()
          .map(usageFromEvent)
          .find((stats): stats is TokenStats => Boolean(stats));
        const replaySeq = replayCursorAfterRuntimeHydration(runtimeActive, runtimeStatus?.eventSeq);
        updateSession(sessionId, (session) => ({
          ...session,
          messages,
          piSessionId,
          cwd: session.cwd || cwd,
          modelId: session.modelId || replayModelId || runtimeStatus?.modelId || modelId,
          title: title ?? session.title,
          startedAt: startedAt ?? session.startedAt,
          tokenStats: tokenStats ?? session.tokenStats,
          contextUsage: runtimeStatus?.contextUsage ?? session.contextUsage ?? null,
          status: runtimeActive ? "running" : "idle",
          activeAssistantId: undefined,
          lastEventSeq: replaySeq,
          error: "",
        }));
      } catch (err) {
        updateSession(sessionId, (session) => ({
          ...session,
          error: err instanceof Error ? err.message : "Failed to load session",
          status: "idle",
        }));
      }
    },
    [cwd, modelId, runtimeSessionId, updateSession],
  );

  const compact = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      if (!session || !modelId) return;
      updateSession(sessionId, (s) => ({ ...s, error: "" }));
      try {
        const result = await api.compactSession({
          sessionId: session.runtimeSessionId || runtimeSessionId,
          modelId,
          cwd: cwd.trim() || undefined,
          piSessionId: session.piSessionId,
          browserToolEnabled: browserToolEnabled || promptRequestsBrowser(session.input),
          browserSessionId: session.runtimeSessionId || runtimeSessionId,
          canvasEnabled,
          plugins: activeComposerPlugins(
            selectionForRef.current(sessionId).plugins ?? EMPTY_PLUGINS,
          ) as ComposerPluginRef[],
          skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
          promptTemplates:
            selectionForRef.current(sessionId).promptTemplates ?? EMPTY_PROMPT_TEMPLATES,
          extensionOverrides:
            selectionForRef.current(sessionId).extensionOverrides ?? EMPTY_EXTENSION_OVERRIDES,
        });
        const nextSessionId = result.status?.piSessionId || session.piSessionId;
        if (nextSessionId) await loadAndReplay(nextSessionId, sessionId);
      } catch (error) {
        updateSession(sessionId, (s) => ({
          ...s,
          error: error instanceof Error ? error.message : "Compaction failed",
        }));
      }
    },
    [
      browserToolEnabled,
      canvasEnabled,
      cwd,
      loadAndReplay,
      modelId,
      runtimeSessionId,
      updateSession,
    ],
  );

  // Resume an in-flight runtime session via SSE — fires when the active
  // session's status flips to running/starting and we *don't* own the local
  // stream (e.g. after a refresh, or when a different pane joins a running
  // session).
  const resumeRuntimeTarget = resolveResumeRuntimeTarget(
    tabsRef.current,
    activeTabId,
    runtimeSessionId,
  );
  const resumeRuntimeId = resumeRuntimeTarget?.sessionId ?? null;
  const resumeRuntimeSessionId = resumeRuntimeTarget?.runtimeSessionId ?? null;
  const resumeAfter = resumeRuntimeTarget?.after ?? 0;
  const resumePiSessionId = resumeRuntimeTarget?.piSessionId ?? null;

  useSessionEngineRuntimeResumeEffect({
    after: resumeAfter,
    applyPiEvent: enqueuePiEvent,
    flushPiEvents: flushPiEventBatch,
    localStreamRef,
    onPiSessionIdChange,
    piSessionId: resumePiSessionId,
    runtime: resumeRuntimeSessionId,
    sessionId: resumeRuntimeId,
    shouldApplySeq: shouldApplyRuntimeSeq,
    submitPromptRef,
    tabsRef,
    updateSession,
  });

  return useMemo<SessionEngine>(
    () => ({
      submitPrompt,
      sendControl,
      loadRuntimeStatus: loadRuntimeStatusCb,
      abortTurn,
      loadAndReplay,
      compact,
      acceptsControl: runtimeStatusAcceptsControl,
    }),
    [submitPrompt, sendControl, loadRuntimeStatusCb, abortTurn, loadAndReplay, compact],
  );
}
