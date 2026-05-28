import { NextRequest, NextResponse } from "next/server";
import { updatePackages } from "@/lib/agent/pi-packages-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  source?: unknown;
};

export async function POST(req: NextRequest) {
  let body: UpdateBody = {};
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    // Empty body means "update all".
  }
  const source =
    typeof body.source === "string" && body.source.trim() ? body.source.trim() : undefined;
  try {
    const result = await updatePackages(source);
    return NextResponse.json({ source: source ?? null, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
