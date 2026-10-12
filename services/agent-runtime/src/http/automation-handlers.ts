//
// HTTP surface for automations (Scheduled) and thread goals. Proxied through
// the Next server like the other runtime handlers.
//

import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  patchAutomation,
} from "../automations-store";
import { runAutomationNow } from "../automation-scheduler";
import { clearGoal, readGoal, writeGoal, type GoalStatus } from "../goals-store";
import { GOAL_STATUSES } from "../../../../shared/agent/session-goal";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

export async function handleAutomationsList(): Promise<Response> {
  try {
    return Response.json({ automations: await listAutomations() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list automations."), 500);
  }
}

/** `targetSessionId` accepts a session id, or null/"" to mean "fresh session
 *  every run"; anything else leaves the stored value alone. */
function targetSessionPatch(value: unknown): { targetSessionId: string | null } | null {
  if (value === null) return { targetSessionId: null };
  if (typeof value !== "string") return null;
  return { targetSessionId: value.trim() || null };
}

export async function handleAutomationCreate(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = typeof body?.name === "string" ? body.name : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  if (!prompt.trim() || !modelId.trim()) {
    return jsonError("Body must include prompt and modelId.");
  }
  try {
    const automation = await createAutomation({
      name,
      prompt,
      modelId,
      cwd,
      schedule: body?.schedule,
      ...(targetSessionPatch(body?.targetSessionId) ?? {}),
    });
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to create automation."), 500);
  }
}

export async function handleAutomationPatch(request: Request, id: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  try {
    const automation = await patchAutomation(id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
      ...(typeof body.modelId === "string" ? { modelId: body.modelId } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
      ...(body.status === "active" || body.status === "paused" ? { status: body.status } : {}),
      ...(typeof body.unread === "boolean" ? { unread: body.unread } : {}),
      ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
      ...(targetSessionPatch(body.targetSessionId) ?? {}),
      // Forgetting the recorded runs is a write like any other, so it rides the
      // same PATCH instead of a second endpoint. `lastRun` has to go with them:
      // it is the same record, and leaving it would repopulate the history on
      // the next read.
      ...(body.clearRuns === true ? { runs: [], lastRun: null, unread: false } : {}),
    });
    if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update automation."), 500);
  }
}

export async function handleAutomationDelete(id: string): Promise<Response> {
  try {
    const removed = await deleteAutomation(id);
    if (!removed) return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to delete automation."), 500);
  }
}

export async function handleAutomationRun(id: string): Promise<Response> {
  const automation = await getAutomation(id);
  if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
  // Awaits the whole run: the automation exists, so a null result can only mean
  // the scheduler is already running it. `automation` carries the recorded run
  // back so a caller does not have to re-list to learn how it went (the tab
  // ignores the extra field and reloads its own list).
  const completed = await runAutomationNow(id);
  return Response.json({ ok: true, started: completed !== null, automation: completed });
}

// ─── Goals ────────────────────────────────────────────────────────────────

function goalSessionId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("piSessionId")?.trim();
  return id || null;
}

export async function handleGoalGet(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  try {
    return Response.json({ goal: await readGoal(piSessionId) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read goal."), 500);
  }
}

export async function handleGoalPut(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  try {
    const goal = await writeGoal(piSessionId, {
      ...(typeof body.objective === "string" ? { objective: body.objective } : {}),
      ...(GOAL_STATUSES.includes(body.status as GoalStatus)
        ? { status: body.status as GoalStatus }
        : {}),
      ...(typeof body.turnBudget === "number" || body.turnBudget === null
        ? { turnBudget: body.turnBudget as number | null }
        : {}),
      // `resetTurns` restarts the whole pursuit — turns, banked time and
      // `createdAt`. Keeping `createdAt` across a re-set objective is what made
      // a goal set a minute ago report itself as days old.
      ...(body.resetTurns === true ? { resetProgress: true } : {}),
    });
    return Response.json({ goal: goal.objective ? goal : null });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update goal."), 500);
  }
}

export async function handleGoalDelete(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  try {
    await clearGoal(piSessionId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to clear goal."), 500);
  }
}
