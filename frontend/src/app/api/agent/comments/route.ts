import { NextRequest } from "next/server";
import path from "node:path";
import { addComment, deleteComment, listComments } from "@/lib/agent/comments-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const rel = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!cwd || !rel) {
    return Response.json({ error: "cwd and path are required" }, { status: 400 });
  }
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  try {
    return Response.json({ comments: listComments(cwd, rel) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { cwd?: string; path?: string; line?: number; body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cwd = body.cwd?.trim() ?? "";
  const rel = body.path?.trim() ?? "";
  const line = Number(body.line);
  const text = body.body?.trim() ?? "";
  if (!cwd || !rel || !Number.isFinite(line) || line < 1 || !text) {
    return Response.json({ error: "cwd, path, line, body required" }, { status: 400 });
  }
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  try {
    const comment = addComment(cwd, rel, line, text);
    return Response.json({ comment });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const rel = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!cwd || !rel || !id) {
    return Response.json({ error: "cwd, path, id required" }, { status: 400 });
  }
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  try {
    deleteComment(cwd, rel, id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 },
    );
  }
}
