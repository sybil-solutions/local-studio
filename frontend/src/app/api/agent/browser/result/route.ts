import { NextRequest } from "next/server";
import { browserBridge, type BrowserResult } from "@/lib/agent/browser-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: BrowserResult;
  try {
    body = (await request.json()) as BrowserResult;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body.id !== "string" || typeof body.ok !== "boolean") {
    return Response.json({ ok: false, error: "id and ok are required" }, { status: 400 });
  }
  const handled = browserBridge.resolve(body);
  return Response.json({ ok: handled });
}
