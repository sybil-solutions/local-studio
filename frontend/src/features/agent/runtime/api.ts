import { Effect, Schema } from "effect";
import {
  SessionGoalResponseSchema,
  type SessionGoal,
  type SessionGoalPatch,
} from "@shared/agent/session-goal";
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

const fetchEffect = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Effect.Effect<Response, unknown> =>
  Effect.tryPromise({
    try: () => fetch(input, init),
    catch: (error) => error,
  });

const safeJsonEffect = <T>(response: Response): Effect.Effect<T, unknown> =>
  Effect.tryPromise({
    try: () => safeJson<T>(response),
    catch: (error) => error,
  });

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

export function listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/runtime/sessions", { cache: "no-store" });
      const payload = yield* safeJsonEffect<unknown>(response);
      return decodeRuntimeSessions(payload);
    }).pipe(Effect.catch(() => Effect.succeed([]))),
  );
}

export function loadRuntimeStatus(
  sessionId: string,
  piSessionId?: string | null,
): Promise<RuntimeStatus | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const params = new URLSearchParams({ sessionId });
      if (piSessionId) params.set("piSessionId", piSessionId);
      const response = yield* fetchEffect(`/api/agent/runtime/status?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = yield* safeJsonEffect<unknown>(response);
      const decoded = decodeRuntimeStatusResponse(payload);
      if (!decoded) return null;
      return { ...decoded.status, events: decoded.events ?? [] };
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}

export function abortSession(sessionId: string): Promise<AbortSessionResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = yield* safeJsonEffect<unknown>(response);
      return parseAbortSessionResult(payload);
    }).pipe(Effect.catch(() => Effect.succeed({ steering: [], followUp: [] }))),
  );
}

export function respondExtensionUi(
  sessionId: string,
  requestId: string,
  response: { value?: string; confirmed?: boolean; cancelled?: boolean },
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* fetchEffect("/api/agent/runtime/extension-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, requestId, ...response }),
      });
      if (!result.ok) return yield* Effect.fail(new Error("Extension response was rejected"));
    }),
  );
}

/** What the session has spent over its whole life. Distinct from the context
 *  window, which compaction resets — this does not. */
export type SessionUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
  calls: number;
  compactions: number;
};

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
export const DEFAULT_SESSION_TAIL = 20;

export type LoadCanonicalSessionOptions = { tail?: number; before?: number };

export function loadCanonicalSession(
  piSessionId: string,
  cwd: string,
  options: LoadCanonicalSessionOptions = {},
): Promise<CanonicalSessionResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const params = new URLSearchParams({ cwd });
      const tail =
        options.before === undefined ? (options.tail ?? DEFAULT_SESSION_TAIL) : undefined;
      if (tail !== undefined) params.set("tail", String(tail));
      if (options.before !== undefined) params.set("before", String(options.before));
      const response = yield* fetchEffect(
        `/api/agent/sessions/${encodeURIComponent(piSessionId)}?${params.toString()}`,
        { cache: "no-store" },
      );
      const payload = yield* safeJsonEffect<{
        events?: Record<string, unknown>[];
        cursor?: number | null;
        meta?: CanonicalSessionMeta | null;
        error?: string;
      }>(response);
      if (!response.ok)
        return yield* Effect.fail(new Error(payload.error || "Failed to load session"));
      return {
        events: payload.events ?? [],
        cursor: payload.cursor ?? null,
        meta: payload.meta ?? null,
      };
    }),
  );
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

export function compactSession(args: CompactSessionArgs): Promise<CompactSessionResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const payload = yield* safeJsonEffect<{
        error?: string;
        status?: RuntimeStatus;
      }>(response);
      if (!response.ok) return yield* Effect.fail(new Error(payload.error || "Compaction failed"));
      return payload;
    }),
  );
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

export function submitTurnCommand(args: SubmitTurnArgs): Promise<AgentTurnCommandResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const payload = yield* safeJsonEffect<{ error?: string } & Partial<AgentTurnCommandResult>>(
        response,
      );
      const parsed = parseAgentTurnCommandResult(payload);
      if (!response.ok || !parsed) {
        return yield* Effect.fail(
          new Error(payload.error || `Agent request failed: ${response.status}`),
        );
      }
      if (parsed.outcome === "rejected") {
        return yield* Effect.fail(new Error(parsed.error || "Agent request was rejected"));
      }
      return parsed;
    }),
  );
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

/**
 * "No goal" and "the request failed" are different answers: the first should
 * clear the strip, the second should leave the last known goal alone. When
 * both collapsed to null, one flaky poll made the goal vanish for a poll
 * interval and reappear — which reads as data loss.
 */
export type SessionGoalLoad = { ok: true; goal: SessionGoal | null } | { ok: false };

export function loadSessionGoal(piSessionId: string): Promise<SessionGoalLoad> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect(sessionGoalUrl(piSessionId), { cache: "no-store" });
      if (!response.ok) {
        return response.status === 404
          ? ({ ok: true, goal: null } as SessionGoalLoad)
          : ({ ok: false } as SessionGoalLoad);
      }
      const payload = yield* safeJsonEffect<unknown>(response);
      return { ok: true, goal: decodeSessionGoal(payload) } as SessionGoalLoad;
    }).pipe(Effect.catch(() => Effect.succeed<SessionGoalLoad>({ ok: false }))),
  );
}

export function updateSessionGoal(
  piSessionId: string,
  patch: SessionGoalPatch,
): Promise<SessionGoal | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect(sessionGoalUrl(piSessionId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return yield* Effect.fail(new Error("Failed to update the goal."));
      const payload = yield* safeJsonEffect<unknown>(response);
      return decodeSessionGoal(payload);
    }),
  );
}

export function clearSessionGoal(piSessionId: string): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect(sessionGoalUrl(piSessionId), { method: "DELETE" });
      if (!response.ok) return yield* Effect.fail(new Error("Failed to clear the goal."));
    }),
  );
}

export function generateSessionTitle(args: {
  sessionId: string;
  prompt: string;
  modelId: string;
}): Promise<string | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `/api/agent/sessions/${encodeURIComponent(args.sessionId)}/generate-title`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: args.prompt, modelId: args.modelId }),
        },
      );
      const payload = yield* safeJsonEffect<{ title?: string; error?: string }>(response);
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      if (!response.ok || !title) return yield* Effect.fail(new Error(payload.error || "title"));
      return title;
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}
