import { NextRequest, NextResponse } from "next/server";
import { CSRF_BOOTSTRAP_HEADER, CSRF_COOKIE } from "@/lib/security/request-boundary";
import packageMetadata from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return NextResponse.json({
    csrfToken:
      request.headers.get(CSRF_BOOTSTRAP_HEADER) ?? request.cookies.get(CSRF_COOKIE)?.value ?? null,
    pi: { sdk: packageMetadata.dependencies["@earendil-works/pi-coding-agent"] },
  });
}
