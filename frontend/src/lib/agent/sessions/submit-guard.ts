import type { SessionId } from "./types";

export type SessionSubmitGuard = Set<SessionId>;

export function beginSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): boolean {
  if (!sessionId || guard.has(sessionId)) return false;
  guard.add(sessionId);
  return true;
}

export function endSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): void {
  if (!sessionId) return;
  guard.delete(sessionId);
}
