import { NextResponse } from "next/server";

export function denyEmbeddedDesktopHttp(): NextResponse | null {
  return process.env.LOCAL_STUDIO_DESKTOP === "1"
    ? NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    : null;
}
