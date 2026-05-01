import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { deleteSession, listSessions } from "@/lib/agent/sessions-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSince(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return new Date(Date.now() - amount * multiplier);
}

export async function GET(request: NextRequest) {
  const cwdParam = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = parseSince(sinceParam);
  if (!cwdParam) return Response.json({ error: "cwd is required" }, { status: 400 });
  if (sinceParam && !since) {
    return Response.json({ error: "since must use a relative value like 7d" }, { status: 400 });
  }
  if (!path.isAbsolute(cwdParam)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  if (!existsSync(cwdParam) || !statSync(cwdParam).isDirectory()) {
    return Response.json({ sessions: [] });
  }
  const sessions = await listSessions(cwdParam, since ? { since } : undefined);
  return Response.json({ sessions });
}

export async function DELETE(request: NextRequest) {
  const cwdParam = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const idParam = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!cwdParam) return Response.json({ error: "cwd is required" }, { status: 400 });
  if (!idParam) return Response.json({ error: "id is required" }, { status: 400 });
  if (!path.isAbsolute(cwdParam)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  if (!existsSync(cwdParam) || !statSync(cwdParam).isDirectory()) {
    return Response.json({ error: "cwd not found" }, { status: 404 });
  }
  const deleted = await deleteSession(cwdParam, idParam);
  return Response.json({ ok: true, deleted });
}
