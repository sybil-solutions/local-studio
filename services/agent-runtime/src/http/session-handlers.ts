import path from "node:path";
import type { AggregatedSession } from "../../../../shared/agent/session-summary";
import { listProjectsFromStore, resolveAllowedWorkspace } from "../projects-store";
import { listArchivedSessionMetadata, setSessionArchived } from "../session-metadata-store";
import { listSessions, loadSession } from "../sessions-store";
import { errorMessage, jsonError } from "./helpers";

function parseRelativeSince(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = match[2] === "d" ? 86_400_000 : match[2] === "h" ? 3_600_000 : 60_000;
  return new Date(Date.now() - amount * multiplier);
}

function archiveOptions(searchParams: URLSearchParams) {
  const archived = searchParams.get("archived")?.toLowerCase();
  const includeArchived = searchParams.get("includeArchived")?.toLowerCase();
  return {
    ...(includeArchived === "1" || includeArchived === "true" ? { includeArchived: true } : {}),
    ...(archived === "1" || archived === "true" || archived === "only"
      ? { archivedOnly: true, includeArchived: true }
      : {}),
  };
}

function positiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function idsFrom(searchParams: URLSearchParams): string[] | undefined {
  return searchParams
    .get("ids")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function existingWorkspace(value: string): string | Response {
  if (!path.isAbsolute(value)) return jsonError("cwd must be absolute");
  try {
    return resolveAllowedWorkspace(value);
  } catch (error) {
    return jsonError(errorMessage(error, "cwd is not allowed"), 403);
  }
}

export async function handleSessionsList(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const cwdParam = searchParams.get("cwd")?.trim() ?? "";
  if (!cwdParam) return jsonError("cwd is required");
  const cwd = existingWorkspace(cwdParam);
  if (cwd instanceof Response) return cwd;
  const limitValue = searchParams.get("limit");
  const limit = positiveInteger(limitValue);
  if (limitValue !== null && limit === undefined) return jsonError("limit must be a positive integer");
  const sinceValue = searchParams.get("since");
  const since = parseRelativeSince(sinceValue);
  if (sinceValue && !since) return jsonError("since must use a relative value like 7d");
  const sessions = await listSessions(cwd, {
    ...(since ? { since } : {}),
    ...(limit ? { limit } : {}),
    ids: idsFrom(searchParams),
    ...archiveOptions(searchParams),
  });
  return Response.json({ sessions });
}

export async function handleAllSessions(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const since = parseRelativeSince(searchParams.get("since")) ?? undefined;
  const archive = archiveOptions(searchParams);
  const aggregated: AggregatedSession[] = [];
  const seenIds = new Set<string>();
  await Promise.all(listProjectsFromStore().map(async (project) => {
    try {
      const cwd = resolveAllowedWorkspace(project.path);
      const sessions = await listSessions(cwd, {
        ...(since && !archive.archivedOnly ? { since } : {}),
        ids: idsFrom(searchParams),
        ...archive,
      });
      for (const summary of sessions) {
        seenIds.add(summary.id);
        aggregated.push({
          ...summary,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
        });
      }
    } catch {
      return;
    }
  }));
  if (archive.archivedOnly) {
    for (const metadata of listArchivedSessionMetadata()) {
      if (seenIds.has(metadata.id)) continue;
      aggregated.push({
        id: metadata.id,
        filename: "",
        cwd: metadata.cwd ?? "",
        startedAt: metadata.sessionUpdatedAt ?? metadata.archivedAt ?? metadata.updatedAt ?? "",
        updatedAt: metadata.sessionUpdatedAt ?? metadata.updatedAt ?? metadata.archivedAt ?? "",
        modelId: null,
        provider: null,
        firstUserMessage: metadata.title,
        archived: true,
        archivedAt: metadata.archivedAt,
        parentSessionId: null,
        subagentName: null,
        projectId: metadata.projectId ?? "",
        projectName: metadata.projectName ?? "Unknown project",
        projectPath: metadata.cwd ?? "",
      });
    }
  }
  aggregated.sort((a, b) =>
    new Date(b.startedAt || b.updatedAt).getTime() - new Date(a.startedAt || a.updatedAt).getTime());
  return Response.json({ sessions: aggregated });
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

export async function handleSessionGet(request: Request, id: string): Promise<Response> {
  if (!validSessionId(id)) return jsonError("session id is invalid");
  const searchParams = new URL(request.url).searchParams;
  const cwdValue = searchParams.get("cwd")?.trim() ?? "";
  if (!cwdValue) return jsonError("cwd is required");
  const cwd = existingWorkspace(cwdValue);
  if (cwd instanceof Response) return cwd;
  const tail = nonNegativeInteger(searchParams.get("tail"));
  const before = nonNegativeInteger(searchParams.get("before"));
  const { events, cursor, meta } = await loadSession(cwd, id, { tail, before });
  return Response.json({ events, cursor, meta });
}

function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function handleSessionPatch(request: Request, id: string): Promise<Response> {
  if (!validSessionId(id)) return jsonError("session id is invalid");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.archived !== "boolean") return jsonError("archived boolean is required");
  const cwdValue = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (body.archived && !cwdValue) return jsonError("cwd is required to archive a session");
  let cwd = "";
  let summary: Awaited<ReturnType<typeof listSessions>>[number] | null = null;
  if (cwdValue) {
    const resolved = existingWorkspace(cwdValue);
    if (resolved instanceof Response) return resolved;
    cwd = resolved;
    summary = (await listSessions(cwd, { ids: [id], includeArchived: true }))
      .find((session) => session.id === id) ?? null;
    if (body.archived && !summary) return jsonError("session not found", 404);
  }
  try {
    const archiveState = await setSessionArchived(id, body.archived, new Date(), {
      cwd: summary?.cwd ?? cwd,
      title: summary?.firstUserMessage ?? optionalString(body, "title"),
      projectId: optionalString(body, "projectId"),
      projectName: optionalString(body, "projectName"),
      sessionUpdatedAt: summary?.updatedAt ?? null,
    });
    return Response.json({ session: { id, ...archiveState } });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update session archive"), 500);
  }
}

export function handleSessionsDelete(): Response {
  return jsonError("Session deletion is disabled. Archive sessions from the UI instead.", 405);
}
