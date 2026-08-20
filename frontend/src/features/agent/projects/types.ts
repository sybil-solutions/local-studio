import { Schema } from "effect";
import { CHATS_PROJECT_ID } from "@shared/agent/project-ids";

export { CHATS_PROJECT_ID };

export type ProjectId = string;

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  addedAt: Schema.String,
  exists: Schema.Boolean,
  hasGit: Schema.Boolean,
  branch: Schema.NullOr(Schema.String),
});

export type Project = typeof ProjectSchema.Type;

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
