"use client";

import { useCallback, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { clearSessionGoal, loadSessionGoal, updateSessionGoal } from "@/features/agent/runtime/api";
import type { SessionGoal, SessionGoalPatch } from "@shared/agent/session-goal";

const POLL_MS = 5000;

export type SessionGoalController = {
  goal: SessionGoal | null;
  /** Last failed mutation, so a dead Pause button says why instead of looking
   *  like nothing happened until the poll snaps the card back. */
  error: string | null;
  patch: (patch: SessionGoalPatch) => Promise<void>;
  clear: () => Promise<void>;
};

/** Single owner of one session's goal: the poll, the mutations, and the error
 *  banner. The strip and the drawer card both read from here, so there is one
 *  request loop and one copy of the state no matter how many surfaces show it.
 *
 * The server is the truth — the driver moves the status between turns without
 * the client asking — so a mutation writes the server's response back rather
 * than guessing, and the poll keeps up with driver-side transitions. */
export function useSessionGoal(
  piSessionId: string | null,
  revision: number,
): SessionGoalController {
  const [goal, setGoal] = useState<SessionGoal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useMountSubscription(() => {
    if (!piSessionId) {
      setGoal(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const next = await loadSessionGoal(piSessionId);
      if (cancelled || !next.ok) return; // a failed poll keeps the last known goal
      setGoal(next.goal);
      // A healthy poll also retires a stale mutation error — nothing else does,
      // so a transient failure used to leave the banner up indefinitely.
      setError(null);
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [piSessionId, revision]);

  const patch = useCallback(
    async (next: SessionGoalPatch) => {
      if (!piSessionId) return;
      try {
        setGoal(await updateSessionGoal(piSessionId, next));
        setError(null);
      } catch {
        setError("Could not update the goal.");
      }
    },
    [piSessionId],
  );

  const clear = useCallback(async () => {
    if (!piSessionId) return;
    try {
      await clearSessionGoal(piSessionId);
      setGoal(null);
      setError(null);
    } catch {
      setError("Could not clear the goal.");
    }
  }, [piSessionId]);

  return { goal, error, patch, clear };
}
