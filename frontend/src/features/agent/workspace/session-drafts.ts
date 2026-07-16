import { Schema } from "effect";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";

export const SESSION_DRAFTS_KEY = "local-studio.agent.sessionDrafts.v1";
const MAX_SESSION_DRAFTS = 100;

type DraftStorage = Pick<Storage, "getItem" | "setItem">;
export type SessionDrafts = ReadonlyMap<string, string>;

const SessionDraftsSchema = Schema.Struct({
  version: Schema.Literal(1),
  drafts: Schema.Record(Schema.String, Schema.String),
});

const decodeSessionDrafts = Schema.decodeUnknownOption(SessionDraftsSchema);

function sessionDraftKey(session: Pick<Session, "id" | "piSessionId">): string {
  return session.piSessionId ?? session.id;
}

export function loadSessionDrafts(storage: DraftStorage): Map<string, string> {
  try {
    const option = decodeSessionDrafts(JSON.parse(storage.getItem(SESSION_DRAFTS_KEY) ?? "null"));
    return option._tag === "Some" ? new Map(Object.entries(option.value.drafts)) : new Map();
  } catch {
    return new Map();
  }
}

export function writeSessionDrafts(storage: DraftStorage, drafts: SessionDrafts): void {
  const entries = [...drafts].filter(([, draft]) => draft.length > 0).slice(-MAX_SESSION_DRAFTS);
  try {
    storage.setItem(
      SESSION_DRAFTS_KEY,
      JSON.stringify({ version: 1, drafts: Object.fromEntries(entries) }),
    );
  } catch {}
}

export function restoreSessionDraft(session: Session, drafts: SessionDrafts): Session {
  if (session.input.length > 0) return session;
  const draft = drafts.get(sessionDraftKey(session)) ?? drafts.get(session.id);
  return draft ? { ...session, input: draft } : session;
}

export function restoreSessionDrafts(
  sessions: SessionsMap,
  drafts: SessionDrafts,
): Map<SessionId, Session> {
  let next: Map<SessionId, Session> | null = null;
  for (const [id, session] of sessions) {
    const restored = restoreSessionDraft(session, drafts);
    if (restored === session) continue;
    next ??= new Map(sessions);
    next.set(id, restored);
  }
  return next ?? new Map(sessions);
}

export function sessionDraftsWithSessions(
  drafts: SessionDrafts,
  sessions: SessionsMap,
): SessionDrafts {
  let next: Map<string, string> | null = null;
  for (const session of sessions.values()) {
    if (!session.input.length) continue;
    next ??= new Map(drafts);
    next.delete(session.id);
    if (session.piSessionId) next.delete(session.piSessionId);
    next.set(sessionDraftKey(session), session.input);
  }
  return next ?? drafts;
}

export function updateSessionDrafts(
  drafts: SessionDrafts,
  before: Session,
  after: Session,
): SessionDrafts {
  const beforeKey = sessionDraftKey(before);
  const afterKey = sessionDraftKey(after);
  if (before.input === after.input && beforeKey === afterKey) return drafts;
  const next = new Map(drafts);
  next.delete(before.id);
  if (before.piSessionId) next.delete(before.piSessionId);
  next.delete(after.id);
  if (after.piSessionId) next.delete(after.piSessionId);
  if (after.input.length > 0) next.set(afterKey, after.input);
  return next;
}
