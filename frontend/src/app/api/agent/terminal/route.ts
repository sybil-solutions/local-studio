import { exec } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { parseTerminalRunRequest } from "@/lib/agent/contracts/terminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

function assertTerminalCwd(
  input: string | null | undefined,
): { cwd: string; error?: never } | { cwd?: never; error: Response } {
  const requested = input?.trim();
  if (!requested) return { error: Response.json({ error: "cwd is required" }, { status: 400 }) };
  if (!path.isAbsolute(requested))
    return { error: Response.json({ error: "cwd must be absolute" }, { status: 400 }) };
  const cwd = path.resolve(requested);
  try {
    if (!statSync(cwd).isDirectory())
      return { error: Response.json({ error: "cwd is not a directory" }, { status: 400 }) };
  } catch {
    return { error: Response.json({ error: "cwd not found" }, { status: 404 }) };
  }
  return { cwd };
}

export async function POST(request: NextRequest) {
  const { cwd, error } = assertTerminalCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseTerminalRunRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const { stdout, stderr } = await execAsync(parsed.value.command, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    return Response.json({ ok: true, command: parsed.value.command, stdout, stderr, exitCode: 0 });
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return Response.json({
      ok: false,
      command: parsed.value.command,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: typeof error.code === "number" ? error.code : null,
      error: error.message ?? "Command failed",
    });
  }
}
