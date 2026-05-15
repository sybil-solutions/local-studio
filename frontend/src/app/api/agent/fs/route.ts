import { NextRequest } from "next/server";
import { resolveRegisteredProjectRoot } from "@/lib/agent/fs-access";
import { listDirectory } from "@/lib/agent/fs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  try {
    const root = resolveRegisteredProjectRoot(cwd);
    const entries = listDirectory(root, relPath);
    return Response.json({ entries });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "List failed" },
      { status: 400 },
    );
  }
}
