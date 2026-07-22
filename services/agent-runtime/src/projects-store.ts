import path from "node:path";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { CHATS_PROJECT_ID } from "../../../shared/agent/project-ids";
// Shared implementation lives under frontend/desktop/ because the desktop
// build (tsc rootDir = desktop/) cannot import from frontend/src/.
import {
  createProjectsStore,
  type ProjectEntry,
} from "../../../frontend/desktop/logic/projects-store-core";

export type { ProjectEntry };

function projectsFilePath(): string {
  if (process.env.LOCAL_STUDIO_PROJECTS_FILE) return process.env.LOCAL_STUDIO_PROJECTS_FILE;
  // Anchor at <repo>/data/agentfs/projects.json (mirror existing agentfs pattern).
  return path.resolve(process.cwd(), "..", "data", "agentfs", "projects.json");
}

const store = createProjectsStore({
  projectsFilePath,
  chatsProjectId: CHATS_PROJECT_ID,
  emptyPathMessage: "path is required",
});

export function listProjectsFromStore(): ProjectEntry[] {
  return store.listProjects();
}

export function addProjectToStore(rawPath: string): ProjectEntry {
  return store.addProject(resolveAllowedWorkspace(rawPath));
}

export function removeProjectFromStore(id: string): void {
  store.removeProject(id);
}

function canonicalDirectory(rawPath: string): string {
  const resolved = realpathSync.native(rawPath);
  if (!statSync(resolved).isDirectory()) throw new Error(`Path is not a directory: ${rawPath}`);
  return resolved;
}

export function allowedWorkspaceRoots(): string[] {
  const configured = process.env.WORKSPACE_ROOTS?.split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const roots = configured?.length ? configured : [homedir()];
  return [...new Set(roots.map(canonicalDirectory))];
}

export function resolveAllowedWorkspace(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("path is required");
  const candidate = canonicalDirectory(trimmed);
  const allowed = allowedWorkspaceRoots().some((root) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error("Path is outside WORKSPACE_ROOTS");
  return candidate;
}
