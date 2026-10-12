import type { Session, SessionsMap } from "@/features/agent/runtime/types";
import { paneSessionId } from "@/features/agent/runtime/selectors";
import type { PaneId, PaneState } from "@/features/agent/workspace/types";

type PaneReplayHandle = {
  sessionId: string;
  loadAndReplay: (piSessionId: string) => Promise<void> | void;
};

export type SessionReplayQueueDeps = {
  getHandle: (paneId: PaneId) => PaneReplayHandle | undefined;
  getState: () => {
    panesById: ReadonlyMap<PaneId, PaneState>;
    sessions: SessionsMap;
  };
  setTimeout: (handler: () => void, delay: number) => void;
};

export type SessionReplayQueue = {
  /** Queue (last-wins per pane) a canonical-session replay for a pane. */
  queue: (paneId: PaneId, piSessionId: string) => void;
  /** A pane handle mounted — drain any replay queued before it existed. */
  notifyHandleRegistered: (paneId: PaneId) => void;
};

// The replay drop guard is deliberately NARROWER than isEmptyStarterSession:
// typed-but-unsent input or a startedAt stamp still counts as "fresh" here. A
// "+" click (or any swap) replaces a pane's session in place under the same
// paneId; a fresh empty starter has nothing to replay, so a stale pending
// replay landing on it would overwrite the new chat with the old transcript —
// the "+ opens the old chat" bug.
function isFreshStarter(session: Session | undefined): boolean {
  return (
    !!session &&
    session.piSessionId == null &&
    session.messages.length === 0 &&
    session.status === "idle"
  );
}

export function createSessionReplayQueue(deps: SessionReplayQueueDeps): SessionReplayQueue {
  const pending = new Map<PaneId, string>();

  const drain = (paneId: PaneId) => {
    const pendingSessionId = pending.get(paneId);
    if (!pendingSessionId) return;
    const handle = deps.getHandle(paneId);
    if (!handle) return;
    const sessionId = paneSessionId(deps.getState().panesById.get(paneId));
    const current = sessionId ? deps.getState().sessions.get(sessionId) : undefined;
    if (!current || isFreshStarter(current) || current.messages.length > 0) {
      pending.delete(paneId);
      return;
    }
    if (current.piSessionId && current.piSessionId !== pendingSessionId) {
      pending.delete(paneId);
      return;
    }
    if (handle.sessionId !== current.id) return;
    pending.delete(paneId);
    void handle.loadAndReplay(pendingSessionId);
  };

  return {
    queue: (paneId, piSessionId) => {
      pending.set(paneId, piSessionId);
      deps.setTimeout(() => drain(paneId), 0);
    },
    notifyHandleRegistered: (paneId) => {
      if (pending.has(paneId)) drain(paneId);
    },
  };
}
