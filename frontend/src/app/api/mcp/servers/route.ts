import { NextRequest, NextResponse } from "next/server";
import { handleMcpAction, mcpSnapshot } from "@/lib/agent/mcp/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "1";
  return NextResponse.json(mcpSnapshot(includeDisabled));
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const result = handleMcpAction(body);
  return NextResponse.json(result.payload, { status: result.status });
}
