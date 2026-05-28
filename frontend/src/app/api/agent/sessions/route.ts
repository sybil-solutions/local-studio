import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { listSessions } from "@/lib/agent/sessions-store";

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

function archiveOptions(searchParams: URLSearchParams): {
  includeArchived?: boolean;
  archivedOnly?: boolean;
} {
  const archived = searchParams.get("archived")?.toLowerCase();
  const includeArchived = searchParams.get("includeArchived")?.toLowerCase();
  return {
    ...(includeArchived === "1" || includeArchived === "true" ? { includeArchived: true } : {}),
    ...(archived === "1" || archived === "true" || archived === "only"
      ? { archivedOnly: true, includeArchived: true }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  const cwdParam = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const sinceParam = request.nextUrl.searchParams.get("since");
  const idsParam = request.nextUrl.searchParams.get("ids");
  const since = parseSince(sinceParam);
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;
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
  const sessions = await listSessions(cwdParam, {
    ...(since ? { since } : {}),
    ids,
    ...archiveOptions(request.nextUrl.searchParams),
  });
  return Response.json({ sessions });
}

export async function DELETE() {
  return Response.json(
    { error: "Session deletion is disabled. Archive sessions from the UI instead." },
    { status: 405 },
  );
}
