import type { ComposerSkillRef } from "@/features/agent/composer-context";
import { isWorkingStatus } from "@/features/agent/runtime/session-status";
import type { RuntimeSessionSummary } from "@/features/agent/runtime/api";
import type { SessionSummary } from "@/features/agent/session-summary";

export type OpenAgentSession = {
  id: string;
  threadId: string | null;
  projectId: string;
  cwd: string;
  paneId: string;
  modelId?: string;
  title: string;
  status: string;
  focused: boolean;
  startedAt?: string;
  updatedAt: string;
  skills?: ComposerSkillRef[];
  usedSkills?: ComposerSkillRef[];
};

export type SessionIndexRow =
  | {
      kind: "open";
      key: string;
      threadId: string | null;
      sortAt: number;
      session: OpenAgentSession;
      activity: SessionActivity;
    }
  | {
      kind: "history";
      key: string;
      threadId: string;
      sortAt: number;
      session: SessionSummary;
      activity: SessionActivity;
    };

export type SessionActivity = "idle" | "running" | "unseen";

export type SessionActivitySnapshot = {
  active: ReadonlySet<string>;
  unseen: ReadonlySet<string>;
};

const EMPTY_ACTIVITY: SessionActivitySnapshot = {
  active: new Set(),
  unseen: new Set(),
};

function timestamp(value?: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasIdentity(ids: ReadonlySet<string>, identity: readonly (string | null)[]): boolean {
  return identity.some((id) => Boolean(id && ids.has(id)));
}

export function sessionActivity(
  identity: readonly (string | null)[],
  snapshot: SessionActivitySnapshot,
  optimisticStatus = "idle",
  focused = false,
): SessionActivity {
  if (isWorkingStatus(optimisticStatus) || hasIdentity(snapshot.active, identity)) return "running";
  if (!focused && hasIdentity(snapshot.unseen, identity)) return "unseen";
  return "idle";
}

export function uniqueOpenSessions(sessions: readonly OpenAgentSession[]): OpenAgentSession[] {
  const byKey = new Map<string, OpenAgentSession>();
  for (const session of sessions) {
    const key = session.threadId ?? session.id;
    const previous = byKey.get(key);
    if (
      !previous ||
      session.focused ||
      (!previous.focused && timestamp(session.updatedAt) > timestamp(previous.updatedAt))
    ) {
      byKey.set(key, session);
    }
  }
  return [...byKey.values()];
}

export function sessionRows(
  openSessions: readonly OpenAgentSession[],
  historySessions: readonly SessionSummary[],
  activity: SessionActivitySnapshot = EMPTY_ACTIVITY,
): SessionIndexRow[] {
  const historyById = new Map(historySessions.map((session) => [session.id, session]));
  const openThreadIds = new Set<string>();
  const rows: SessionIndexRow[] = [];
  for (const session of uniqueOpenSessions(openSessions)) {
    const history = session.threadId ? historyById.get(session.threadId) : undefined;
    if (session.threadId) openThreadIds.add(session.threadId);
    rows.push({
      kind: "open",
      key: session.threadId ?? session.id,
      threadId: session.threadId,
      sortAt: timestamp(history?.startedAt ?? session.startedAt ?? session.updatedAt),
      session,
      activity: sessionActivity(
        [session.id, session.threadId],
        activity,
        session.status,
        session.focused,
      ),
    });
  }
  for (const session of historySessions) {
    if (openThreadIds.has(session.id)) continue;
    rows.push({
      kind: "history",
      key: session.id,
      threadId: session.id,
      sortAt: timestamp(session.startedAt),
      session,
      activity: sessionActivity([session.id], activity),
    });
  }
  return rows.sort((left, right) => right.sortAt - left.sortAt);
}

let openSessions: OpenAgentSession[] = [];
const listeners = new Set<() => void>();
let activitySnapshot = EMPTY_ACTIVITY;
const activityListeners = new Set<() => void>();

export function getOpenSessions(): readonly OpenAgentSession[] {
  return openSessions;
}

export function subscribeOpenSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishOpenSessions(incoming: readonly OpenAgentSession[]): void {
  const next = [...incoming];
  if (JSON.stringify(next) === JSON.stringify(openSessions)) return;
  openSessions = next;
  for (const listener of listeners) listener();
}

export function getSessionActivity(): SessionActivitySnapshot {
  return activitySnapshot;
}

export function subscribeSessionActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

export function publishRuntimeActivity(entries: readonly RuntimeSessionSummary[]): void {
  const active = new Set<string>();
  for (const entry of entries) {
    if (entry.status.active !== true) continue;
    active.add(entry.sessionId);
    if (entry.status.piSessionId) active.add(entry.status.piSessionId);
  }
  const unseen = new Set(activitySnapshot.unseen);
  for (const id of activitySnapshot.active) if (!active.has(id)) unseen.add(id);
  for (const id of active) unseen.delete(id);
  if (sameIds(activitySnapshot.active, active) && sameIds(activitySnapshot.unseen, unseen)) return;
  activitySnapshot = { active, unseen };
  for (const listener of activityListeners) listener();
}

export function markSessionActivitySeen(...ids: readonly (string | null | undefined)[]): void {
  const unseen = new Set(activitySnapshot.unseen);
  for (const id of ids) if (id) unseen.delete(id);
  if (sameIds(activitySnapshot.unseen, unseen)) return;
  activitySnapshot = { ...activitySnapshot, unseen };
  for (const listener of activityListeners) listener();
}
