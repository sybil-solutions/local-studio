import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expandTilde(target: string): string {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/")) return path.join(os.homedir(), target.slice(2));
  return target;
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const target = typeof record.target === "string" ? record.target.trim() : "";
  const from = typeof record.from === "string" ? record.from.trim() : "";
  const previous = typeof record.previous === "string" ? record.previous.trim() : "";

  let next: string;
  if (!target || target === "~") {
    next = os.homedir();
  } else if (target === "-") {
    if (!previous) return Response.json({ ok: false, error: "OLDPWD not set" }, { status: 400 });
    next = previous;
  } else if (target.startsWith("~")) {
    next = expandTilde(target);
  } else if (path.isAbsolute(target)) {
    next = target;
  } else {
    if (!from || !path.isAbsolute(from))
      return Response.json({ ok: false, error: "from must be absolute" }, { status: 400 });
    next = path.resolve(from, target);
  }

  try {
    if (!statSync(next).isDirectory())
      return Response.json({ ok: false, error: `not a directory: ${next}` }, { status: 400 });
  } catch {
    return Response.json(
      { ok: false, error: `no such file or directory: ${next}` },
      {
        status: 404,
      },
    );
  }
  return Response.json({ ok: true, cwd: next });
}
