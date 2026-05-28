import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { SessionSummary } from "@/lib/agent/session-summary";
import type { Project as ProjectEntry } from "@/lib/agent/projects/types";

export type { SessionSummary } from "@/lib/agent/session-summary";

export type PinnedSession = SessionSummary & { project: ProjectEntry };

export type DirectoryBrowserEntry = {
  name: string;
  path: string;
};

export type DirectoryBrowserPayload = {
  path: string;
  parent: string | null;
  home: string;
  entries: DirectoryBrowserEntry[];
  error?: string;
};

export type ActiveAgentSession = ActiveAgentSessionSnapshot;
