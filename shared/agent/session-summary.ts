export type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  // The most recent user prompt, which is what the recents list sorts and
  // labels by. Optional: absent for sessions whose transcript tail carries no
  // timestamped user turn.
  lastUserPromptText?: string;
  lastUserPromptAt?: string;
  archived: boolean;
  archivedAt: string | null;
  parentSessionId: string | null;
  subagentName: string | null;
};

export type AggregatedSession = SessionSummary & {
  projectId: string;
  projectName: string;
  projectPath: string;
};
