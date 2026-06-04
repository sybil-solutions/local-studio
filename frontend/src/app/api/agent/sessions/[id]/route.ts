import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { listSessions, loadSession } from "@/lib/agent/sessions-store";
import { setSessionArchived } from "@/lib/agent/session-metadata-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream the JSONL events as a newline-delimited JSON response so the renderer
// can parse incrementally and feed each event through applyPiEvent without
// holding the entire history in memory at once.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd) return Response.json({ error: "cwd is required" }, { status: 400 });
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  if (!id) return Response.json({ error: "session id is required" }, { status: 400 });

  const events = await loadSession(cwd, id);
  return Response.json({ events });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidSessionId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function optionalBodyString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type ArchivePatchBody = Record<string, unknown> & { archived: boolean };

type ArchiveSummary = {
  cwd: string;
  firstUserMessage: string | null;
  updatedAt: string;
};

type ArchiveLookup = {
  cwd: string;
  summary: ArchiveSummary | null;
};

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function validatePatchSessionId(id: string): Response | null {
  if (!id) return Response.json({ error: "session id is required" }, { status: 400 });
  if (!isValidSessionId(id)) {
    return Response.json({ error: "session id is invalid" }, { status: 400 });
  }
  return null;
}

async function readArchivePatchBody(request: NextRequest): Promise<ArchivePatchBody | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.archived !== "boolean") {
    return Response.json({ error: "archived boolean is required" }, { status: 400 });
  }
  return body as ArchivePatchBody;
}

async function resolveArchiveLookup(
  id: string,
  body: ArchivePatchBody,
): Promise<ArchiveLookup | Response> {
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (body.archived && !cwd) {
    return Response.json({ error: "cwd is required to archive a session" }, { status: 400 });
  }
  if (!cwd) return { cwd, summary: null };
  const cwdError = validateExistingCwd(cwd);
  if (cwdError) return cwdError;
  const matches = await listSessions(cwd, { ids: [id], includeArchived: true });
  const summary = matches.find((session) => session.id === id) ?? null;
  if (body.archived && !summary) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  return { cwd, summary };
}

function validateExistingCwd(cwd: string): Response | null {
  if (!path.isAbsolute(cwd)) return jsonError("cwd must be absolute", 400);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return jsonError("cwd does not exist", 404);
  }
  return null;
}

function archiveMetadata(body: ArchivePatchBody, lookup: ArchiveLookup) {
  return {
    cwd: lookup.summary?.cwd ?? lookup.cwd,
    title: lookup.summary?.firstUserMessage ?? optionalBodyString(body, "title"),
    projectId: optionalBodyString(body, "projectId"),
    projectName: optionalBodyString(body, "projectName"),
    sessionUpdatedAt: lookup.summary?.updatedAt ?? null,
  };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const idError = validatePatchSessionId(id);
  if (idError) return idError;

  const body = await readArchivePatchBody(request);
  if (body instanceof Response) return body;

  const lookup = await resolveArchiveLookup(id, body);
  if (lookup instanceof Response) return lookup;

  try {
    const archiveState = setSessionArchived(
      id,
      body.archived,
      new Date(),
      archiveMetadata(body, lookup),
    );
    return Response.json({ session: { id, ...archiveState } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update session archive" },
      { status: 500 },
    );
  }
}
