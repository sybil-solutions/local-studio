// Sessions are the flat collection of conversations the workspace orchestrates.
// Identity is `SessionId` — the same string a pane stores as `sessionId`. A
// session lives independently of any pane (panes can hold the same session id
// in different layouts; closing a pane doesn't drop session content).

import type { ChatMessage, QueuedMessage, TokenStats } from "@/lib/agent/session/types";
import type { ComposerSkillRef } from "@/lib/agent/composer-context";
import type { RuntimeContextUsage } from "./api";

export type SessionId = string;

export type SessionStatus = "idle" | "starting" | "running" | "loading" | "done" | string;

/**
 * A `Session` is a conversation record — domain content and runtime status,
 * with no tool-selection state. Per-session plugins/skills live in the tools
 * subsystem (`useTools().selectionFor(id)`) keyed by the session id below.
 */
export type Session = {
  id: SessionId;
  runtimeSessionId: string;
  piSessionId: string | null;
  projectId?: string;
  cwd?: string;
  modelId?: string;
  title: string;
  messages: ChatMessage[];
  status: SessionStatus;
  error: string;
  startedAt?: string;
  input: string;
  tokenStats?: TokenStats;
  usedSkills?: ComposerSkillRef[];
  contextUsage?: RuntimeContextUsage | null;
  activeAssistantId?: string;
  lastEventSeq?: number;
  queue?: QueuedMessage[];
};

export type SessionsMap = ReadonlyMap<SessionId, Session>;
