export type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  archived: boolean;
  archivedAt: string | null;
};

export type AggregatedSession = SessionSummary & {
  projectId: string;
  projectName: string;
  projectPath: string;
};
