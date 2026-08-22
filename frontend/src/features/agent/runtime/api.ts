import { Schema } from "effect";
import {
  SessionGoalResponseSchema,
  type SessionGoal,
  type SessionGoalPatch,
} from "@shared/agent/session-goal";
import type { SessionUsageTotals } from "@shared/agent/session-usage";
import { safeJson } from "@/features/agent/safe-json";
import {
  parseAgentTurnCommandResult,
  type AgentTurnCommandResult,
} from "@/features/agent/messages";
import type {
  AgentImageInput,
  AgentQueueAction,
  AgentToolAccess,
} from "@/features/agent/contracts";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";

import {
  decodeRuntimeEventPayload,
  decodeRuntimeSessions,
  decodeRuntimeStatusResponse,
  type RuntimeContextUsage,
  type RuntimeEventPayload,
  type RuntimeSessionSummary,
  type RuntimeStatus,
} from "@/features/agent/runtime/runtime-schema";
export type { RuntimeContextUsage, RuntimeEventPayload, RuntimeSessionSummary, RuntimeStatus };

export function runtimeContextUsage(
  status: RuntimeStatus | null | undefined,
  fallback: RuntimeContextUsage | null | undefined,
): RuntimeContextUsage | null {
  if (status) return status.contextUsage ?? null;
  return fallback ?? null;
}

const AbortSessionResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  cleared: Schema.Struct({
    steering: Schema.Array(Schema.String),
    followUp: Schema.Array(Schema.String),
  }),
});

const decodeAbortSessionResponse = Schema.decodeUnknownOption(AbortSessionResponseSchema, {
  onExcessProperty: "preserve",
});

export type AbortSessionResult = {
  steering: string[];
  followUp: string[];
};

export function parseAbortSessionResult(input: unknown): AbortSessionResult {
  const decoded = decodeAbortSessionResponse(input);
  return decoded._tag === "Some"
    ? {
        steering: [...decoded.value.cleared.steering],
        followUp: [...decoded.value.cleared.followUp],
      }
    : { steering: [], followUp: [] };
}

export async function listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
  try {
    const response = await fetch("/api/agent/runtime/sessions", { cache: "no-store" });
    return decodeRuntimeSessions(await safeJson<unknown>(response));
  } catch {
    return [];
  }
}

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
    const decoded = decodeRuntimeStatusResponse(await safeJson<unknown>(response));
    if (!decoded) return null;
    return { ...decoded.status, events: decoded.events ?? [] };
  } catch {
    return null;
  }
}

export async function abortSession(sessionId: string): Promise<AbortSessionResult> {
  try {
    const response = await fetch("/api/agent/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    return parseAbortSessionResult(await safeJson<unknown>(response));
  } catch {
    return { steering: [], followUp: [] };
  }
}

export async function respondExtensionUi(
  sessionId: string,
  requestId: string,
  response: { value?: string; confirmed?: boolean; cancelled?: boolean },
): Promise<void> {
  const result = await fetch("/api/agent/runtime/extension-ui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, requestId, ...response }),
  });
  if (!result.ok) throw new Error("Extension response was rejected");
}

export type { SessionUsageTotals } from "@shared/agent/session-usage";

export type CanonicalSessionMeta = {
  title: string | null;
  modelId: string | null;
  startedAt: string | null;
  piSessionId: string | null;
  usage?: SessionUsageTotals | null;
};

export type CanonicalSessionResult = {
  events: Record<string, unknown>[];
  // Byte-offset cursor to pass as `before` to load the previous (older) page,
  // or null when this page already reaches the start of the session log.
  cursor: number | null;
  // Session metadata from a head-scan; present on an initial tail load only.
  meta: CanonicalSessionMeta | null;
};

// Default page size for the initial tail load — enough to fill a long scrollback
// while keeping a giant log from being read/parsed whole.
export const DEFAULT_SESSION_TAIL = 500;

export type LoadCanonicalSessionOptions = { tail?: number; before?: number };

