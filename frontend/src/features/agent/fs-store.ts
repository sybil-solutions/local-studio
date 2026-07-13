import { existsSync, promises as fs, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { FsEntry } from "@/features/agent/filesystem-types";
import { listProjectsFromStore } from "@local-studio/agent-runtime/projects-store";

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
  ".local-studio",
]);

// Filesystem roots and top-level system directories that must never serve as a
// workspace root — otherwise a caller could set cwd="/" and read "etc/passwd"
// while staying nominally "inside" the root.
const SYSTEM_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
]);

const WINDOWS_SYSTEM_ROOT_PATTERNS = [
  /^[a-z]:\\windows$/,
  /^[a-z]:\\program files$/,
  /^[a-z]:\\program files \(x86\)$/,
  /^[a-z]:\\programdata$/,
  /^[a-z]:\\users$/,
  /^[a-z]:\\\$recycle\.bin$/,
];

function isSystemRoot(real: string): boolean {
  if (SYSTEM_ROOTS.has(real)) return true;
  if (process.platform !== "win32") return false;
  const normalized = real.toLowerCase().replace(/[\\/]+$/, "");
  if (normalized.startsWith("\\\\")) return true;
  return WINDOWS_SYSTEM_ROOT_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Reject the filesystem root and system directories as workspace roots. Returns
// the symlink-resolved absolute path. Used by the filesystem and terminal
// routes before any read/list/exec against a caller-supplied cwd.
export function assertWorkspaceRoot(rootCwd: string): string {
  const resolved = path.resolve(rootCwd);
  const real = (() => {
    try {
      return realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  })();
  if (isSystemRoot(real) || real === path.parse(real).root) {
    throw new Error("Path is not an allowed workspace root");
  }
  return real;
}

function resolveRealPath(candidate: string): string {
  try {
    return realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

// Trust boundary: agent filesystem list/read operates inside the caller's
// current workspace cwd, while still rejecting filesystem roots and system
// directories. Registered projects remain accepted, but exact registration is
// not required: sessions may run from the repo opened by the app, a project
// subdirectory, or a newly selected cwd before the project registry refreshes.
function resolveWorkspaceRoot(cwd: string): string {
  const requestedReal = resolveRealPath(cwd);
  for (const project of listProjectsFromStore()) {
    if (!project.exists) continue;
    const projectReal = resolveRealPath(project.path);
    if (projectReal === requestedReal) return projectReal;
  }
  return assertWorkspaceRoot(requestedReal);
}

// Reject any path that escapes the project root, resolving symlinks on both the
// root and the target so a symlink inside the root cannot point outside it.
function ensureInside(rootCwd: string, target: string): string {
  const realRoot = assertWorkspaceRoot(rootCwd);
  let realTarget: string;
  try {
    realTarget = realpathSync.native(target);
  } catch {
    // Target may not exist yet; fall back to a lexical resolution.
    realTarget = path.resolve(target);
  }
  const rel = path.relative(realRoot, realTarget);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error("Path escapes project root");
  }
  return realTarget;
}

export function listDirectory(rootCwd: string, relPath: string): FsEntry[] {
  const root = resolveWorkspaceRoot(rootCwd);
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
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    entries.push({
      name,
      path: abs,
      rel: path.relative(root, abs),
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
  const root = resolveWorkspaceRoot(rootCwd);
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

export async function writeFileContent(
  rootCwd: string,
  relPath: string,
  content: string,
): Promise<void> {
  const root = resolveWorkspaceRoot(rootCwd);
  const target = ensureInside(root, path.resolve(root, relPath));
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error("Not a file");
  await fs.writeFile(target, content, "utf8");
}
