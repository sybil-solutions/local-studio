import type { Project, ProjectId } from "./types";

export function resolveSelectedProjectId(
  current: ProjectId | null,
  projects: readonly Project[],
): ProjectId | null {
  if (current && projects.some((project) => project.id === current)) return current;
  return projects[0]?.id ?? null;
}

export function projectPathById(projects: readonly Project[], projectId: ProjectId | null): string {
  return projects.find((project) => project.id === projectId)?.path ?? "";
}
