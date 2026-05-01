import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { listDirectory } from "@/lib/agent/fs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!cwd) return Response.json({ error: "cwd is required" }, { status: 400 });
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  if (!existsSync(cwd)) return Response.json({ error: "cwd not found" }, { status: 404 });
  try {
    const entries = listDirectory(cwd, relPath);
    return Response.json({ entries });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "List failed" },
      { status: 400 },
    );
  }
}
