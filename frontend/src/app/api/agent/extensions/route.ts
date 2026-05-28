import { NextResponse } from "next/server";
import { listInstalledExtensions } from "@/lib/agent/pi-packages-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const listing = await listInstalledExtensions();
    return NextResponse.json(listing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list extensions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
