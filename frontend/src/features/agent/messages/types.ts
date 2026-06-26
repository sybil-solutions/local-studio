import type { ComposerPluginRef, ComposerSkillRef } from "@/features/agent/composer-context";

// Imperative handle exposed by ChatPane so the workspace can replay a past
// pi session into the focused pane without prop-plumbing indirection. The
// workspace calls this directly from event/click handlers so the control flow
// is auditable in one place.
export type ChatPaneHandle = {
  loadAndReplay: (piSessionId: string) => Promise<void>;
  compact: () => Promise<void>;
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

export type ChatMessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path?: string;
  mode: "text" | "data-url" | "metadata";
  content: string;
  previewKind?: "image" | "video" | "audio" | "pdf" | "file";
  previewUrl?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatMessageAttachment[];
  skills?: ComposerSkillRef[];
  blocks?: AssistantBlock[];
  // Transient streaming state: one accumulated pi content snapshot per LLM call
  // of the in-flight turn. `blocks` are rebuilt from this each frame. Cleared
  // when the turn ends; not meant for persistence.
  streamCalls?: Array<Array<Record<string, unknown>>>;
  // A steer message optimistically shown in the transcript before Pi has
  // injected it into the running turn. Rendered dimmed until the runtime echoes
  // it back (the model is now seeing it), at which point this clears. Transient
  // UI state, never persisted.
  pending?: boolean;
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
  // call; "follow_up" is queued inside Pi for the next turn. `sent: false`
  // is reserved for local fallback work that Pi did not accept.
  mode: "steer" | "follow_up";
  text: string;
  sent?: boolean;
};

export type SessionTab = {
  id: string;
  // In-memory Pi runtime key. One per tab so tabs can run independent agent
  // sessions instead of sharing a pane-level runtime.
  runtimeSessionId: string;
  // Pi session UUID (null = unstarted, will be assigned by pi when the first
  // turn runs).
  piSessionId: string | null;
  projectId?: string;
  cwd?: string;
  modelId?: string;
  title: string;
  messages: ChatMessage[];
  status: string;
  error: string;
  startedAt?: string;
  input: string;
  tokenStats?: TokenStats;
  contextUsage?: import("@/features/agent/runtime/runtime-schema").RuntimeContextUsage | null;
  activeAssistantId?: string;
  lastEventSeq?: number;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  // Outgoing pending follow-up messages. Drawn as chips above the input until
  // Pi `queue_update` reconciles the canonical queue. Steering messages are
  // sent as immediate control messages and are not surfaced in this queue UI.
  queue?: QueuedMessage[];
};

export type RuntimeLoggedEvent = {
  seq?: number;
  event?: Record<string, unknown>;
};
