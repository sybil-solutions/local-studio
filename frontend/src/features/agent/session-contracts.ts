import type { OpenAgentSession } from "@/features/agent/session-index";

export type ActiveSession = Pick<
  OpenAgentSession,
  "projectId" | "cwd" | "paneId" | "id" | "threadId" | "title" | "status" | "focused" | "updatedAt"
>;

export type SessionSortField = "updatedAt" | "projectName";

export function indexOpenByThreadId(
  activeSessions: readonly ActiveSession[],
): Map<string, ActiveSession> {
  const map = new Map<string, ActiveSession>();
  for (const session of activeSessions) {
    if (session.threadId) map.set(session.threadId, session);
  }
  return map;
}
