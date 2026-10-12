import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight liveness probe for the desktop supervisor's health watchdog. */
export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
