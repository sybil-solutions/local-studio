import type { OpenAgentSession } from "@/features/agent/session-index";
import type { SessionSummary } from "@/features/agent/session-summary";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";

export type { SessionSummary } from "@/features/agent/session-summary";

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

export type ActiveAgentSession = OpenAgentSession;
