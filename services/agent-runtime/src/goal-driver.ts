//
// Goal continuation driver. Attached to every runtime session; when a turn
// ends on a session whose pi session carries an active goal, it fires a
// continuation prompt after a short idle grace — the Codex safe-boundary
// model — with an anti-spin rule (a continuation turn that made no tool call
// suppresses further auto-continues until the user speaks) and a turn budget.
//

import { isAgentEndEvent } from "../../../shared/agent/pi-events";
import type { LoggedPiEvent, PiAgentSession } from "./pi-runtime-types";
import { readGoal, writeGoal } from "./goals-store";
import { lastAssistantText } from "./session-text";

const CONTINUATION_GRACE_MS = 2000;

export function goalContinuationPrompt(objective: string): string {
  return [
    `Continue working toward the goal: ${objective}.`,
    "Check progress against concrete evidence (files, command output, tests) before deciding.",
    "If the goal is fully achieved, end your reply with GOAL_COMPLETE.",
    "If you cannot make further progress, end your reply with GOAL_BLOCKED and the reason.",
  ].join(" ");
}

type DriverState = {
  sawToolThisTurn: boolean;
  lastTurnWasContinuation: boolean;
  suppressed: boolean;
  pendingContinuation: boolean;
};

function eventTouchesTools(event: LoggedPiEvent["event"]): boolean {
  const type = typeof event?.type === "string" ? event.type : "";
  return type.includes("tool");
}

async function settleGoalAfterTurn(
  session: PiAgentSession,
  state: DriverState,
): Promise<void> {
  const status = session.status;
  const piSessionId = status.piSessionId;
  if (!piSessionId) return;
  const goal = await readGoal(piSessionId);
  if (!goal || goal.status !== "active") {
    state.lastTurnWasContinuation = false;
    return;
  }

  const finishedTurnWasContinuation = state.lastTurnWasContinuation;
  const turnHadTools = state.sawToolThisTurn;
  state.lastTurnWasContinuation = false;

  // A user-driven turn lifts anti-spin suppression.
  if (!finishedTurnWasContinuation) state.suppressed = false;

  if (status.lastError) {
    await writeGoal(piSessionId, { status: "paused" });
    return;
  }

  const finalText = lastAssistantText(status.cwd, piSessionId);
  if (/\bGOAL_COMPLETE\b/.test(finalText)) {
    await writeGoal(piSessionId, { status: "complete" });
    return;
  }
  if (/\bGOAL_BLOCKED\b/.test(finalText)) {
    await writeGoal(piSessionId, { status: "blocked" });
    return;
  }

  const turnsUsed = goal.turnsUsed + 1;
  if (goal.turnBudget !== null && turnsUsed >= goal.turnBudget) {
    await writeGoal(piSessionId, { turnsUsed, status: "budget_limited" });
    return;
  }
  await writeGoal(piSessionId, { turnsUsed });

  // Anti-spin: a continuation that made no tool call suppresses the next one.
  if (finishedTurnWasContinuation && !turnHadTools) {
    state.suppressed = true;
    return;
  }
  if (state.suppressed || state.pendingContinuation) return;

  state.pendingContinuation = true;
  setTimeout(() => {
    void (async () => {
      try {
        const current = session.status;
        if (current.active || current.piSessionId !== piSessionId) return;
        const liveGoal = await readGoal(piSessionId);
        if (!liveGoal || liveGoal.status !== "active") return;
        state.lastTurnWasContinuation = true;
        state.sawToolThisTurn = false;
        await session.prompt(goalContinuationPrompt(liveGoal.objective), () => {});
      } catch {
        // A failed continuation leaves the goal active for the user to resume.
      } finally {
        state.pendingContinuation = false;
      }
    })();
  }, CONTINUATION_GRACE_MS);
}

/** Wire the driver to a runtime session. Called once per session creation. */
export function attachGoalDriver(session: PiAgentSession): void {
  const state: DriverState = {
    sawToolThisTurn: false,
    lastTurnWasContinuation: false,
    suppressed: false,
    pendingContinuation: false,
  };
  session.onLoggedEvent((logged) => {
    const type = typeof logged.event?.type === "string" ? logged.event.type : "";
    if (type === "agent_start") {
      state.sawToolThisTurn = false;
      return;
    }
    if (eventTouchesTools(logged.event)) {
      state.sawToolThisTurn = true;
      return;
    }
    if (isAgentEndEvent(logged.event)) {
      void settleGoalAfterTurn(session, state);
    }
  });
}
