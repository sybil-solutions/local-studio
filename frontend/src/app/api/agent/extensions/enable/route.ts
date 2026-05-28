import { NextRequest, NextResponse } from "next/server";
import { setExtensionEnabled } from "@/lib/agent/pi-packages-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnableBody = {
  key?: unknown;
  enabled?: unknown;
};

export async function POST(req: NextRequest) {
  let body: EnableBody;
  try {
    body = (await req.json()) as EnableBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json(
      { error: "`key` is required (package source or extension path)." },
      { status: 400 },
    );
  }
  const enabled = body.enabled !== false; // default to enable
  const overrides = setExtensionEnabled(key, enabled);
  return NextResponse.json({ key, enabled, overrides });
}
