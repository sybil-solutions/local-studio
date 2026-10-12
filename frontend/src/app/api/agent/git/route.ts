import { NextRequest } from "next/server";
import { parseGitAction } from "@/features/agent/contracts";
import { assertGitCwd, loadGitState, runGitAction } from "@/features/agent/git";
import { requireApiAccess } from "@/lib/auth/guard";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { cwd, error } = assertGitCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  try {
    return Response.json(await loadGitState(cwd));
  } catch (err) {
    return jsonError(errorMessage(err, "Git operation failed"));
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { cwd, error } = assertGitCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const action = parseGitAction(body);
  if (!action.ok) return jsonError(action.error);
  try {
    return Response.json(await runGitAction(cwd, action.value));
  } catch (err) {
    return jsonError(errorMessage(err, "Git operation failed"));
  }
}
