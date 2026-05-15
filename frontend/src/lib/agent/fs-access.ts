import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { listProjectsFromStore } from "@/lib/agent/projects-store";

function normalizeRealPath(candidate: string): string {
  return realpathSync(candidate);
}

export function resolveRegisteredProjectRoot(rawCwd: string): string {
  const cwd = rawCwd.trim();
  if (!cwd) throw new Error("cwd is required");
  if (!path.isAbsolute(cwd)) throw new Error("cwd must be absolute");

  let root: string;
  try {
    const stats = statSync(cwd);
    if (!stats.isDirectory()) throw new Error("cwd must be a directory");
    root = normalizeRealPath(cwd);
  } catch (error) {
    if (error instanceof Error && error.message === "cwd must be a directory") throw error;
    throw new Error("cwd not found");
  }

  const allowedRoots = listProjectsFromStore()
    .filter((project) => project.exists)
    .flatMap((project) => {
      try {
        return [normalizeRealPath(project.path)];
      } catch {
        return [];
      }
    });

  if (!allowedRoots.includes(root)) {
    throw new Error("cwd is not a registered project root");
  }

  return root;
}
