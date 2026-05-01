import { NextRequest } from "next/server";
import path from "node:path";
import { loadSession } from "@/lib/agent/sessions-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stream the JSONL events as a newline-delimited JSON response so the renderer
// can parse incrementally and feed each event through applyPiEvent without
// holding the entire history in memory at once.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd) return Response.json({ error: "cwd is required" }, { status: 400 });
  if (!path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be absolute" }, { status: 400 });
  }
  if (!id) return Response.json({ error: "session id is required" }, { status: 400 });

  const events = await loadSession(cwd, id);
  return Response.json({ events });
}
