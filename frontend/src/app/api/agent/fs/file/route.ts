import { NextRequest } from "next/server";
import {
  configuredAgentFsRoots,
  isAgentFsRequestAllowed,
  readFileSnippet,
  resolveAllowedWorkingDirectory,
} from "@/lib/agent/fs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedCwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!requestedCwd || !relPath) {
    return Response.json({ error: "cwd and path are required" }, { status: 400 });
  }

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
