import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { listSessions } from "@/lib/agent/sessions-store";
import { archiveQueryOptions, parseRelativeSince } from "./session-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwdParam = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const sinceParam = request.nextUrl.searchParams.get("since");
  const idsParam = request.nextUrl.searchParams.get("ids");
  const since = parseRelativeSince(sinceParam);
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
    ...archiveQueryOptions(request.nextUrl.searchParams),
  });
  return Response.json({ sessions });
}

export async function DELETE() {
  return Response.json(
    { error: "Session deletion is disabled. Archive sessions from the UI instead." },
    { status: 405 },
  );
}
