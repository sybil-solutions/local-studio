import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type { RuntimeStartOptions } from "./pi-runtime-helpers";

// Pi event surface seen by the rest of the app. Upstream consumers
// (`sessions/engine.ts`, `pane-controller.ts`, etc.) duck-type on string event
// names, so we keep the loose index signature for back-compat while widening
// the type to include the SDK's typed union so newer call sites get
// autocompletion and discriminated narrowing where they ask for it.
type PiEvent = (Record<string, unknown> & { type?: string }) | AgentSessionEvent;

export type { AgentSessionEvent };

export type LoggedPiEvent = {
  seq: number;
  event: PiEvent;
  timestamp: string;
};

export type PiContextUsage = {
  /** Estimated context tokens, or null if unknown (e.g. fresh session). */
  tokens: number | null;
  /** Maximum context window for the current model. */
  contextWindow: number;
  /** Percentage of context window consumed, or null if tokens unknown. */
  percent: number | null;
  /** True when the SDK's compaction settings say we're near the limit. */
  shouldCompact: boolean;
};

export type PiAgentStatus = {
  running: boolean;
  active: boolean;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  contextUsage: PiContextUsage | null;
};

export interface PiAgentSession {
  ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options?: RuntimeStartOptions,
  ): Promise<void>;
  prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options?: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] },
  ): Promise<void>;
  steer(message: string, images?: AgentImageInput[]): Promise<void>;
  followUp(message: string, images?: AgentImageInput[]): Promise<void>;
  abort(): Promise<void>;
  compact(customInstructions?: string): Promise<unknown>;
  stop(): Promise<void>;
  readonly status: PiAgentStatus;
  getEventsAfter(seq: number): LoggedPiEvent[];
  onLoggedEvent(listener: (event: LoggedPiEvent) => void): () => void;
  adoptPiSessionId(piSessionId: string | null | undefined): void;
}

export type { RuntimeStartOptions };
