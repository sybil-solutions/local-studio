import { NextRequest, NextResponse } from "next/server";
import { getKittylitterPairingJson } from "../../../../../desktop/logic/kittylitter-pairing";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const result = await getKittylitterPairingJson();
  if (!result.ok || !result.pairingJson) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(
    { pairingJson: result.pairingJson },
    { headers: { "cache-control": "no-store" } },
  );
}
