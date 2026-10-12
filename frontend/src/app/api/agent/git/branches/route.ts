import { NextRequest } from "next/server";
import { assertGitCwd, listBranches } from "@/features/agent/git";
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
    return Response.json({ branches: await listBranches(cwd) });
  } catch (err) {
    return jsonError(errorMessage(err, "Failed to list branches"));
  }
}
