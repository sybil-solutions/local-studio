import path from "node:path";
import { NextRequest } from "next/server";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { requireApiAccess } from "@/lib/auth/guard";
import { assertWorkspaceRoot } from "@/features/agent/fs-store";
import { jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merging a PR mutates a remote repo, so this route re-checks the access token,
// refuses cross-site callers, and validates the body's cwd against the
// workspace-root rules before the request reaches the loopback-only runtime.
const BODY_LIMIT_BYTES = 64 * 1024;

function denyCrossSite(request: NextRequest): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return Response.json({ error: "Cross-site pull-request access rejected" }, { status: 403 });
  }
  return null;
}

async function validateBody(request: NextRequest): Promise<Response | null> {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const cwd = (body as { cwd?: unknown })?.cwd;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    return jsonError("cwd must be an absolute path");
  }
  try {
    assertWorkspaceRoot(path.resolve(cwd));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "cwd is not an allowed workspace", 403);
  }
  return null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request) ?? denyCrossSite(request);
  if (denied) return denied;
  const invalid = await validateBody(request);
  if (invalid) return invalid;
  return proxyToAgentRuntime(request, { bodyLimitBytes: BODY_LIMIT_BYTES });
}
