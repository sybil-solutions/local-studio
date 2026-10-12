import {
  constants,
  existsSync,
  promises as fs,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
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

// macOS symlinks several of those into /private (/etc → /private/etc, /var →
// /private/var), so matching the literal names alone lets `cwd=/etc` through
// once it is symlink-resolved. Resolve the list once and match against both.
const RESOLVED_SYSTEM_ROOTS = new Set(
  [...SYSTEM_ROOTS].map((entry) => {
    try {
      return realpathSync(entry);
    } catch {
      return entry;
    }
  }),
);

// Reject the filesystem root and system directories as workspace roots. Returns
// the symlink-resolved absolute path. Used by the filesystem and terminal
// routes before any read/list/exec against a caller-supplied cwd.
export function assertWorkspaceRoot(rootCwd: string): string {
  const resolved = path.resolve(rootCwd);
  const real = (() => {
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  })();
  if (
    SYSTEM_ROOTS.has(resolved) ||
    SYSTEM_ROOTS.has(real) ||
    RESOLVED_SYSTEM_ROOTS.has(real) ||
    real === path.parse(real).root
  ) {
    throw new Error("Path is not an allowed workspace root");
  }
  return real;
}

function resolveRealPath(candidate: string): string {
  try {
    return realpathSync(candidate);
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
  const realRoot = realpathSync(assertWorkspaceRoot(rootCwd));
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
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

const SEARCH_MAX_VISITED = 20_000;
const SEARCH_MAX_DEPTH = 12;

// Recursive, query-aware file lookup for the composer's @-mention picker. A
// single-level listing can only offer files sitting directly in the workspace
// root, so every nested file — nearly all of them in a real repo — was
// unreachable. Walks breadth-first (shallow matches first) under the same
// ignore rules as listDirectory, with hard caps so a huge tree cannot stall the
// request. Symlinks are skipped entirely: that keeps the walk inside the root
// and cannot loop, so no per-entry ensureInside is needed.
export function searchFiles(rootCwd: string, query: string, limit = 20): FsEntry[] {
  const root = resolveWorkspaceRoot(rootCwd);
  const q = query.trim().toLowerCase();
  // Basename matches rank above path-segment matches, matching byQuery's idiom.
  const nameMatches: FsEntry[] = [];
  const pathMatches: FsEntry[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && nameMatches.length < limit && visited < SEARCH_MAX_VISITED) {
    const current = queue.shift();
    if (!current) break;
    let names: string[];
    try {
      names = readdirSync(current.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (visited >= SEARCH_MAX_VISITED || nameMatches.length >= limit) break;
      visited += 1;
      if (IGNORE_DIRS.has(name)) continue;
      if (name.startsWith(".") && name !== ".env.example") continue;
      const abs = path.join(current.dir, name);
      let s: ReturnType<typeof lstatSync>;
      try {
        s = lstatSync(abs);
      } catch {
        continue;
      }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) {
        if (current.depth < SEARCH_MAX_DEPTH) queue.push({ dir: abs, depth: current.depth + 1 });
        continue;
      }
      if (!s.isFile()) continue;
      const rel = path.relative(root, abs);
      const nameHit = !q || name.toLowerCase().includes(q);
      const pathHit = !q || rel.toLowerCase().includes(q);
      if (!nameHit && !pathHit) continue;
      const entry: FsEntry = {
        name,
        path: abs,
        rel,
        kind: "file",
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
      };
      if (nameHit) nameMatches.push(entry);
      else pathMatches.push(entry);
    }
  }
  return [...nameMatches, ...pathMatches].slice(0, limit);
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

export async function openReadableFile(
  rootCwd: string,
  relPath: string,
): Promise<{ file: FileHandle; size: number; modifiedAt: Date }> {
  const root = resolveWorkspaceRoot(rootCwd);
  const resolved = path.resolve(root, relPath);
  // The containment proof, stated the way static analysis can follow it:
  // the resolved path relative to the root must not climb out or restart
  // from an absolute location. ensureInside then applies the shared
  // realpath-level guard on top.
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes project root");
  }
  const target = ensureInside(root, resolved);
  const file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Not a file");
    return { file, size: stats.size, modifiedAt: stats.mtime };
  } catch (error) {
    await file.close();
    throw error;
  }
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
