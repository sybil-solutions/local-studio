import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type { Session } from "@/features/agent/runtime/types";

// Imperative handle exposed by ChatPane so the workspace can replay a past
// pi session into the focused pane without prop-plumbing indirection. The
// workspace calls this directly from event/click handlers so the control flow
// is auditable in one place.
export type ChatPaneHandle = {
  sessionId: string;
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
  // The tool's own structured result payload. pi carries this beside the text
  // on every tool result; the transcript keeps it because some tools identify
  // something the UI can then act on — a subagent returns the run id and pi
  // session id of the child it spawned, which is what lets its row open that
  // session in the side panel.
  details?: Record<string, unknown>;
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
  //
  // PURELY VISUAL. It is cleared at agent_end so a delivered-or-not steer stops
  // reading as stuck-dimmed — which is why the echo matcher must not use it as
  // its dedupe key. Use `awaitingEcho` for that.
  pending?: boolean;
  // This user bubble was inserted optimistically and has not yet been matched
  // to its runtime echo, so an echo carrying the same text is that bubble
  // arriving rather than a new message. Survives agent_end (which can fire
  // several times per prompt via auto-retry and compaction) and is only swept
  // at agent_settled. Transient UI state, never persisted.
  awaitingEcho?: boolean;
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

// A tab holds a plain `Session` — `runtime/types` is the single definition of
// what fields a session record has.
export type SessionTab = Session;

export type RuntimeLoggedEvent = {
  readonly seq?: number;
  readonly event?: Record<string, unknown>;
};
