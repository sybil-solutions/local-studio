import type { ActiveAgentSessionSnapshot } from "@/features/agent/active-sessions";

export type AggregatedSession = {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  modelId: string | null;
  firstUserMessage: string | null;
  startedAt: string;
  updatedAt: string;
  filename: string;
};

export type ActiveSession = Pick<
  ActiveAgentSessionSnapshot,
  | "projectId"
  | "cwd"
  | "paneId"
  | "tabId"
  | "piSessionId"
  | "title"
  | "status"
  | "focused"
  | "updatedAt"
>;

export type SessionSortField = "updatedAt" | "projectName";

/**
 * Index active (in-pane) sessions by their pi session id, so a stored session
 * can be matched to one currently running in a pane. Sessions without a
 * piSessionId yet are skipped.
 */
export function indexActiveByPiId(
  activeSessions: readonly ActiveSession[],
): Map<string, ActiveSession> {
  const map = new Map<string, ActiveSession>();
  for (const session of activeSessions) {
    if (session.piSessionId) map.set(session.piSessionId, session);
  }
  return map;
}
