import { promises as fs } from "node:fs";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type FsEntry = {
  name: string;
  path: string;
  rel: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "dist-desktop",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".vllm-studio",
]);

function splitConfiguredRoots(raw: string | undefined): string[] {
  if (!raw) return [path.resolve(os.homedir())];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function realpathIfExists(candidate: string): string | null {
  try {
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function configuredAgentFsRoots(): string[] {
  return splitConfiguredRoots(process.env.VLLM_STUDIO_AGENT_FS_ROOTS);
}

export function isLoopbackHost(host: string | null): boolean {
  const value = host ?? "";
  const hostname = value.startsWith("[")
    ? value.slice(1, value.indexOf("]"))
    : value.split(":")[0]?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isAgentFsRequestAllowed(host: string | null, roots: string[]): boolean {
  const remoteBrowserEnabled = process.env.VLLM_STUDIO_ENABLE_REMOTE_AGENT_FS === "1";
  return isLoopbackHost(host) || (remoteBrowserEnabled && roots.length > 0);
}

export function resolveAllowedWorkingDirectory(input: string, roots: string[]): string | null {
  if (!path.isAbsolute(input)) return null;

  const candidate = realpathIfExists(path.resolve(input));
  if (!candidate) return null;

  const allowedRoots = roots
    .map((root) => realpathIfExists(path.resolve(root)))
    .filter(Boolean) as string[];
  return allowedRoots.some((root) => isWithinRoot(candidate, root)) ? candidate : null;
}

// Reject any path that escapes the allowed project root, including via symlinks.
function ensureInside(rootCwd: string, target: string): string {
  const root = realpathIfExists(rootCwd);
  const resolvedTarget = realpathIfExists(target);
  if (!root || !resolvedTarget || !isWithinRoot(resolvedTarget, root)) {
    throw new Error("Path escapes project root");
  }
  return resolvedTarget;
}

export function listDirectory(rootCwd: string, relPath: string): FsEntry[] {
  const root = ensureInside(rootCwd, rootCwd);
  const target = ensureInside(root, path.resolve(root, relPath || "."));
  if (!existsSync(target)) throw new Error("Not found");
  const stats = statSync(target);
  if (!stats.isDirectory()) throw new Error("Not a directory");

  const names = readdirSync(target);
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (IGNORE_DIRS.has(name)) continue;
    if (name.startsWith(".") && name !== ".env.example") continue;
    const abs = path.join(target, name);
    let resolvedAbs: string;
    let s: ReturnType<typeof statSync>;
    try {
      resolvedAbs = ensureInside(root, abs);
      s = statSync(resolvedAbs);
    } catch {
      continue;
    }
    entries.push({
      name,
      path: resolvedAbs,
      rel: path.relative(root, resolvedAbs),
      kind: s.isDirectory() ? "directory" : "file",
      size: s.isFile() ? s.size : undefined,
      modifiedAt: s.mtime.toISOString(),
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export async function readFileSnippet(
  rootCwd: string,
  relPath: string,
  maxBytes = 5 * 1024 * 1024,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const root = ensureInside(rootCwd, rootCwd);
  const target = ensureInside(root, path.resolve(root, relPath));
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error("Not a file");
  if (stats.size > maxBytes) {
    return { content: "", truncated: true, size: stats.size };
  }
  const buf = await fs.readFile(target);
  // Heuristic: if the buffer contains a NUL byte in the first 8KB, treat as
  // binary and refuse to render text.
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  if (head.includes(0)) {
    return { content: "", truncated: true, size: stats.size };
  }
  return { content: buf.toString("utf-8"), truncated: false, size: stats.size };
}
