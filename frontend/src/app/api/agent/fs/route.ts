import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import {
  configuredAgentFsRoots,
  isAgentFsRequestAllowed,
  listDirectory,
  resolveAllowedWorkingDirectory,
} from "@/lib/agent/fs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedCwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!requestedCwd) return Response.json({ error: "cwd is required" }, { status: 400 });

  const roots = configuredAgentFsRoots();
  if (!isAgentFsRequestAllowed(request.headers.get("host"), roots)) {
    return Response.json(
      { error: "Agent filesystem browsing is only available locally" },
      { status: 403 },
    );
  }

  const cwd = resolveAllowedWorkingDirectory(requestedCwd, roots);
  if (!cwd) {
    return Response.json({ error: "cwd is outside the allowed directories" }, { status: 403 });
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
