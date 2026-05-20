import { sanitizeComposerPlugins, sanitizeComposerSkills } from "@/lib/agent/composer-context";
import { boolField, objectRecord, stringField, type ParseResult } from "./common";

export type AgentTurnMode = "prompt" | "steer" | "follow_up";
export type AgentStreamingBehavior = "steer" | "followUp";

export type AgentTurnRequest = {
  sessionId: string;
  modelId: string;
  message: string;
  cwd?: string;
  piSessionId: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  canvasEnabled: boolean;
  plugins: ReturnType<typeof sanitizeComposerPlugins>;
  skills: ReturnType<typeof sanitizeComposerSkills>;
  mode: AgentTurnMode;
  streamingBehavior?: AgentStreamingBehavior;
};

export type AgentTurnSsePayload =
  | { type: "status"; phase: string; piSessionId?: string | null }
  | { type: "error"; error: string }
  | { type: "pi"; seq?: number; event: Record<string, unknown> };

export function parseAgentTurnRequest(input: unknown): ParseResult<AgentTurnRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const message = stringField(body, "message", true);
  if (!message.ok) return message;
  const modelId = stringField(body, "modelId", true);
  if (!modelId.ok) return modelId;
  const sessionId = stringField(body, "sessionId");
  if (!sessionId.ok) return sessionId;
  const cwd = stringField(body, "cwd");
  if (!cwd.ok) return cwd;
  const piSessionId = stringField(body, "piSessionId");
  if (!piSessionId.ok) return piSessionId;
  const browserSessionId = stringField(body, "browserSessionId");
  if (!browserSessionId.ok) return browserSessionId;
  const mode = body.mode === "steer" || body.mode === "follow_up" ? body.mode : "prompt";
  const streamingBehavior =
    body.streamingBehavior === "steer" || body.streamingBehavior === "followUp"
      ? body.streamingBehavior
      : undefined;
  return {
    ok: true,
    value: {
      sessionId: sessionId.value ?? "default",
      modelId: modelId.value!,
      message: message.value!,
      cwd: cwd.value,
      piSessionId: piSessionId.value ?? null,
      browserToolEnabled: boolField(body, "browserToolEnabled"),
      browserSessionId: browserSessionId.value,
      canvasEnabled: boolField(body, "canvasEnabled"),
      plugins: sanitizeComposerPlugins(body.plugins),
      skills: sanitizeComposerSkills(body.skills),
      mode,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    },
  };
}

export function parseAgentTurnSsePayload(line: string): AgentTurnSsePayload | null {
  if (!line.startsWith("data: ")) return null;
  try {
    const payload = JSON.parse(line.slice(6)) as Partial<AgentTurnSsePayload>;
    if (payload.type === "status" && typeof payload.phase === "string") {
      return { type: "status", phase: payload.phase, piSessionId: payload.piSessionId };
    }
    if (payload.type === "error" && typeof payload.error === "string") {
      return { type: "error", error: payload.error };
    }
    if (payload.type === "pi" && objectRecord(payload.event)) {
      return { type: "pi", seq: payload.seq, event: payload.event! };
    }
  } catch {
    return null;
  }
  return null;
}
