import { NextRequest, NextResponse } from "next/server";
import { discoverPlugins } from "@/lib/agent/plugin-discovery";
import { buildPluginsResponse } from "@/lib/agent/plugin-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "1";
  return NextResponse.json(buildPluginsResponse(discoverPlugins(), { includeDisabled }));
}
