import { NextRequest } from "next/server";
import { searchFiles } from "@/features/agent/fs-store";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const result = requireAbsoluteCwd(request, { mustExist: true });
  if (result.response) return result.response;
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  try {
    const entries = searchFiles(result.cwd, query, limit);
    return Response.json({ entries });
  } catch (error) {
    return jsonError(errorMessage(error, "Search failed"));
  }
}
