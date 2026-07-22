//
// Thread-scoped goals (the Codex model): a persistent objective attached to a
// pi session that the runtime keeps pursuing at safe boundaries until it is
// complete, blocked, paused, or out of budget. One JSON per pi session id.
//

import { isRecord } from "../../../shared/agent/guards";
import {
  GOAL_STATUSES,
  type GoalStatus,
  type SessionGoal,
} from "../../../shared/agent/session-goal";
import { createSessionScopedJsonStore } from "./session-json-store";

export type { GoalStatus, SessionGoal };

function normalizeGoal(value: unknown): SessionGoal {
  const record = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  return {
    version: 1,
    objective: typeof record.objective === "string" ? record.objective : "",
    status: GOAL_STATUSES.includes(record.status as GoalStatus)
      ? (record.status as GoalStatus)
      : "active",
    turnBudget:
      typeof record.turnBudget === "number" && record.turnBudget > 0
        ? Math.round(record.turnBudget)
        : null,
    turnsUsed: typeof record.turnsUsed === "number" && record.turnsUsed >= 0 ? record.turnsUsed : 0,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

const store = createSessionScopedJsonStore<SessionGoal>({
  subdir: "goals",
  legacyFile: "goals-legacy.json",
  normalize: normalizeGoal,
});

export async function readGoal(piSessionId: string): Promise<SessionGoal | null> {
  const goal = await store.read(piSessionId);
  return goal.objective ? goal : null;
}

export async function writeGoal(
  piSessionId: string,
  patch: Partial<Omit<SessionGoal, "version" | "updatedAt">>,
): Promise<SessionGoal> {
  return store.write(patch, piSessionId);
}

export async function clearGoal(piSessionId: string): Promise<void> {
  await store.write({ objective: "", status: "active", turnsUsed: 0, turnBudget: null }, piSessionId);
}
