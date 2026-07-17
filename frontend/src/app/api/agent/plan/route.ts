import { NextRequest } from "next/server";
import { readAgentPlan, writeAgentPlan } from "@/features/agent/plan-store";
import { requireCallbackOrApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCallbackOrApiAccess(request);
  if (denied) return denied;
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  return Response.json(await readAgentPlan(sessionId));
}

export async function POST(request: NextRequest) {
  const denied = requireCallbackOrApiAccess(request);
  if (denied) return denied;
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const body = (await request.json().catch(() => null)) as {
    markdown?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch: { markdown?: string } = {};
  if (typeof body.markdown === "string") patch.markdown = body.markdown;
  return Response.json(await writeAgentPlan(patch, sessionId));
}
