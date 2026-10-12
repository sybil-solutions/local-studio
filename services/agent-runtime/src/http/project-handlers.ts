//
// HTTP surface for the projects list (the directories pinned in the sidebar).
// Moved verbatim from the Next route handlers so a remote runtime's project
// list is the one the UI shows.
//

import {
  addProjectToStore,
  listProjectsFromStore,
  removeProjectFromStore,
  type ProjectEntry,
} from "../projects-store";
import { errorMessage, jsonError } from "./helpers";

export async function handleProjectsList(): Promise<Response> {
  try {
    const projects = listProjectsFromStore();
    return Response.json({ projects });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read projects"), 500);
  }
}

export async function handleProjectAdd(request: Request): Promise<Response> {
  let body: { path?: unknown };
  try {
    body = (await request.json()) as { path?: unknown };
  } catch {
    return jsonError("Invalid JSON body");
  }
  const directoryPath = typeof body.path === "string" ? body.path.trim() : "";
  if (!directoryPath) {
    return jsonError("path is required");
  }
  try {
    const project: ProjectEntry = addProjectToStore(directoryPath);
    return Response.json({ project });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to add project"));
  }
}

export async function handleProjectRemove(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return jsonError("id is required");
  }
  try {
    removeProjectFromStore(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to remove project"), 500);
  }
}
