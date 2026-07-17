import { piEventIsSuccessfulCompaction } from "@shared/agent/pi-events";
import { cleanSessionTitle, isPlaceholderSessionTitle } from "@shared/agent/session-title";

export { cleanSessionTitle, isPlaceholderSessionTitle };
import type {
  ChatMessage,
  QueuedMessage,
  RuntimeLoggedEvent,
  SessionTab,
  TokenStats,
} from "@/features/agent/messages/types";

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
  return cleanSessionTitle(text.replace(/\s+/g, " ").trim().slice(0, 48)) || "New session";
}

export function visibleUserTextFromPi(text: string): string {
  const marker = "\n\nUser prompt:\n";
  const idx = text.lastIndexOf(marker);
  const body = idx === -1 ? text : text.slice(idx + marker.length);
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

export function runtimeStatusLooksActive(status: { active?: boolean }): boolean {
  return status.active === true;
}

export function runtimeStatusAcceptsControl(
  status: { active?: boolean; piSessionId?: string | null } | null,
  piSessionId?: string | null,
): boolean {
  if (!status) return false;
  if (!status.active) return false;
  return !status.piSessionId || !piSessionId || status.piSessionId === piSessionId;
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

export function visibleQueuedMessages(queue: QueuedMessage[]): QueuedMessage[] {
  return queue.filter((item) => item.mode === "follow_up");
}

export function drainQueueAfterAgentEnd(queue: QueuedMessage[]): {
  next: QueuedMessage | null;
  remaining: QueuedMessage[];
} {
  const followUps = queue.filter((item) => item.mode === "follow_up" && !item.sent);
  const [next, ...remaining] = followUps;
  return { next: next ?? null, remaining };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function queueDisplayText(text: string): string {
  return visibleUserTextFromPi(text) || text.trim();
}

function queueKey(mode: QueuedMessage["mode"], text: string): string {
  return `${mode}:${queueDisplayText(text)}`;
}

function consumePending(
  pending: Map<string, string[]>,
  mode: QueuedMessage["mode"],
  text: string,
): string | null {
  const key = queueKey(mode, text);
  const values = pending.get(key);
  if (!values || values.length === 0) return null;
  const [value, ...remaining] = values;
  if (remaining.length > 0) pending.set(key, remaining);
  else pending.delete(key);
  return value ?? null;
}

export function reconcileQueueWithPiEvent(
  queue: QueuedMessage[],
  event: Record<string, unknown>,
): QueuedMessage[] {
  if (event.type !== "queue_update") return queue;
  const pending = new Map<string, string[]>();
  const addPending = (mode: QueuedMessage["mode"], messages: string[]) => {
    for (const text of messages) {
      const key = queueKey(mode, text);
      pending.set(key, [...(pending.get(key) ?? []), text]);
    }
  };
  addPending("follow_up", stringArray(event.followUp));

  const next = queue.flatMap((item) => {
    if (item.mode !== "follow_up") return [];
    const acceptedByPi = consumePending(pending, item.mode, item.text);
    if (acceptedByPi) return [{ ...item, text: queueDisplayText(acceptedByPi), sent: true }];
    return item.sent ? [] : [item];
  });

  for (const [key, messages] of pending) {
    const separator = key.indexOf(":");
    const mode = key.slice(0, separator) as QueuedMessage["mode"];
    for (const text of messages) {
      next.push({ id: newId("queue"), mode, text: queueDisplayText(text), sent: true });
    }
  }
  return next;
}

export function removeDeliveredQueuedMessage(
  queue: QueuedMessage[],
  deliveredText: string,
): QueuedMessage[] {
  const delivered = queueDisplayText(deliveredText);
  const index = queue.findIndex((item) => queueDisplayText(item.text) === delivered);
  if (index === -1) return queue;
  return [...queue.slice(0, index), ...queue.slice(index + 1)];
}

function eventKey(event: Record<string, unknown>): string {
  try {
    return JSON.stringify(event);
  } catch {
    return `${String(event.type ?? "event")}:${Object.keys(event).join(",")}`;
  }
}

function messageFingerprint(event: Record<string, unknown>): string | null {
  const message = asRecord(event.message);
  if (!message || typeof message.role !== "string") return null;
  return eventKey(message);
}

function canonicalEventsBeforeRuntimeTail(
  canonicalEvents: Record<string, unknown>[],
  runtime: Record<string, unknown>[],
): Record<string, unknown>[] {
  const canonicalMessages = canonicalEvents.flatMap((event, eventIndex) => {
    const fingerprint = messageFingerprint(event);
    return fingerprint ? [{ eventIndex, fingerprint }] : [];
  });
  const runtimeMessages = runtime.flatMap((event) => {
    if (event.type !== "message" && event.type !== "message_end") return [];
    const fingerprint = messageFingerprint(event);
    return fingerprint ? [fingerprint] : [];
  });
  const firstRuntimeMessage = runtimeMessages[0];
  if (!firstRuntimeMessage) return canonicalEvents;
  let best: { eventIndex: number; score: number } | null = null;
  for (let index = 0; index < canonicalMessages.length; index += 1) {
    if (canonicalMessages[index]?.fingerprint !== firstRuntimeMessage) continue;
    let score = 0;
    while (
      canonicalMessages[index + score]?.fingerprint === runtimeMessages[score] &&
      runtimeMessages[score]
    ) {
      score += 1;
    }
    const candidate = { eventIndex: canonicalMessages[index]?.eventIndex ?? 0, score };
    if (!best || candidate.score >= best.score) best = candidate;
  }
  if (best) {
    return canonicalEvents.slice(0, best.eventIndex);
  }
  return canonicalEvents;
}

function runtimeEventsInOrder(
  runtimeEvents: readonly RuntimeLoggedEvent[],
): Record<string, unknown>[] {
  return [...runtimeEvents]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .flatMap((entry) => {
      if (entry.event && typeof entry.event === "object") {
        return [entry.event];
      }
      return [];
    });
}

function dedupeAdjacentEvents(events: Record<string, unknown>[]): Record<string, unknown>[] {
  let previous = "";
  return events.filter((event) => {
    const key = eventKey(event);
    if (key === previous) return false;
    previous = key;
    return true;
  });
}

export function mergeCanonicalAndRuntimeEvents(
  canonicalEvents: Record<string, unknown>[],
  runtimeEvents: readonly RuntimeLoggedEvent[] = [],
): Record<string, unknown>[] {
  const runtime = runtimeEventsInOrder(runtimeEvents);
  return dedupeAdjacentEvents([
    ...canonicalEventsBeforeRuntimeTail(canonicalEvents, runtime),
    ...runtime,
  ]);
}

export function reconcileReplayMessages(
  current: ChatMessage[],
  canonical: ChatMessage[],
): ChatMessage[] {
  if (canonical.length === 0) return current;
  if (canonical.length >= current.length) return canonical;
  return current;
}

export function makeFreshTab(): SessionTab {
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
