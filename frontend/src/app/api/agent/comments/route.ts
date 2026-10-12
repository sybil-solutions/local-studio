import { NextRequest } from "next/server";
import path from "node:path";
import { addComment, deleteComment, listComments } from "@/features/agent/comments-store";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const rel = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!cwd || !rel) {
    return jsonError("cwd and path are required");
  }
  if (!path.isAbsolute(cwd)) {
    return jsonError("cwd must be absolute");
  }
  try {
    return Response.json({ comments: await listComments(cwd, rel) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed"));
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: { cwd?: string; path?: string; line?: number; body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON");
  }
  const cwd = body.cwd?.trim() ?? "";
  const rel = body.path?.trim() ?? "";
  const line = Number(body.line);
  const text = body.body?.trim() ?? "";
  if (!cwd || !rel || !Number.isFinite(line) || line < 1 || !text) {
    return jsonError("cwd, path, line, body required");
  }
  if (!path.isAbsolute(cwd)) {
    return jsonError("cwd must be absolute");
  }
  try {
    const comment = await addComment(cwd, rel, line, text);
    return Response.json({ comment });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed"));
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const rel = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!cwd || !rel || !id) {
    return jsonError("cwd, path, id required");
  }
  if (!path.isAbsolute(cwd)) {
    return jsonError("cwd must be absolute");
  }
  try {
    await deleteComment(cwd, rel, id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed"));
  }
}
