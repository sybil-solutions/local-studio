import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentImageInput } from "../../../shared/agent/agent-image-input";
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

export type PiPromptOptions = {
  streamingBehavior?: "steer" | "followUp";
  images?: AgentImageInput[];
  expandPromptTemplates?: boolean;
  source?: "interactive" | "rpc" | "extension";
  preflightResult?: (success: boolean) => void;
  restartOnContinuationError?: boolean;
};

export type PiDurablePromptMarker = {
  dispatchId: string;
  messageId: string;
  contentHash: string;
};

export type PiDurablePromptBoundary = {
  dispatchId: string;
  markerEntryId: string;
  userEntryId: string;
  piSessionId: string;
  sessionFile: string;
  cwd: string;
  modelId: string;
  acceptedAt: string;
};

// Re-exported from the canonical Effect-schema-derived type in runtime-schema.ts
// so all context-usage shapes resolve to one source of truth.
export type { RuntimeContextUsage as PiContextUsage } from "../../../shared/agent/context-usage";

export type PiAgentStatus = {
  running: boolean;
  active: boolean;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  contextUsage: import("../../../shared/agent/context-usage").RuntimeContextUsage | null;
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
    options?: PiPromptOptions,
  ): Promise<void>;
  promptDurably(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    marker: PiDurablePromptMarker,
    options?: PiPromptOptions,
  ): Promise<PiDurablePromptBoundary>;
  steer(message: string, images?: AgentImageInput[]): Promise<void>;
  followUp(message: string, images?: AgentImageInput[]): Promise<void>;
  abort(): Promise<void>;
  compact(customInstructions?: string): Promise<unknown>;
  stop(): Promise<void>;
  readonly status: PiAgentStatus;
  getEventsAfter(seq: number): LoggedPiEvent[];
  onLoggedEvent(listener: (event: LoggedPiEvent) => void): () => void;
  adoptPiSessionId(piSessionId: string | null | undefined): void;
  respondExtensionUi(
    requestId: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): boolean;
}

export type { RuntimeStartOptions };
