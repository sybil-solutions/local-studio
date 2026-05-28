import {
  sanitizeComposerExtensionOverrides,
  sanitizeComposerPlugins,
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
} from "@/lib/agent/composer-context";
import { boolField, objectRecord, stringField, type ParseResult } from "./common";

export type AgentTurnMode = "prompt" | "steer" | "follow_up";
export type AgentStreamingBehavior = "steer" | "followUp";

export type AgentImageInput = {
  type: "image";
  data: string;
  mimeType: string;
};

export type AgentTurnRequest = {
  sessionId: string;
  modelId: string;
  message: string;
  images: AgentImageInput[];
  cwd?: string;
  piSessionId: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  canvasEnabled: boolean;
  plugins: ReturnType<typeof sanitizeComposerPlugins>;
  skills: ReturnType<typeof sanitizeComposerSkills>;
  promptTemplates: ReturnType<typeof sanitizeComposerPromptTemplates>;
  /**
   * Per-turn Pi extension on/off overrides set via the composer's
   * `/plugins` slash command. Layered on top of persistent
   * `<agentDir>/extension-config/enabled.json` overrides.
   */
  extensionOverrides: ReturnType<typeof sanitizeComposerExtensionOverrides>;
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
      images: sanitizeImages(body.images),
      cwd: cwd.value,
      piSessionId: piSessionId.value ?? null,
      browserToolEnabled: boolField(body, "browserToolEnabled"),
      browserSessionId: browserSessionId.value,
      canvasEnabled: boolField(body, "canvasEnabled"),
      plugins: sanitizeComposerPlugins(body.plugins),
      skills: sanitizeComposerSkills(body.skills),
      promptTemplates: sanitizeComposerPromptTemplates(body.promptTemplates),
      extensionOverrides: sanitizeComposerExtensionOverrides(body.extensionOverrides),
      mode,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    },
  };
}

function sanitizeImages(value: unknown): AgentImageInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AgentImageInput[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const data = typeof record.data === "string" ? record.data.replace(/\s+/g, "") : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    if (!data || !/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return [];
    return [{ type: "image", data, mimeType }];
  });
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
