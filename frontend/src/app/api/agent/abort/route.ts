import { NextRequest, NextResponse } from "next/server";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : "default";
  await piRuntimeManager.getSession(sessionId).abort();
  return NextResponse.json({ ok: true });
}
