import { NextRequest } from "next/server";
import path from "node:path";
import { readFileSnippet } from "@/lib/agent/fs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!cwd || !relPath) {
    return Response.json({ error: "cwd and path are required" }, { status: 400 });
  }
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  try {
    const data = await readFileSnippet(cwd, relPath);
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Read failed" },
      { status: 400 },
    );
  }
}
