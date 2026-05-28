import { NextRequest } from "next/server";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = request.nextUrl.searchParams.get("piSessionId")?.trim() || null;
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0);
  const resolved = piRuntimeManager.getSessionForLookup(sessionId, piSessionId);
  return Response.json({
    sessionId: resolved.sessionId,
    status: resolved.session.status,
    events: resolved.session.getEventsAfter(Number.isFinite(after) ? after : 0),
  });
}
