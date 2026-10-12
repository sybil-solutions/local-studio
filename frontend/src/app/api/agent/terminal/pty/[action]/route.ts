import path from "node:path";
import { NextRequest } from "next/server";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { requireApiAccess } from "@/lib/auth/guard";
import { assertWorkspaceRoot } from "@/features/agent/fs-store";
import { jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A live shell is code execution on the host, so this route stacks every guard
// we have: the edge middleware already enforced the host allowlist and (for
// POSTs) CSRF; here we re-check the access token, refuse cross-site callers
// outright (covers the CSRF-exempt GET stream — a cross-site fetch could
// otherwise probe it blind), and validate cwd against workspace-root rules
// before anything reaches the loopback-only agent runtime.

const POST_ACTIONS = new Set(["open", "input", "resize", "close"]);
const BODY_LIMIT_BYTES = 64 * 1024;

function denyCrossSite(request: NextRequest): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    return Response.json({ error: "Cross-site terminal access rejected" }, { status: 403 });
  }
  return null;
}

async function validateOpenBody(request: NextRequest): Promise<Response | null> {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const cwd = (body as { cwd?: unknown })?.cwd;
  if (cwd === undefined || cwd === null || cwd === "") return null;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    return jsonError("cwd must be an absolute path");
  }
  try {
    assertWorkspaceRoot(path.resolve(cwd));
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "cwd is not an allowed workspace",
      403,
    );
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  if (action !== "stream") return jsonError("Unknown action", 404);
  const denied = requireApiAccess(request) ?? denyCrossSite(request);
  if (denied) return denied;
  return proxyToAgentRuntime(request);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
): Promise<Response> {
  const { action } = await context.params;
  if (!POST_ACTIONS.has(action)) return jsonError("Unknown action", 404);
  const denied = requireApiAccess(request) ?? denyCrossSite(request);
  if (denied) return denied;
  if (action === "open") {
    const invalid = await validateOpenBody(request);
    if (invalid) return invalid;
  }
  return proxyToAgentRuntime(request, { bodyLimitBytes: BODY_LIMIT_BYTES });
}
