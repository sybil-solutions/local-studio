// Pure HTTP/SSE clients for the agent session endpoints. No React state, no
// component coupling — engine code calls into these and reacts to the results.

import { safeJson } from "@/lib/agent/safe-json";
import {
  parseAgentTurnSsePayload,
  type AgentTurnSsePayload,
  type RuntimeLoggedEvent,
} from "@/lib/agent/session";
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type {
  ComposerExtensionOverride,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";
import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";

export type RuntimeContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  shouldCompact: boolean;
};

export type RuntimeStatus = {
  active?: boolean;
  running?: boolean;
  piSessionId?: string | null;
  modelId?: string | null;
  eventSeq?: number;
  events?: RuntimeLoggedEvent[];
  contextUsage?: RuntimeContextUsage | null;
};

export async function loadRuntimeStatus(
  sessionId: string,
  piSessionId?: string | null,
): Promise<RuntimeStatus | null> {
  try {
    const params = new URLSearchParams({ sessionId });
    if (piSessionId) params.set("piSessionId", piSessionId);
    const response = await fetch(`/api/agent/runtime/status?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await safeJson<{
      status?: {
        active?: boolean;
        running?: boolean;
        piSessionId?: string | null;
        modelId?: string | null;
        eventSeq?: number;
        contextUsage?: RuntimeContextUsage | null;
      };
      events?: RuntimeLoggedEvent[];
    }>(response);
    return payload.status ? { ...payload.status, events: payload.events ?? [] } : null;
  } catch {
    return null;
  }
}

export async function abortSession(sessionId: string): Promise<void> {
  await fetch("/api/agent/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => undefined);
}

export type CanonicalSessionResult = {
  events: Record<string, unknown>[];
};

export async function loadCanonicalSession(
  piSessionId: string,
  cwd: string,
): Promise<CanonicalSessionResult> {
  const response = await fetch(
    `/api/agent/sessions/${encodeURIComponent(piSessionId)}?cwd=${encodeURIComponent(cwd)}`,
    { cache: "no-store" },
  );
  const payload = await safeJson<{ events?: Record<string, unknown>[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load session");
  return { events: payload.events ?? [] };
}

export type CompactSessionArgs = {
  sessionId: string;
  modelId: string;
  cwd?: string;
  piSessionId?: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  canvasEnabled?: boolean;
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  extensionOverrides?: ComposerExtensionOverride[];
};

export type CompactSessionResult = {
  status?: { piSessionId?: string | null };
};

export async function compactSession(args: CompactSessionArgs): Promise<CompactSessionResult> {
  const response = await fetch("/api/agent/compact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await safeJson<{
    error?: string;
    status?: { piSessionId?: string | null };
  }>(response);
  if (!response.ok) throw new Error(payload.error || "Compaction failed");
  return payload;
}

export type SubmitTurnArgs = {
  sessionId: string;
  modelId: string;
  message: string;
  images?: AgentImageInput[];
  cwd?: string;
  piSessionId?: string | null;
  /** Control mode for steer/follow-up; omitted for a normal prompt. */
  mode?: "steer" | "follow_up";
  browserToolEnabled: boolean;
  browserSessionId?: string;
  canvasEnabled?: boolean;
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  extensionOverrides?: ComposerExtensionOverride[];
};

/**
 * POST /api/agent/turn and stream the SSE response, invoking `onPayload` for
 * each parsed chunk. Resolves when the stream completes; throws on transport
 * or HTTP errors. Caller is responsible for status updates / error rendering.
 */
export async function submitTurnStream(
  args: SubmitTurnArgs,
  onPayload: (payload: AgentTurnSsePayload) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const response = await fetch("/api/agent/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Agent request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (options.signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const payload = parseAgentTurnSsePayload(line);
      if (options.signal?.aborted) break;
      if (payload) {
        traceAgentReasoning("client.sse.payload", payload);
        onPayload(payload);
      }
    }
  }
}

/**
 * Subscribe to the runtime's per-session event stream. Returns an
 * unsubscribe function that closes the EventSource. Callers handle `onError`
 * (e.g. probe runtime status to see if the session still exists).
 */
export type RuntimeEventPayload =
  | { type: "status"; phase: string; session?: { piSessionId?: string | null } }
  | { type: "pi"; seq?: number; event: Record<string, unknown> };

export type RuntimeEventSubscription = { close: () => void };

export function subscribeRuntimeEvents(
  sessionId: string,
  after: number,
  piSessionId: string | null | undefined,
  handlers: {
    onPayload: (payload: RuntimeEventPayload) => void;
    onError: () => void;
  },
): RuntimeEventSubscription {
  const params = new URLSearchParams({ sessionId, after: String(after) });
  if (piSessionId) params.set("piSessionId", piSessionId);
  const source = new EventSource(`/api/agent/runtime/events?${params.toString()}`);
  source.onmessage = (event) => {
    let payload: RuntimeEventPayload;
    try {
      payload = JSON.parse(event.data) as RuntimeEventPayload;
    } catch {
      return;
    }
    handlers.onPayload(payload);
  };
  source.onerror = handlers.onError;
  return {
    close: () => {
      source.close();
    },
  };
}
