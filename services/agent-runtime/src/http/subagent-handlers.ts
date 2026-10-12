//
// HTTP surface for subagents. The pi extension calls these through the
// frontend proxy (the connectors-bridge pattern); the chips UI polls the list
// endpoint.
//
// Every route takes the caller's own pi session id and resolves the run inside
// that parent's bucket, so a session can only reach the children it spawned.
//

import {
  findSubagent,
  listSubagents,
  runSubagent,
  spawnSubagent,
  stopSubagent,
  subagentIsActive,
  subagentReport,
  type SubagentRun,
} from "../subagents";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const stringField = (body: Record<string, unknown> | null, key: string): string =>
  typeof body?.[key] === "string" ? (body[key] as string).trim() : "";

const parentFromQuery = (request: Request): string =>
  new URL(request.url).searchParams.get("piSessionId")?.trim() ?? "";

/** List rows stay cheap: the chips poll this every few seconds, so summaries
 *  never touch the transcript — only the detail route pays that read. The
 *  child's runtime key and cwd stay server-side. */
function runSummary(run: SubagentRun) {
  return {
    id: run.id,
    name: run.name,
    task: run.task,
    status: run.status,
    active: run.status === "running" && subagentIsActive(run),
    piSessionId: run.piSessionId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error ?? null,
  };
}

function runView(run: SubagentRun) {
  const report = subagentReport(run);
  return { ...runSummary(run), error: run.error ?? report.error, report: report.text };
}

export async function handleSubagentsList(request: Request): Promise<Response> {
  const parent = parentFromQuery(request);
  if (!parent) return jsonError("piSessionId is required.");
  return Response.json({ subagents: listSubagents(parent).map(runSummary) });
}

export async function handleSubagentGet(request: Request, runId: string): Promise<Response> {
  const parent = parentFromQuery(request);
  if (!parent) return jsonError("piSessionId is required.");
  const run = findSubagent(parent, runId);
  if (!run) return jsonError(`No subagent "${runId}" was spawned by this session.`, 404);
  return Response.json({ ok: true, subagent: runView(run) });
}

export async function handleSubagentStop(request: Request, runId: string): Promise<Response> {
  const parent = stringField(await readJsonBody(request), "piSessionId");
  if (!parent) return jsonError("Body must include piSessionId.");
  try {
    return Response.json({ ok: true, subagent: runView(await stopSubagent(parent, runId)) });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not stop the subagent."), 404);
  }
}

export async function handleSubagentRun(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const parentPiSessionId = stringField(body, "parentPiSessionId");
  const name = typeof body?.name === "string" ? body.name : "";
  const task = typeof body?.task === "string" ? body.task : "";
  if (!parentPiSessionId || !task.trim()) {
    return jsonError("Body must include parentPiSessionId and task.");
  }
  const input = {
    parentPiSessionId,
    name,
    task,
    ...(typeof body?.modelId === "string" ? { modelId: body.modelId } : {}),
  };
  try {
    // wait:false answers as soon as the child is prompting; the caller polls
    // the detail route for the report. The awaited form stays for callers
    // whose runs fit inside the HTTP hops' ~5-minute header timeout.
    if (body?.wait === false) {
      const { run, completion } = await spawnSubagent(input);
      completion.catch(() => undefined);
      return Response.json({
        ok: true,
        runId: run.id,
        name: run.name,
        piSessionId: run.piSessionId,
      });
    }
    const result = await runSubagent(input);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(errorMessage(error, "Subagent run failed."), 500);
  }
}
