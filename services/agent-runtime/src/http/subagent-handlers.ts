//
// HTTP surface for subagents. The pi `subagent` tool extension calls the run
// endpoint through the frontend proxy (the connectors-bridge pattern); the
// chips UI polls the list endpoint.
//

import { listSubagents, runSubagent } from "../subagents";
import { errorMessage, jsonError } from "./helpers";

export async function handleSubagentsList(request: Request): Promise<Response> {
  const parent = new URL(request.url).searchParams.get("piSessionId")?.trim();
  if (!parent) return jsonError("piSessionId is required.");
  return Response.json({ subagents: listSubagents(parent) });
}

export async function handleSubagentRun(request: Request): Promise<Response> {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = (await request.json()) as unknown;
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    body = null;
  }
  const parentPiSessionId = typeof body?.parentPiSessionId === "string" ? body.parentPiSessionId : "";
  const name = typeof body?.name === "string" ? body.name : "";
  const task = typeof body?.task === "string" ? body.task : "";
  if (!parentPiSessionId || !task.trim()) {
    return jsonError("Body must include parentPiSessionId and task.");
  }
  try {
    const result = await runSubagent({
      parentPiSessionId,
      name,
      task,
      ...(typeof body?.modelId === "string" ? { modelId: body.modelId } : {}),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(errorMessage(error, "Subagent run failed."), 500);
  }
}
