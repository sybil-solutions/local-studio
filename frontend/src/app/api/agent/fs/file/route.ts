import { NextRequest } from "next/server";
import path from "node:path";
import { readFileSnippet, writeFileContent } from "@/features/agent/fs-store";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!cwd || !relPath) {
    return jsonError("cwd and path are required");
  }
  if (!path.isAbsolute(cwd)) {
    return jsonError("cwd must be absolute");
  }
  try {
    const data = await readFileSnippet(cwd, relPath);
    return Response.json(data);
  } catch (error) {
    return jsonError(errorMessage(error, "Read failed"));
  }
}

export async function PUT(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const relPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!cwd || !relPath) {
    return jsonError("cwd and path are required");
  }
  if (!path.isAbsolute(cwd)) {
    return jsonError("cwd must be absolute");
  }
  try {
    const body = (await request.json()) as { content?: unknown };
    if (typeof body.content !== "string") return jsonError("content must be a string");
    await writeFileContent(cwd, relPath, body.content);
    return Response.json(await readFileSnippet(cwd, relPath));
  } catch (error) {
    return jsonError(errorMessage(error, "Write failed"));
  }
}
