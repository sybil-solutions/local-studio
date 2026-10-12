import path from "node:path";
import { app } from "electron";
import { createProjectsStore, type ProjectEntry, type ProjectRecord } from "./projects-store-core";

export type { ProjectRecord };
export type ProjectListEntry = ProjectEntry;

const store = createProjectsStore({
  projectsFilePath: () => path.join(app.getPath("userData"), "projects.json"),
  chatsProjectId: "chats",
  emptyPathMessage: "Project path is required",
});

export function listProjectsWithMeta(): ProjectListEntry[] {
  return store.listProjects();
}

export function addProject(rawPath: string): ProjectListEntry {
  return store.addProject(rawPath);
}

export function removeProject(id: string): void {
  store.removeProject(id);
}
