import path from "node:path";
import { existsSync } from "node:fs";
import type { NextRequest } from "next/server";

/** Standard JSON error response used by all app/api routes. */
export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

/** Normalize an unknown thrown value into a message for jsonError. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type CwdResult = { cwd: string; response?: never } | { cwd?: never; response: Response };

/**
 * Read and validate the `cwd` search param shared by the agent fs/session/terminal
 * routes: required, absolute, and (optionally) existing on disk.
 */
export function requireAbsoluteCwd(
  request: NextRequest,
  options: { mustExist?: boolean } = {},
): CwdResult {
  const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd) return { response: jsonError("cwd is required") };
  if (!path.isAbsolute(cwd)) return { response: jsonError("cwd must be absolute") };
  if (options.mustExist && !existsSync(cwd)) return { response: jsonError("cwd not found", 404) };
  return { cwd };
}
