// Pure pi-runtime state derivation. This module must stay free of runtime
// imports of @earendil-works/pi-coding-agent (ESM-only) so the node test
// runner can load it; pi-runtime-types only contributes erased type imports.
import type { LoggedPiEvent, PiAgentStatus, PiContextUsage } from "./pi-runtime-types";

type RuntimeLookupEntry<TSession> = {
  sessionId: string;
  session: TSession;
};

type RuntimeLookupStatus = {
  piSessionId?: string | null;
  active?: boolean;
  running?: boolean;
  eventSeq?: number;
};

type RuntimeLookupSession = { status: RuntimeLookupStatus };

export function findRuntimeSessionForLookup<TSession extends RuntimeLookupSession>(
  entries: Iterable<RuntimeLookupEntry<TSession>>,
  sessionId: string,
  piSessionId?: string | null,
): RuntimeLookupEntry<TSession> | null {
  const snapshot = [...entries];
  const exact = snapshot.find((entry) => entry.sessionId === sessionId);
  const target = piSessionId?.trim();
  if (!target) return exact ?? null;
  const matches = snapshot.filter(
    (entry) =>
      entry.session.status.piSessionId === target ||
      (entry.sessionId === sessionId && !entry.session.status.piSessionId),
  );
  return matches.reduce<RuntimeLookupEntry<TSession> | null>(
    (best, candidate) =>
      !best || runtimeLookupOutranks(candidate, best, sessionId) ? candidate : best,
    null,
  );
}

function runtimeLookupOutranks<TSession extends RuntimeLookupSession>(
  candidate: RuntimeLookupEntry<TSession>,
  current: RuntimeLookupEntry<TSession>,
  requestedSessionId: string,
): boolean {
  const candidateRank = runtimeLookupRank(candidate, requestedSessionId);
  const currentRank = runtimeLookupRank(current, requestedSessionId);
  for (let index = 0; index < candidateRank.length; index += 1) {
    if (candidateRank[index] !== currentRank[index]) {
      return candidateRank[index] > currentRank[index];
    }
  }
  return false;
}

function runtimeLookupRank<TSession extends RuntimeLookupSession>(
  entry: RuntimeLookupEntry<TSession>,
  requestedSessionId: string,
): [number, number, number, number] {
  return [
    entry.session.status.active === true ? 1 : 0,
    entry.session.status.running === true ? 1 : 0,
    entry.sessionId === requestedSessionId ? 1 : 0,
    entry.session.status.eventSeq ?? 0,
  ];
}

export function piStatusFromEvents(input: {
  running: boolean;
  activePromptCount: number;
  sdkActive?: boolean;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  eventLog: LoggedPiEvent[];
  contextUsage?: PiContextUsage | null;
}): PiAgentStatus {
  return {
    running: input.running,
    active: input.activePromptCount > 0 || input.sdkActive === true,
    modelId: input.modelId,
    cwd: input.cwd,
    piSessionId: input.piSessionId,
    agentDir: input.agentDir,
    eventSeq: input.eventSeq,
    lastError: input.lastError,
    contextUsage: input.contextUsage ?? null,
  };
}

// isAgentEndEvent lives in shared/agent/pi-events.ts because the frontend's
// client-side event pipeline needs it too; re-exported here so runtime
// callers keep their import surface.
export { isAgentEndEvent } from "../../../shared/agent/pi-events";
