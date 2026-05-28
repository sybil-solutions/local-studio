import { NextRequest, NextResponse } from "next/server";
import { installPackage, validatePiPackageSpec } from "@/lib/agent/pi-packages-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstallBody = {
  source?: unknown;
  local?: unknown;
};

export async function POST(req: NextRequest) {
  let body: InstallBody;
  try {
    body = (await req.json()) as InstallBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) {
    return NextResponse.json({ error: "`source` is required." }, { status: 400 });
  }
  const validation = validatePiPackageSpec(source);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason ?? "Invalid source." }, { status: 400 });
  }
  const local = body.local === true;
  try {
    const result = await installPackage(source, { local });
    return NextResponse.json({ source, local, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Install failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
