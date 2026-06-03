import { NextRequest, NextResponse } from "next/server";
import { searchGlamaRegistry } from "@/lib/agent/mcp/glama-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 24);

  try {
    return NextResponse.json(await searchGlamaRegistry({ query, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search MCP registry.";
    return NextResponse.json(
      {
        source: "glama",
        sourceUrl: "https://glama.ai/mcp/servers",
        entries: [],
        error: message,
      },
      { status: 502 },
    );
  }
}
