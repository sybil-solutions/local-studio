"use client";

import { useCallback, useRef, useState } from "react";
import { clearSessionGoal, updateSessionGoal } from "@/features/agent/runtime/api";

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

/** Backs the `/goal` composer command.
 *
 * `revision` bumps on every successful mutation so the composer drawer's goal
 * poll refreshes immediately instead of waiting out its interval. The action
 * returns a message on failure and null on success, which is the contract the
 * command registry expects.
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
 * tab's session — with resetTurns, which clobbers that session's real goal. */
export function useGoalCommand(
  piSessionId: string | null,
  tabId: string | null,
): {
  goalRevision: number;
  goalAction: (args: string) => Promise<string | null>;
  flushPendingGoal: (piSessionId: string, tabId: string | null) => void;
} {
  const [goalRevision, setGoalRevision] = useState(0);
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

  return { goalRevision, goalAction, flushPendingGoal };
}
