"use client";

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
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
      if (!cancelled) setGoal(next);
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

/** Verbs that act on a goal that must already exist server-side.
 *
 * A verb only counts when it is the WHOLE argument. Matching the first word
 * meant `/goal clear the build cache` cleared the goal and `/goal resume the
 * migration` only flipped a status — the objective was swallowed with no
 * feedback. `budget` is the exception: it takes one operand. */
const GOAL_STATE_VERBS = new Set(["clear", "pause", "resume"]);

const BUDGET_VERB = /^budget\s+(\d+|off|none)$/i;

type GoalVerb =
  | { kind: "state"; verb: string }
  | { kind: "budget"; turnBudget: number | null }
  | { kind: "objective" };

function parseGoalVerb(args: string): GoalVerb {
  const trimmed = args.trim();
  if (GOAL_STATE_VERBS.has(trimmed.toLowerCase())) {
    return { kind: "state", verb: trimmed.toLowerCase() };
  }
  const budget = BUDGET_VERB.exec(trimmed);
  if (!budget) return { kind: "objective" };
  const operand = budget[1].toLowerCase();
  return {
    kind: "budget",
    turnBudget: operand === "off" || operand === "none" ? null : Number.parseInt(operand, 10),
  };
}

export type GoalComposerApi = {
  /** Bumps on every successful mutation so the composer drawer's goal poll
   *  refreshes immediately instead of waiting out its interval. */
  goalRevision: number;
  /** Backs the `/goal` composer command: returns a message on failure and null
   *  on success, which is the contract the command registry expects. */
  goalAction: (args: string) => Promise<string | null>;
  flushPendingGoal: (piSessionId: string, tabId: string | null) => void;
  goalMode: boolean;
  enterGoalMode: () => void;
  exitGoalMode: () => void;
  goalPlaceholder: string | null;
  /** Returns true when it consumed the submit (goal mode was active). The send
   *  path is bound at submit time because the send flow is built after the
   *  command registry that needs `goalAction`. */
  submitAsGoal: (
    event: FormEvent,
    input: string,
    send: (event: FormEvent) => Promise<void> | void,
  ) => boolean;
  /** Escape leaves goal mode before anything else sees the key. */
  interceptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

/** The composer-facing goal surface: the `/goal` command plus ChatGPT-style
 * goal mode.
 *
 * A brand-new chat has no piSessionId until its first turn response comes back,
 * and every goal write is keyed by that id. Rather than refuse the write — the
 * new-chat composer is the natural place to set a goal — an objective set that
 * early is held here and written by `flushPendingGoal` the moment the session
 * earns its id.
 *
 * That pending objective is keyed by the TAB that queued it. This hook is
 * pane-wide but `flushPendingGoal` fires for whichever session next earns an
 * id, so an unkeyed ref let a `/goal` typed in one tab land on a different
 * tab's session — with resetTurns, which clobbers that session's real goal.
 *
 * Goal mode: selecting /goal with nothing typed flips the composer into a
 * mode — a Target pill, a goal placeholder — and the next submit sets the
 * objective AND dispatches it as the opening turn so the agent starts pursuing
 * immediately. Setting a goal on an idle session used to do nothing until the
 * next message, because the continuation driver only fires on turn-settle. */
export function useGoal({
  piSessionId,
  tabId,
  reportError,
}: {
  piSessionId: string | null;
  tabId: string | null;
  /** Surfaces a failed goal-mode write the way the inline `/goal` path does. */
  reportError: (message: string) => void;
}): GoalComposerApi {
  const [goalRevision, setGoalRevision] = useState(0);
  const [goalMode, setGoalMode] = useState(false);
  const pendingObjectiveRef = useRef<{ tabId: string | null; objective: string } | null>(null);

  const writeObjective = useCallback(async (sessionId: string, objective: string) => {
    await updateSessionGoal(sessionId, { objective, status: "active", resetTurns: true });
    setGoalRevision((value) => value + 1);
  }, []);

  const goalAction = useCallback(
    async (args: string): Promise<string | null> => {
      if (!args)
        return "Usage: /goal <objective> — or /goal pause · resume · clear · budget <n|off>";
      const parsed = parseGoalVerb(args);
      if (!piSessionId) {
        // Nothing to pause, resume, clear or budget before the session exists.
        if (parsed.kind !== "objective")
          return "Send a first message, then set a goal for this session.";
        pendingObjectiveRef.current = { tabId, objective: args };
        return null;
      }
      try {
        if (parsed.kind === "state" && parsed.verb === "clear") {
          await clearSessionGoal(piSessionId);
          setGoalRevision((value) => value + 1);
        } else if (parsed.kind === "state") {
          await updateSessionGoal(piSessionId, {
            status: parsed.verb === "pause" ? "paused" : "active",
          });
          setGoalRevision((value) => value + 1);
        } else if (parsed.kind === "budget") {
          await updateSessionGoal(piSessionId, { turnBudget: parsed.turnBudget });
          setGoalRevision((value) => value + 1);
        } else {
          await writeObjective(piSessionId, args);
        }
        return null;
      } catch {
        return "Failed to update the goal.";
      }
    },
    [piSessionId, tabId, writeObjective],
  );

  const flushPendingGoal = useCallback(
    (sessionId: string, assignedTabId: string | null) => {
      const pending = pendingObjectiveRef.current;
      if (!pending) return;
      // Only the tab that queued the objective may claim this id assignment.
      // Otherwise sending from a second tab writes the first tab's goal onto
      // the second tab's session.
      if (pending.tabId !== assignedTabId) return;
      pendingObjectiveRef.current = null;
      // Keep the objective queued if the write fails so the next id assignment
      // (a retry, a reattach) still lands it.
      void writeObjective(sessionId, pending.objective).catch(() => {
        pendingObjectiveRef.current ??= pending;
      });
    },
    [writeObjective],
  );

  const enterGoalMode = useCallback(() => setGoalMode(true), []);
  const exitGoalMode = useCallback(() => setGoalMode(false), []);

  const submitAsGoal = useCallback(
    (event: FormEvent, input: string, send: (event: FormEvent) => Promise<void> | void) => {
      if (!goalMode) return false;
      event.preventDefault();
      const objective = input.trim();
      if (!objective) return true;
      void goalAction(objective).then((error) => {
        // Without this the composer just swallowed the submit and looked dead.
        if (error) {
          reportError(error);
          return;
        }
        setGoalMode(false);
        // The objective is still the composer text, so the normal send path
        // turns it into the visible opening turn — already goal-steered, since
        // the goal file was written before the prompt left. On a brand-new
        // session the write is deferred until this turn hands back a
        // piSessionId, which still beats the first agent_settled the
        // continuation driver runs on.
        void send(event);
      });
      return true;
    },
    [goalAction, goalMode, reportError],
  );

  const interceptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!goalMode || event.key !== "Escape") return false;
      event.preventDefault();
      setGoalMode(false);
      return true;
    },
    [goalMode],
  );

  return {
    goalRevision,
    goalAction,
    flushPendingGoal,
    goalMode,
    enterGoalMode,
    exitGoalMode,
    goalPlaceholder: goalMode
      ? "Describe your goal — define measurable outcomes for best results"
      : null,
    submitAsGoal,
    interceptKeyDown,
  };
}