export async function loadCanonicalSession(
  piSessionId: string,
  cwd: string,
  options: LoadCanonicalSessionOptions = {},
): Promise<CanonicalSessionResult> {
  const params = new URLSearchParams({ cwd });
  const tail = options.before === undefined ? (options.tail ?? DEFAULT_SESSION_TAIL) : undefined;
  if (tail !== undefined) params.set("tail", String(tail));
  if (options.before !== undefined) params.set("before", String(options.before));
  const response = await fetch(
    `/api/agent/sessions/${encodeURIComponent(piSessionId)}?${params.toString()}`,
    { cache: "no-store" },
  );
  const payload = await safeJson<{
    events?: Record<string, unknown>[];
    cursor?: number | null;
    meta?: CanonicalSessionMeta | null;
    error?: string;
  }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load session");
  return {
    events: payload.events ?? [],
    cursor: payload.cursor ?? null,
    meta: payload.meta ?? null,
  };
}

export type CompactSessionArgs = {
  sessionId: string;
  modelId: string;
  thinkingLevel?: import("@/features/agent/contracts").AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
  cwd?: string;
  piSessionId?: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export type CompactSessionResult = {
  status?: RuntimeStatus;
};

export async function compactSession(args: CompactSessionArgs): Promise<CompactSessionResult> {
  const response = await fetch("/api/agent/compact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await safeJson<{ error?: string; status?: RuntimeStatus }>(response);
  if (!response.ok) throw new Error(payload.error || "Compaction failed");
  return payload;
}

export type SubmitTurnArgs = {
  sessionId: string;
  modelId: string;
  thinkingLevel?: import("@/features/agent/contracts").AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  message: string;
  images?: AgentImageInput[];
  cwd?: string;
  piSessionId?: string | null;
  /** Control mode for steer/follow-up; omitted for a normal prompt. */
  mode?: "steer" | "follow_up";
  queueAction?: AgentQueueAction;
  queueReplacement?: string;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export async function submitTurnCommand(args: SubmitTurnArgs): Promise<AgentTurnCommandResult> {
  const response = await fetch("/api/agent/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await safeJson<{ error?: string } & Partial<AgentTurnCommandResult>>(response);
  const parsed = parseAgentTurnCommandResult(payload);
  if (!response.ok || !parsed) {
    throw new Error(payload.error || `Agent request failed: ${response.status}`);
  }
  if (parsed.outcome === "rejected") {
    throw new Error(parsed.error || "Agent request was rejected");
  }
  return parsed;
}

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    const payload = decodeRuntimeEventPayload(parsed);
    if (!payload) return;
    handlers.onPayload(payload);
  };
  source.onerror = handlers.onError;
  return {
    close: () => {
      source.close();
    },
  };
}

const decodeSessionGoalResponseOption = Schema.decodeUnknownOption(SessionGoalResponseSchema, {
  onExcessProperty: "preserve",
});

function decodeSessionGoal(raw: unknown): SessionGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeSessionGoalResponseOption(raw);
  return option._tag === "Some" ? option.value.goal : null;
}

const sessionGoalUrl = (piSessionId: string) =>
  `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`;

export async function loadSessionGoal(piSessionId: string): Promise<SessionGoal | null> {
  try {
    const response = await fetch(sessionGoalUrl(piSessionId), { cache: "no-store" });
    if (!response.ok) return null;
    return decodeSessionGoal(await safeJson<unknown>(response));
  } catch {
    return null;
  }
}

export async function updateSessionGoal(
  piSessionId: string,
  patch: SessionGoalPatch,
): Promise<SessionGoal | null> {
  const response = await fetch(sessionGoalUrl(piSessionId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error("Failed to update the goal.");
  return decodeSessionGoal(await safeJson<unknown>(response));
}

export async function clearSessionGoal(piSessionId: string): Promise<void> {
  const response = await fetch(sessionGoalUrl(piSessionId), { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to clear the goal.");
}
