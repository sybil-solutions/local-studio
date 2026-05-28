import { NextRequest, NextResponse } from "next/server";
import { readExtensionConfig, writeExtensionConfig } from "@/lib/agent/pi-packages-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfigureBody = {
  key?: unknown;
  config?: unknown;
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key")?.trim();
  if (!key) {
    return NextResponse.json({ error: "`key` query param is required." }, { status: 400 });
  }
  return NextResponse.json({ key, config: readExtensionConfig(key) });
}

export async function POST(req: NextRequest) {
  let body: ConfigureBody;
  try {
    body = (await req.json()) as ConfigureBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ error: "`key` is required." }, { status: 400 });
  }
  const config = body.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return NextResponse.json({ error: "`config` must be a JSON object." }, { status: 400 });
  }
  writeExtensionConfig(key, config as Record<string, unknown>);
  return NextResponse.json({ key, config });
}
