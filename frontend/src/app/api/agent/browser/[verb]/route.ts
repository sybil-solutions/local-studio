import { NextRequest } from "next/server";
import { browserBridge } from "@/lib/agent/browser-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_VERBS = new Set([
  "navigate",
  "get-url",
  "get-text",
  "get-html",
  "screenshot",
  "click",
  "scroll",
  "fill",
]);

export async function POST(request: NextRequest, context: { params: Promise<{ verb: string }> }) {
  const { verb } = await context.params;
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  let payload: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") payload = body;
  } catch {
    // empty body is fine
  }
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (sessionId) {
    const browserPayload = { ...payload };
    delete browserPayload.sessionId;
    payload = browserPayload;
  }
  try {
    const result = await browserBridge.enqueue(verb, payload, sessionId || undefined);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error || "Browser command failed" });
    }
    return Response.json({ ok: true, data: result.data });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Browser bridge error",
    });
  }
}
