import { NextRequest, NextResponse } from "next/server";
import { uninstallPackage } from "@/lib/agent/pi-packages-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UninstallBody = {
  source?: unknown;
  local?: unknown;
};

export async function POST(req: NextRequest) {
  let body: UninstallBody;
  try {
    body = (await req.json()) as UninstallBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) {
    return NextResponse.json({ error: "`source` is required." }, { status: 400 });
  }
  const local = body.local === true;
  try {
    const result = await uninstallPackage(source, { local });
    if (!result.removed) {
      return NextResponse.json({ error: `No matching package: ${source}` }, { status: 404 });
    }
    return NextResponse.json({ source, local, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Uninstall failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
