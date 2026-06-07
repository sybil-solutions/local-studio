import type { ComposerPluginRef, ComposerSkillRef } from "./composer-context";

export type ActiveAgentSessionSnapshot = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  runtimeSessionId: string;
  piSessionId: string | null;
  modelId?: string;
  title: string;
  status: string;
  focused?: boolean;
  startedAt?: string;
  updatedAt: string;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  usedSkills?: ComposerSkillRef[];
};

export type ActiveSessionPrefs = Record<string, { hidden?: boolean }>;

type MergeTarget = {
  key: string;
  existing?: ActiveAgentSessionSnapshot;
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
  session: ActiveAgentSessionSnapshot,
): MergeTarget {
  const tabKey = `tab:${session.paneId}:${session.tabId}`;
  const existingTab = byKey.get(tabKey);
  const existingPiKey = findPiKeyForTab(byKey, session);
  if (session.piSessionId) byKey.delete(tabKey);
  const key = session.piSessionId ? `pi:${session.piSessionId}` : (existingPiKey ?? tabKey);
  return {
    key,
    existing: byKey.get(key) ?? existingTab,
  };
}

function preferDefined<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function preferNullable<T>(value: T | null | undefined, fallback: T | null): T | null {
  return value ?? fallback;
}

function applyIncomingSnapshot(
  session: ActiveAgentSessionSnapshot,
  target: MergeTarget,
): ActiveAgentSessionSnapshot {
  return {
    ...target.existing,
    ...session,
    piSessionId: preferNullable(session.piSessionId, target.existing?.piSessionId ?? null),
    runtimeSessionId:
      session.runtimeSessionId || target.existing?.runtimeSessionId || session.tabId,
    startedAt: preferDefined(
      target.existing?.startedAt,
      preferDefined(session.startedAt, session.updatedAt),
    ),
    plugins: preferDefined(session.plugins, target.existing?.plugins),
    skills: preferDefined(session.skills, target.existing?.skills),
    usedSkills: preferDefined(session.usedSkills, target.existing?.usedSkills),
  };
}

export function mergeActiveAgentSessions(
  previous: ActiveAgentSessionSnapshot[],
  incoming: ActiveAgentSessionSnapshot[],
  prefs: ActiveSessionPrefs = {},
): ActiveAgentSessionSnapshot[] {
  const byKey = new Map<string, ActiveAgentSessionSnapshot>();
  let focusedKey: string | null = null;
  for (const session of previous) {
    if (!isHidden(session, prefs)) byKey.set(sessionStorageKey(session), session);
  }
  for (const session of incoming) {
    if (isHidden(session, prefs)) continue;
    const target = resolveMergeTarget(byKey, session);
    byKey.set(target.key, applyIncomingSnapshot(session, target));
    if (session.focused === true) focusedKey = target.key;
  }
  return normalizeFocusedSession(
    [...byKey.values()].sort((a, b) => startTime(b) - startTime(a)),
    focusedKey,
  );
}

function normalizeFocusedSession(
  sessions: ActiveAgentSessionSnapshot[],
  preferredKey: string | null,
): ActiveAgentSessionSnapshot[] {
  const focusedKey = preferredKey ?? firstFocusedSessionKey(sessions);
  if (!focusedKey) return sessions;
  return sessions.map((session) => {
    const focused = sessionStorageKey(session) === focusedKey;
    return session.focused === focused ? session : { ...session, focused };
  });
}

function firstFocusedSessionKey(sessions: ActiveAgentSessionSnapshot[]): string | null {
  const focused = sessions.find((session) => session.focused === true);
  return focused ? sessionStorageKey(focused) : null;
}
