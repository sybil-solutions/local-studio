//
// Goal continuation driver. Attached to every runtime session; when a turn
// ends on a session whose pi session carries an active goal, it fires a
// continuation prompt after a short idle grace — the Codex safe-boundary
// model — with an anti-spin rule (a continuation turn that made no tool call
// parks the goal) and a turn budget.
//
// Three rules here exist because the alternative silently lied to the user:
//
//  * STOP STOPS. `agent_settled` is emitted from a `finally` inside the SDK, so
//    a user abort settles a turn exactly like a completed one. Reading the
//    settle alone, the driver re-prompted 2s after every Stop — pressing Stop
//    restarted the agent. `markGoalTurnAborted` is called before the abort so
//    the flag is already set whichever way the race lands.
//
//  * OUTCOMES COME FROM THIS TURN. Completion used to be read off the
//    transcript TAIL, which is the last assistant message in the file, not the
//    output of the turn that just ended. A tool-only or aborted turn re-read
//    the previous message, so a freshly re-set goal could be marked complete on
//    its first settle. The driver now accumulates the assistant text of the
//    open turn from its own event stream.
//
//  * A STOPPED PURSUIT SAYS SO. Anti-spin suppression lived in memory while the
//    stored status stayed `active`, so the UI kept reporting "Pursuing goal"
//    over a driver that had given up. Every stop is now a persisted status the
//    UI can render and the user can resume from.
//

import { isAgentSettledEvent } from "../../../shared/agent/pi-events";
import { goalContinuationPrompt, goalOutcomeFromText } from "../../../shared/agent/goal-protocol";
import { isRecord } from "../../../shared/agent/guards";
import type { LoggedPiEvent, PiAgentSession } from "./pi-runtime-types";
import { readGoal, writeGoal, type GoalWritePatch } from "./goals-store";
import { assistantMessageText } from "./session-text";

const CONTINUATION_GRACE_MS = 2000;

type DriverState = {
  sawToolThisTurn: boolean;
  /** Assistant text produced by the turn now settling — never the transcript. */
  assistantText: string;
  lastTurnWasContinuation: boolean;
  aborted: boolean;
  /** Wall clock of the open run, in memory so a runtime restart cannot bank a
   *  run it never watched. The stored `activeRunStartedAt` is for the UI ticker
   *  only. */
  runStartedAtMs: number | null;
  pendingContinuation: boolean;
};

const driverStates = new WeakMap<PiAgentSession, DriverState>();

/** Record that the turn now in flight is being stopped by the user. Call this
 *  BEFORE awaiting `session.abort()`: the settle can land first. */
export function markGoalTurnAborted(session: PiAgentSession): void {
  const state = driverStates.get(session);
  if (state) state.aborted = true;
}

function eventTouchesTools(event: LoggedPiEvent["event"]): boolean {
  const type = typeof event?.type === "string" ? event.type : "";
  return type.includes("tool");
}

/** Assistant text carried by a settled message event, if this is one. */
function assistantTextFromEvent(event: LoggedPiEvent["event"]): string {
  const type = typeof event?.type === "string" ? event.type : "";
  if (type !== "message" && type !== "message_end") return "";
  const message = isRecord(event) ? (event as Record<string, unknown>).message : null;
  if (!isRecord(message) || message.role !== "assistant") return "";
  return assistantMessageText(message.content);
}

async function openGoalRun(session: PiAgentSession): Promise<void> {
  try {
    const piSessionId = session.status.piSessionId;
    if (!piSessionId) return;
    const goal = await readGoal(piSessionId);
    if (!goal || goal.status !== "active") return;
    await writeGoal(piSessionId, { activeRunStartedAt: new Date().toISOString() });
  } catch {
    // The clock is cosmetic; never let it break a turn.
  }
}

/** Snapshot and clear the per-turn state in one place, so no branch below can
 *  leak a flag into the next turn. */
function takeTurn(state: DriverState): {
  aborted: boolean;
  wasContinuation: boolean;
  hadTools: boolean;
  assistantText: string;
  runSeconds: number;
} {
  const runSeconds = state.runStartedAtMs === null ? 0 : (Date.now() - state.runStartedAtMs) / 1000;
  const turn = {
    aborted: state.aborted,
    wasContinuation: state.lastTurnWasContinuation,
    hadTools: state.sawToolThisTurn,
    assistantText: state.assistantText,
    runSeconds,
  };
  state.aborted = false;
  state.lastTurnWasContinuation = false;
  state.sawToolThisTurn = false;
  state.assistantText = "";
  state.runStartedAtMs = null;
  return turn;
}

async function settleGoalAfterTurn(session: PiAgentSession, state: DriverState): Promise<void> {
  const status = session.status;
  const piSessionId = status.piSessionId;
  const turn = takeTurn(state);
  if (!piSessionId) return;
  const goal = await readGoal(piSessionId);
  if (!goal) return;

  // Close the open run first: every branch below writes on top of this, and a
  // goal the user paused mid-run still deserves the seconds it earned.
  const banked = {
    timeUsedSeconds: goal.timeUsedSeconds + turn.runSeconds,
    activeRunStartedAt: null,
  } satisfies GoalWritePatch;
  const settle = (patch: GoalWritePatch) => writeGoal(piSessionId, { ...banked, ...patch });

  if (goal.status !== "active") {
    if (turn.runSeconds > 0 || goal.activeRunStartedAt) await writeGoal(piSessionId, banked);
    return;
  }

  if (turn.aborted || status.lastError) {
    await settle({ status: "paused" });
    return;
  }

  const outcome = goalOutcomeFromText(turn.assistantText);
  if (outcome) {
    await settle({ status: outcome.kind === "complete" ? "complete" : "blocked" });
    return;
  }

  const turnsUsed = goal.turnsUsed + 1;
  if (goal.turnBudget !== null && turnsUsed >= goal.turnBudget) {
    await settle({ turnsUsed, status: "budget_limited" });
    return;
  }
  if (turn.wasContinuation && !turn.hadTools) {
    await settle({ turnsUsed, status: "paused" });
    return;
  }
  await settle({ turnsUsed });
  if (!state.pendingContinuation) scheduleContinuation(session, state, piSessionId);
}

function scheduleContinuation(
  session: PiAgentSession,
  state: DriverState,
  piSessionId: string,
): void {
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
        state.assistantText = "";
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
    assistantText: "",
    lastTurnWasContinuation: false,
    aborted: false,
    runStartedAtMs: null,
    pendingContinuation: false,
  };
  driverStates.set(session, state);
  session.onLoggedEvent((logged) => {
    const type = typeof logged.event?.type === "string" ? logged.event.type : "";
    if (type === "agent_start") {
      state.sawToolThisTurn = false;
      state.assistantText = "";
      state.aborted = false;
      state.runStartedAtMs = Date.now();
      void openGoalRun(session);
      return;
    }
    if (eventTouchesTools(logged.event)) {
      state.sawToolThisTurn = true;
      return;
    }
    state.assistantText += assistantTextFromEvent(logged.event);
    if (isAgentSettledEvent(logged.event)) {
      void settleGoalAfterTurn(session, state);
    }
  });
}
