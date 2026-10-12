import path from "node:path";
import { NextRequest } from "next/server";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { requireApiAccess } from "@/lib/auth/guard";
import { assertWorkspaceRoot } from "@/features/agent/fs-store";
import { jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PR info is read from the `gh` CLI on the host, so this route stacks the same
// guards the terminal/git routes use: the edge middleware already enforced the
// host allowlist; here we re-check the access token and validate cwd against
// workspace-root rules before the request reaches the loopback-only runtime,
// which validates cwd again itself.
function validateCwd(rawCwd: string | null): Response | null {
  const cwd = rawCwd?.trim();
  if (!cwd) return jsonError("cwd is required");
  if (!path.isAbsolute(cwd)) return jsonError("cwd must be an absolute path");
  try {
    assertWorkspaceRoot(path.resolve(cwd));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "cwd is not an allowed workspace", 403);
  }
  return null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const invalid = validateCwd(request.nextUrl.searchParams.get("cwd"));
  if (invalid) return invalid;
  return proxyToAgentRuntime(request);
}
