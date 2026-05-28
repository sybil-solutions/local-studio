import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { findSessionFile, loadSession } from "@/lib/agent/sessions-store";
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return Response.json({ error: "session id is required" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.archived !== "boolean") {
    return Response.json({ error: "archived boolean is required" }, { status: 400 });
  }

  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (cwd) {
    if (!path.isAbsolute(cwd)) {
      return Response.json({ error: "cwd must be absolute" }, { status: 400 });
    }
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return Response.json({ error: "cwd does not exist" }, { status: 404 });
    }
    if (!findSessionFile(cwd, id)) {
      return Response.json({ error: "session not found" }, { status: 404 });
    }
  }

  const archiveState = setSessionArchived(id, body.archived);
  return Response.json({ session: { id, ...archiveState } });
}
