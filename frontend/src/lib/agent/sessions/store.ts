import type { Session, SessionId, SessionsMap } from "./types";

export function setSession(sessions: SessionsMap, session: Session): SessionsMap {
  const next = new Map(sessions);
  next.set(session.id, session);
  return next;
}

export function patchSession(
  sessions: SessionsMap,
  id: SessionId,
  patch: Partial<Session> | ((session: Session) => Session),
): SessionsMap {
  const current = sessions.get(id);
  if (!current) return sessions;
  const updated = typeof patch === "function" ? patch(current) : { ...current, ...patch };
  if (updated === current) return sessions;
  const next = new Map(sessions);
  next.set(id, updated);
  return next;
}

export function pruneSessions(
  sessions: SessionsMap,
  referencedIds: ReadonlySet<SessionId>,
): SessionsMap {
  let changed = false;
  const next = new Map(sessions);
  for (const id of next.keys()) {
    if (!referencedIds.has(id)) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : sessions;
}

export function isEmptyStarterSession(session: Session): boolean {
  const hasQueuedWork = (session.queue?.length ?? 0) > 0;
  const isLiveStatus =
    session.status === "starting" || session.status === "running" || session.status === "loading";
  return (
    !session.piSessionId &&
    session.messages.length === 0 &&
    !session.input.trim() &&
    !session.startedAt &&
    !session.activeAssistantId &&
    session.lastEventSeq === undefined &&
    !hasQueuedWork &&
    !isLiveStatus
  );
}
