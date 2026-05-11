import type { ComposerPluginRef, ComposerSkillRef } from "@/lib/agent/composer-context";

// Imperative handle exposed by ChatPane so the workspace can replay a past
// pi session into the focused pane without going through useEffect-driven
// prop plumbing. The workspace calls this directly from event/click handlers
// so the control flow is auditable in one place.
export type ChatPaneHandle = {
  loadAndReplay: (piSessionId: string) => Promise<void>;
};

export type ToolBlock = {
  kind: "tool";
  id: string;
  name: string;
  status: "running" | "done" | "error";
  // Streaming raw text of the tool-call arguments (assembled from toolcall_delta
  // events, then replaced by the canonical JSON at toolcall_end). For file-write
  // tools, this lets us live-render the file content as the model generates it.
  argsText?: string;
  // Parsed arguments JSON, set at toolcall_end if `argsText` is valid JSON.
  args?: Record<string, unknown>;
  // Tool execution output (separate from args so we can render both).
  resultText?: string;
  // Back-compat single-text field used by legacy renderers / replays.
  text: string;
};

export type TextBlock = { kind: "text"; id: string; text: string };
export type ThinkingBlock = { kind: "thinking"; id: string; text: string };
export type EventBlock = { kind: "event"; id: string; text: string };
export type AssistantBlock = TextBlock | ThinkingBlock | ToolBlock | EventBlock;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  blocks?: AssistantBlock[];
  timestamp?: string;
};

export type TokenStats = {
  read: number;
  write: number;
  current: number;
};

export type QueuedMessage = {
  id: string;
  // "steer" interrupts the current turn between tool runs and the next LLM
  // call; "follow_up" waits until the agent completely finishes.
  mode: "steer" | "follow_up";
  text: string;
  sent?: boolean;
};

export type AgentTurnSsePayload =
  | { type: "status"; phase: string; piSessionId?: string | null }
  | { type: "error"; error: string }
  | { type: "pi"; seq?: number; event: Record<string, unknown> };

export type SessionTab = {
  // Stable id local to this pane, used as a React key for tabs.
  id: string;
  // In-memory PiRpcSession key. One per tab so tabs can run independent pi
  // processes instead of sharing a pane-level runtime.
  runtimeSessionId: string;
  // Pi session UUID (null = unstarted, will be assigned by pi when the first
  // turn runs).
  piSessionId: string | null;
  projectId?: string;
  cwd?: string;
  modelId?: string;
  // Display title — derived from the first user message of the session, or a
  // placeholder while empty.
  title: string;
  messages: ChatMessage[];
  status: string;
  error: string;
  startedAt?: string;
  input: string;
  tokenStats?: TokenStats;
  activeAssistantId?: string;
  lastEventSeq?: number;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  // Outgoing pending messages (steer + follow_up). Drawn as chips above the
  // input. Steers fire immediately; follow-ups wait for `agent_end`.
  queue?: QueuedMessage[];
};

export type RuntimeLoggedEvent = {
  seq?: number;
  event?: Record<string, unknown>;
};
