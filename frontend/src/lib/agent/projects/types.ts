export type ProjectId = string;

export const CHATS_PROJECT_ID = "chats";

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
  branch: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};

export function isChatsProject(project: Pick<Project, "id"> | null | undefined): boolean {
  return project?.id === CHATS_PROJECT_ID;
}
