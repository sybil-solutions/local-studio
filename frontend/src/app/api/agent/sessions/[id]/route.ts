import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { listSessions, loadSession } from "@local-studio/agent-runtime/sessions-store";
import { setSessionArchived } from "@local-studio/agent-runtime/session-metadata-store";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";
import { isRecord } from "@/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseNonNegativeIntParam(request: NextRequest, key: string): number | undefined {
  const raw = request.nextUrl.searchParams.get(key);
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Load a page of the session JSONL. `tail=N` returns only the last N transcript
// messages (snapped to a user-turn boundary) plus a `cursor` byte offset;
// `before=<cursor>` pages to the previous (older) chunk. Paging keeps a
// multi-GB canonical log from being buffered whole into one response.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = requireAbsoluteCwd(request);
  if (result.response) return result.response;
  if (!id) return jsonError("session id is required");

  const tail = parseNonNegativeIntParam(request, "tail");
  const before = parseNonNegativeIntParam(request, "before");
  const { events, cursor, meta } = await loadSession(result.cwd, id, { tail, before });
  return Response.json({ events, cursor, meta });
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

function validatePatchSessionId(id: string): Response | null {
  if (!id) return jsonError("session id is required");
  if (!isValidSessionId(id)) {
    return jsonError("session id is invalid");
  }
  return null;
}

async function readArchivePatchBody(request: NextRequest): Promise<ArchivePatchBody | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  if (!isRecord(body) || typeof body.archived !== "boolean") {
    return jsonError("archived boolean is required");
  }
  return body as ArchivePatchBody;
}

async function resolveArchiveLookup(
  id: string,
  body: ArchivePatchBody,
): Promise<ArchiveLookup | Response> {
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (body.archived && !cwd) {
    return jsonError("cwd is required to archive a session");
  }
  if (!cwd) return { cwd, summary: null };
  const cwdError = validateExistingCwd(cwd);
  if (cwdError) return cwdError;
  const matches = await listSessions(cwd, { ids: [id], includeArchived: true });
  const summary = matches.find((session) => session.id === id) ?? null;
  if (body.archived && !summary) {
    return jsonError("session not found", 404);
  }
  return { cwd, summary };
}

function validateExistingCwd(cwd: string): Response | null {
  if (!path.isAbsolute(cwd)) return jsonError("cwd must be absolute");
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
    return jsonError(errorMessage(error, "Failed to update session archive"), 500);
  }
}
