import { isGoalContinuationPrompt } from "@shared/agent/goal-protocol";
import { piEventIsSuccessfulCompaction } from "@shared/agent/pi-events";
import {
  cleanSessionTitle,
  isPlaceholderSessionTitle,
  sessionTitleFromUserPrompt,
} from "@shared/agent/session-title";

export { cleanSessionTitle, isPlaceholderSessionTitle };
import type { TokenStats } from "@/features/agent/messages/types";
import type { Session } from "@/features/agent/runtime/types";

export function randomIdSegment(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomIdSegment(8)}`;
}

export function newPaneId(): string {
  return `p-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

export function nowLabel(): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(),
  );
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function numberFromRecord(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export function extractToolText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const result = value as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((item) => (item && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function piSessionIdFromEvent(event: Record<string, unknown>): string | null {
  if (event.type !== "session") return null;
  for (const key of ["id", "sessionId", "session_id"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function usageFromEvent(event: Record<string, unknown>): TokenStats | null {
  if (event.type !== "message" && event.type !== "message_end") return null;
  const message = asRecord(event.message);
  if (!message || message.role !== "assistant") return null;
  const usage =
    message.usage && typeof message.usage === "object" && !Array.isArray(message.usage)
      ? (message.usage as Record<string, unknown>)
      : null;
  if (!usage) return null;
  const read = numberFromRecord(usage, ["input", "prompt_tokens", "input_tokens"]);
  const write = numberFromRecord(usage, ["output", "completion_tokens", "output_tokens"]);
  const total = numberFromRecord(usage, ["totalTokens", "total_tokens", "total"]);
  const current = total || read + write;
  if (read <= 0 && write <= 0 && current <= 0) return null;
  return { read, write, current };
}

export function compactionTextFromEvent(event: Record<string, unknown>): string | null {
  if (!piEventIsSuccessfulCompaction(event)) return null;
  const result = asRecord(event.result);
  return (
    [event.message, event.summary, event.text, result?.summary].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) ?? "Context compacted"
  );
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.round(tokens)));
}

export function sessionTitleFromPrompt(text: string): string {
  return cleanSessionTitle(sessionTitleFromUserPrompt(text).slice(0, 48)) || "New session";
}

export function visibleUserTextFromPi(text: string): string {
  const marker = "\n\nUser prompt:\n";
  const idx = text.lastIndexOf(marker);
  const body = idx === -1 ? text : text.slice(idx + marker.length);
  // The goal driver keeps a pursuit moving by re-prompting through the ordinary
  // user channel, so the runtime echoes its continuation back as a user
  // message. It is machine steering, never the user's words: returning "" here
  // means no bubble is appended and no assistant bubble is opened for it, so a
  // long goal reads as the agent working rather than talking to itself.
  if (isGoalContinuationPrompt(body)) return "";
  return stripAttachmentPromptText(stripBrowserContextText(body)).trim();
}

// The Browser panel prepends a <browser_context>…</browser_context> block to
// the prompt (browser/context.ts). It is machine context, never the user's
// words — drop a leading block so echoed/replayed user turns show only what was
// typed, and so the echoed text still matches the optimistic user bubble.
function stripBrowserContextText(text: string): string {
  return text.replace(/^\s*<browser_context>[\s\S]*?<\/browser_context>\s*/i, "");
}

function stripAttachmentPromptText(text: string): string {
  const attachmentStart = text.search(/(?:^|\n\n)Attachment \d+:/);
  if (attachmentStart === -1) return text;
  return text.slice(0, attachmentStart).trim();
}

export function messageText(
  content: string | Array<Record<string, unknown>> | undefined,
  separator = "\n",
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join(separator);
}

export function replayCursorAfterRuntimeHydration(
  runtimeStatus: { active?: boolean; piSessionId?: string | null; eventSeq?: number } | null,
  piSessionId: string,
): number | undefined {
  // loadAndReplay hydrates messages from the canonical session log, which
  // already contains everything the matched runtime session has in its event
  // buffer. Reattach from the runtime's current cursor whenever that runtime
  // IS this pi session — active or idle — otherwise the next SSE subscribe
  // starts at seq 0 and the server replays the whole retained backlog on top
  // of the hydrated transcript (the reopened-old-session double-history bug).
  // An idle runtime with no reported piSessionId is not provably ours, so its
  // cursor is not adopted; an active one keeps the historical behavior of
  // being treated as this session's runtime.
  if (!runtimeStatus) return undefined;
  const matchesSession = runtimeStatus.piSessionId === piSessionId;
  const activeUnclaimed = runtimeStatus.active === true && !runtimeStatus.piSessionId;
  return matchesSession || activeUnclaimed ? runtimeStatus.eventSeq : undefined;
}

export function makeFreshTab(): Session {
  return {
    // The session id doubles as the opaque runtime key the client sends to the
    // server (ids are opaque server-side). Sessions persisted under a legacy
    // rt-* runtime key reattach via the controller's connection-key seed.
    id: newId("tab"),
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}
