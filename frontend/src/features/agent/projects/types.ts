export type ProjectId = string;

// CHATS_PROJECT_ID lives in shared/agent/project-ids.ts so the agent runtime
// package's projects store can share it; re-exported here for frontend callers.
import { CHATS_PROJECT_ID } from "@shared/agent/project-ids";

export { CHATS_PROJECT_ID };

export type Project = {
  id: ProjectId;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
};

export type GitSummary = {
  isRepo: boolean;
  branch?: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};

export function isChatsProject(project: Pick<Project, "id"> | null | undefined): boolean {
  return project?.id === CHATS_PROJECT_ID;
}
