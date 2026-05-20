import { NextRequest } from "next/server";
import { readAgentCanvas, writeAgentCanvas } from "@/lib/agent/canvas-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readAgentCanvas());
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    enabled?: unknown;
    text?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch: { enabled?: boolean; text?: string } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.text === "string") patch.text = body.text;
  return Response.json(await writeAgentCanvas(patch));
}
