// Sessions are the flat collection of conversations the workspace orchestrates.
// Identity is `SessionId` — the same string a pane stores as `sessionId`. A
// session lives independently of any pane (panes can hold the same session id
// in different layouts; closing a pane doesn't drop session content).

import type { ChatMessage, QueuedMessage, TokenStats } from "@/features/agent/messages/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type { RuntimeContextUsage } from "@/features/agent/runtime/api";
import type { AgentThinkingLevel, AgentToolAccess } from "@/features/agent/contracts";

// The session identity string — the same value a pane stores as `sessionId`.
export type SessionId = string;

export type SessionStatus = "idle" | "starting" | "running" | "stopping" | "loading";

export type ExtensionUiRequest = {
  requestId: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options?: string[];
};

/**
 * A `Session` is a conversation record — domain content and runtime status,
 * with no tool-selection state. Per-session skills/templates live in the tools
 * subsystem (`useTools().selectionFor(id)`) keyed by the session id below.
 */
export type Session = {
  id: SessionId;
  piSessionId: string | null;
  projectId?: string;
  cwd?: string;
  modelId?: string;
  thinkingLevel?: AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
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
  extensionUiRequest?: ExtensionUiRequest;
  // Byte-offset cursor into the canonical log for paging older history into
  // view ("load earlier"). Set when a tail load left earlier events unread;
  // null/undefined once the whole log is loaded.
  historyCursor?: number | null;
};

export type SessionsMap = ReadonlyMap<SessionId, Session>;

/** Callback used by the runtime engine to commit a patch to a session. */
export type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;
