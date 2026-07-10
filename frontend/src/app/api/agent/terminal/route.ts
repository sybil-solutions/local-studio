import { exec } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { parseTerminalRunRequest } from "@/features/agent/contracts";
import { requireApiAccess } from "@/lib/auth/guard";
import { assertWorkspaceRoot } from "@/features/agent/fs-store";
import { errorMessage, jsonError, requireAbsoluteCwd } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

function windowsPosixShell(): string | null {
  const roots = [
    process.env["ProgramFiles"] ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  ];
  return roots.map((root) => path.join(root, "Git", "bin", "bash.exe")).find(existsSync) ?? null;
}

function terminalShell(): string | undefined {
  if (process.platform !== "win32") return undefined;
  return windowsPosixShell() ?? undefined;
}

function assertTerminalCwd(
  request: NextRequest,
): { cwd: string; error?: never } | { cwd?: never; error: Response } {
  const required = requireAbsoluteCwd(request);
  if (required.response) return { error: required.response };
  const cwd = path.resolve(required.cwd);
  try {
    if (!statSync(cwd).isDirectory()) return { error: jsonError("cwd is not a directory") };
  } catch {
    return { error: jsonError("cwd not found", 404) };
  }
  // Refuse to run shell commands rooted at the filesystem root or a system
  // directory, even for an authenticated caller.
  try {
    assertWorkspaceRoot(cwd);
  } catch (err) {
    return { error: jsonError(errorMessage(err, "cwd is not an allowed workspace"), 403) };
  }
  return { cwd };
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { cwd, error } = assertTerminalCwd(request);
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const parsed = parseTerminalRunRequest(body);
  if (!parsed.ok) return jsonError(parsed.error);
  try {
    const shell = terminalShell();
    const { stdout, stderr } = await execAsync(parsed.value.command, {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
      ...(shell ? { shell } : {}),
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
