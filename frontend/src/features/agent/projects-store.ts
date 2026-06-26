import path from "node:path";
import { CHATS_PROJECT_ID } from "@/features/agent/projects/types";
// Shared implementation lives under desktop/ because the desktop build
// (tsc rootDir = desktop/) cannot import from src/.
import { createProjectsStore, type ProjectEntry } from "../../../desktop/logic/projects-store-core";

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
  return store.addProject(rawPath);
}

export function removeProjectFromStore(id: string): void {
  store.removeProject(id);
}
