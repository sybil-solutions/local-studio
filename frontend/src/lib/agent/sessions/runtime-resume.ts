import { isAgentEndEvent } from "@/lib/agent/pi-events";
import { newId, nowLabel, piSessionIdFromEvent } from "@/lib/agent/session";
import type { RuntimeEventPayload, RuntimeEventSubscription, RuntimeStatus } from "./api";
import { drainQueuedTurnAfterAgentEnd, type QueuedTurnSubmitArgs } from "./queue-drain";
import type { Session, SessionId } from "./types";

type ReadonlyRef<T> = { readonly current: T };
type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;
type RuntimeResumeApi = {
  loadRuntimeStatus: (
    runtime: string,
    piSessionId?: string | null,
  ) => Promise<RuntimeStatus | null>;
  subscribeRuntimeEvents: (
    runtime: string,
    after: number,
    piSessionId: string | null | undefined,
    handlers: {
      onPayload: (payload: RuntimeEventPayload) => void;
      onError: () => void;
    },
  ) => RuntimeEventSubscription;
};

export type RuntimeResumeDeps = {
  after: number;
  api: RuntimeResumeApi;
  applyPiEvent: (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    options?: { flushNow?: boolean },
  ) => void;
  flushPiEvents?: (sessionId: SessionId) => void;
  onPiSessionIdChange?: (piSessionId: string) => void;
  runtime: string;
  piSessionId?: string | null;
  schedule?: (callback: () => void) => void;
  sessionId: SessionId;
  shouldApplySeq?: (sessionId: SessionId, seq?: number) => boolean;
  submitPromptRef: ReadonlyRef<(args: QueuedTurnSubmitArgs) => Promise<void>>;
  tabsRef: ReadonlyRef<Session[]>;
  updateSession: UpdateSession;
};

export function subscribeResumeRuntimeSession(deps: RuntimeResumeDeps): RuntimeEventSubscription {
  let closed = false;
  const sub = deps.api.subscribeRuntimeEvents(deps.runtime, deps.after, deps.piSessionId, {
    onPayload: (payload) => {
      if (closed) return;
      applyRuntimePayload(deps, payload);
    },
    onError: () => {
      if (closed) return;
      void reconcileRuntimeLiveness(deps, () => closed, sub);
    },
  });

  return {
    close: () => {
      closed = true;
      deps.flushPiEvents?.(deps.sessionId);
      sub.close();
    },
  };
}

function applyRuntimePayload(deps: RuntimeResumeDeps, payload: RuntimeEventPayload): void {
  if (payload.type === "status") {
    applyRuntimeStatusPayload(deps, payload);
    return;
  }
  applyRuntimePiPayload(deps, payload);
}

function applyRuntimeStatusPayload(
  deps: RuntimeResumeDeps,
  payload: Extract<RuntimeEventPayload, { type: "status" }>,
): void {
  const idle = payload.phase === "done" || payload.phase === "idle";
  deps.updateSession(deps.sessionId, (session) => ({
    ...session,
    piSessionId: payload.session?.piSessionId || session.piSessionId,
    status: idle ? "idle" : "running",
    activeAssistantId: idle ? undefined : session.activeAssistantId,
  }));
}

function applyRuntimePiPayload(
  deps: RuntimeResumeDeps,
  payload: Extract<RuntimeEventPayload, { type: "pi" }>,
): void {
  const eventId = piSessionIdFromEvent(payload.event);
  const seqAllowed = deps.shouldApplySeq ? deps.shouldApplySeq(deps.sessionId, payload.seq) : true;
  if (!seqAllowed) {
    return;
  }
  const assistantId = ensureAssistantId(deps);
  const agentEnded = isAgentEndEvent(payload.event);
  deps.updateSession(deps.sessionId, (session) => ({
    ...session,
    piSessionId: eventId || session.piSessionId,
    status: agentEnded ? "idle" : "running",
    activeAssistantId: agentEnded ? undefined : assistantId,
  }));
  if (eventId) deps.onPiSessionIdChange?.(eventId);
  if (agentEnded) {
    deps.applyPiEvent(deps.sessionId, assistantId, payload.event, { flushNow: true });
  } else {
    deps.applyPiEvent(deps.sessionId, assistantId, payload.event);
  }
  if (agentEnded) drainQueuedTurnAfterAgentEnd(deps, deps.sessionId);
}

function ensureAssistantId(deps: RuntimeResumeDeps): string {
  const current = deps.tabsRef.current.find((tab) => tab.id === deps.sessionId);
  const existing =
    (current?.activeAssistantId &&
      current.messages.some((message) => message.id === current.activeAssistantId) &&
      current.activeAssistantId) ||
    [...(current?.messages ?? [])].reverse().find((message) => message.role === "assistant")?.id;
  if (existing) {
    deps.updateSession(deps.sessionId, (session) => ({ ...session, activeAssistantId: existing }));
    return existing;
  }

  const assistantId = newId("assistant");
  deps.updateSession(deps.sessionId, (session) => ({
    ...session,
    activeAssistantId: assistantId,
    messages: [
      ...session.messages,
      { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  }));
  return assistantId;
}

async function reconcileRuntimeLiveness(
  deps: RuntimeResumeDeps,
  isClosed: () => boolean,
  sub: RuntimeEventSubscription,
): Promise<void> {
  const status = await deps.api.loadRuntimeStatus(deps.runtime, deps.piSessionId);
  if (isClosed()) return;
  if (status?.active) {
    deps.updateSession(deps.sessionId, (session) => ({
      ...session,
      piSessionId: status.piSessionId || session.piSessionId,
      status: "running",
    }));
    return;
  }
  sub.close();
  deps.flushPiEvents?.(deps.sessionId);
  deps.updateSession(deps.sessionId, (session) =>
    session.status === "running" || session.status === "starting"
      ? { ...session, status: "idle", activeAssistantId: undefined }
      : session,
  );
}
