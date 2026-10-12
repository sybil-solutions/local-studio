import { NextRequest } from "next/server";
import { listDirectory } from "@/features/agent/fs-store";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = requireAbsoluteCwd(request, { mustExist: true });
  if (result.response) return result.response;
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  try {
    const entries = listDirectory(result.cwd, relPath);
    return Response.json({ entries });
  } catch (error) {
    return jsonError(errorMessage(error, "List failed"));
  }
}
