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
import { errorMessage, jsonError } from "./helpers";

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function handleAutomationsList(): Promise<Response> {
  try {
    return Response.json({ automations: await listAutomations() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list automations."), 500);
  }
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
    const automation = await createAutomation({ name, prompt, modelId, cwd, schedule: body?.schedule });
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
  // Fire-and-forget: the run lands on the automation record when it settles.
  void runAutomationNow(id);
  return Response.json({ ok: true, started: true });
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

const GOAL_STATUS_VALUES: GoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "complete",
  "budget_limited",
];

export async function handleGoalPut(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  try {
    const goal = await writeGoal(piSessionId, {
      ...(typeof body.objective === "string" ? { objective: body.objective } : {}),
      ...(GOAL_STATUS_VALUES.includes(body.status as GoalStatus)
        ? { status: body.status as GoalStatus }
        : {}),
      ...(typeof body.turnBudget === "number" || body.turnBudget === null
        ? { turnBudget: body.turnBudget as number | null }
        : {}),
      ...(body.resetTurns === true ? { turnsUsed: 0 } : {}),
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
