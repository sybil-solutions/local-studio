import type { ComposerPluginRef, ComposerSkillRef } from "./composer-context";
import { cleanSessionTitle } from "./session/helpers";

export type ActiveAgentSessionSnapshot = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  modelId?: string;
  title: string;
  status: string;
  active?: boolean;
  startedAt?: string;
  updatedAt: string;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  usedSkills?: ComposerSkillRef[];
};

export type ActiveSessionPrefs = Record<string, { hidden?: boolean }>;

type MergeTarget = {
  key: string;
  tabKey: string;
  existing?: ActiveAgentSessionSnapshot;
  existingFromIncoming: boolean;
};

function sessionStorageKey(session: ActiveAgentSessionSnapshot): string {
  return session.piSessionId
    ? `pi:${session.piSessionId}`
    : `tab:${session.paneId}:${session.tabId}`;
}

function isHidden(session: ActiveAgentSessionSnapshot, prefs: ActiveSessionPrefs): boolean {
  return Boolean(session.piSessionId && prefs[session.piSessionId]?.hidden);
}

function startTime(session: ActiveAgentSessionSnapshot): number {
  const value = Date.parse(session.startedAt ?? session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function updateTime(session: ActiveAgentSessionSnapshot): number {
  const value = Date.parse(session.updatedAt);
  return Number.isFinite(value) ? value : startTime(session);
}

function normalizeSingleActive(
  sessions: ActiveAgentSessionSnapshot[],
): ActiveAgentSessionSnapshot[] {
  const active = sessions.filter((session) => session.active);
  if (active.length <= 1) return sessions;
  const keep = active.reduce((latest, session) =>
    updateTime(session) > updateTime(latest) ? session : latest,
  );
  return sessions.map((session) => (session === keep ? session : { ...session, active: false }));
}

function findPiKeyForTab(
  byKey: Map<string, ActiveAgentSessionSnapshot>,
  session: ActiveAgentSessionSnapshot,
): string | undefined {
  return [...byKey.entries()].find(
    ([, value]) =>
      value.paneId === session.paneId && value.tabId === session.tabId && value.piSessionId,
  )?.[0];
}

function resolveMergeTarget(
  byKey: Map<string, ActiveAgentSessionSnapshot>,
  incomingKeys: Set<string>,
  session: ActiveAgentSessionSnapshot,
): MergeTarget {
  const tabKey = `tab:${session.paneId}:${session.tabId}`;
  const existingTab = byKey.get(tabKey);
  const existingPiKey = findPiKeyForTab(byKey, session);
  if (session.piSessionId) byKey.delete(tabKey);
  const key = session.piSessionId ? `pi:${session.piSessionId}` : (existingPiKey ?? tabKey);
  return {
    key,
    tabKey,
    existing: byKey.get(key) ?? existingTab,
    existingFromIncoming:
      incomingKeys.has(key) ||
      incomingKeys.has(tabKey) ||
      Boolean(existingPiKey && incomingKeys.has(existingPiKey)),
  };
}

function preferText(value: string, fallback: string): string {
  return cleanSessionTitle(value) || cleanSessionTitle(fallback) || fallback;
}

function preferDefined<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function preferNullable<T>(value: T | null | undefined, fallback: T | null): T | null {
  return value ?? fallback;
}

function preserveActiveSnapshot(
  session: ActiveAgentSessionSnapshot,
  existing: ActiveAgentSessionSnapshot,
): ActiveAgentSessionSnapshot {
  return {
    ...existing,
    title: preferText(session.title, existing.title),
    status: preferText(session.status, existing.status),
    updatedAt: preferText(session.updatedAt, existing.updatedAt),
    piSessionId: preferNullable(session.piSessionId, existing.piSessionId),
    modelId: preferDefined(session.modelId, existing.modelId),
    startedAt: preferDefined(
      existing.startedAt,
      preferDefined(session.startedAt, session.updatedAt),
    ),
    plugins: preferDefined(session.plugins, existing.plugins),
    skills: preferDefined(session.skills, existing.skills),
    usedSkills: preferDefined(session.usedSkills, existing.usedSkills),
  };
}

function applyIncomingSnapshot(
  session: ActiveAgentSessionSnapshot,
  target: MergeTarget,
): ActiveAgentSessionSnapshot {
  return {
    ...target.existing,
    ...session,
    piSessionId: preferNullable(session.piSessionId, target.existing?.piSessionId ?? null),
    startedAt: preferDefined(
      target.existing?.startedAt,
      preferDefined(session.startedAt, session.updatedAt),
    ),
    plugins: preferDefined(session.plugins, target.existing?.plugins),
    skills: preferDefined(session.skills, target.existing?.skills),
    usedSkills: preferDefined(session.usedSkills, target.existing?.usedSkills),
  };
}

function mergeSessionSnapshot(
  session: ActiveAgentSessionSnapshot,
  target: MergeTarget,
): ActiveAgentSessionSnapshot {
  const existing = target.existing;
  if (existing?.active && !session.active && target.existingFromIncoming) {
    return preserveActiveSnapshot(session, existing);
  }
  return applyIncomingSnapshot(session, target);
}

export function mergeActiveAgentSessions(
  previous: ActiveAgentSessionSnapshot[],
  incoming: ActiveAgentSessionSnapshot[],
  prefs: ActiveSessionPrefs = {},
): ActiveAgentSessionSnapshot[] {
  const byKey = new Map<string, ActiveAgentSessionSnapshot>();
  const incomingKeys = new Set<string>();
  for (const session of previous) {
    if (!isHidden(session, prefs)) byKey.set(sessionStorageKey(session), session);
  }
  for (const session of incoming) {
    if (isHidden(session, prefs)) continue;
    const target = resolveMergeTarget(byKey, incomingKeys, session);
    byKey.set(target.key, mergeSessionSnapshot(session, target));
    incomingKeys.add(target.key);
  }
  return normalizeSingleActive([...byKey.values()].sort((a, b) => startTime(b) - startTime(a)));
}
