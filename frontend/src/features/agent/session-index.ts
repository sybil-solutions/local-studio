import type { ComposerSkillRef } from "@/features/agent/composer-context";
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
  unseen: boolean;
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
    }
  | {
      kind: "history";
      key: string;
      threadId: string;
      sortAt: number;
      session: SessionSummary;
    };

function timestamp(value?: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isWorking(status: string): boolean {
  return status !== "" && status !== "idle" && status !== "done";
}

function unseenFor(session: OpenAgentSession, previous?: OpenAgentSession): boolean {
  if (session.focused) return false;
  return (
    session.unseen ||
    previous?.unseen === true ||
    isWorking(session.status) ||
    Boolean(previous && isWorking(previous.status) && !isWorking(session.status))
  );
}

export function reconcileOpenSessions(
  previous: readonly OpenAgentSession[],
  incoming: readonly OpenAgentSession[],
): OpenAgentSession[] {
  const previousById = new Map(previous.map((session) => [session.id, session]));
  return incoming.map((session) => ({
    ...session,
    unseen: unseenFor(session, previousById.get(session.id)),
  }));
}

function uniqueOpenSessions(sessions: readonly OpenAgentSession[]): OpenAgentSession[] {
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
    });
  }
  return rows.sort((left, right) => right.sortAt - left.sortAt);
}

let openSessions: OpenAgentSession[] = [];
const listeners = new Set<() => void>();

export function getOpenSessions(): readonly OpenAgentSession[] {
  return openSessions;
}

export function subscribeOpenSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishOpenSessions(incoming: readonly OpenAgentSession[]): void {
  const next = reconcileOpenSessions(openSessions, incoming);
  if (JSON.stringify(next) === JSON.stringify(openSessions)) return;
  openSessions = next;
  for (const listener of listeners) listener();
}
