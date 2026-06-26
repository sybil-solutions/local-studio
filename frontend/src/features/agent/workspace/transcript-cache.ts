// A bounded, crash-survivable copy of each session's rendered transcript.
//
// The canonical pi session JSONL remains the source of truth: on a normal
// reload `loadAndReplay` rebuilds the transcript from it. But that recovery has
// several single points of failure (the JSONL never being written for an
// in-flight first turn, a cwd/piSessionId mismatch, a read error), and when any
// of them trips the restored session renders EMPTY — the user's "if a session
// crashes the history disappears" report.
//
// This module keeps a last-known transcript per pi session in localStorage so a
// restore has something to show even when canonical replay fails or returns
// nothing. It is deliberately a FALLBACK cache, not a second source of truth:
// canonical content always wins when it loads, and the cache is bounded hard so
// it can never grow into the localStorage budget owned by pane/session state.

import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
} from "@/features/agent/messages/types";

// Structurally identical to WorkspaceStorage; declared locally so this fallback
// cache stays dependency-free of the workspace layer (both effects and the
// runtime engine consume it).
type TranscriptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const TRANSCRIPT_CACHE_KEY = "local-studio.agent.transcripts.v1";

// Sizes are approximated by JSON string length (char count) — a cheap,
// deterministic proxy that keeps us comfortably under the ~5MB localStorage
// budget without measuring real UTF-8 bytes.
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CHARS_PER_SESSION = 512 * 1024;
const MAX_SESSIONS = 24;
const MAX_TOTAL_CHARS = 3 * 1024 * 1024;
const MAX_BLOCK_TEXT = 16 * 1024;

export type CachedTranscript = {
  messages: ChatMessage[];
  title?: string;
  updatedAt: number;
};

export type TranscriptCache = {
  version: 1;
  sessions: Record<string, CachedTranscript>;
};

function emptyCache(): TranscriptCache {
  return { version: 1, sessions: {} };
}

function defaultStorage(): TranscriptStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function truncateText(text: string | undefined): string | undefined {
  if (typeof text !== "string" || text.length <= MAX_BLOCK_TEXT) return text;
  return `${text.slice(0, MAX_BLOCK_TEXT)}\n…[truncated]`;
}

function sanitizeBlock(block: AssistantBlock): AssistantBlock {
  if (block.kind === "tool") {
    return {
      ...block,
      text: truncateText(block.text) ?? "",
      ...(block.argsText !== undefined ? { argsText: truncateText(block.argsText) } : {}),
      ...(block.resultText !== undefined ? { resultText: truncateText(block.resultText) } : {}),
    };
  }
  return { ...block, text: truncateText(block.text) ?? "" };
}

// Keep attachment metadata (so the chip still renders) but drop the heavy
// inline body — canonical replay restores the real content when it loads.
function stripAttachmentBody(attachment: ChatMessageAttachment): ChatMessageAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    mode: attachment.mode,
    content: "",
    ...(attachment.path ? { path: attachment.path } : {}),
    ...(attachment.previewKind ? { previewKind: attachment.previewKind } : {}),
  };
}

// Drop transient streaming fields (streamCalls/pending are never persisted) and
// bound the heavy ones so a single huge tool dump can't blow the budget.
function sanitizeMessage(message: ChatMessage): ChatMessage {
  const clean: ChatMessage = {
    id: message.id,
    role: message.role,
    text: truncateText(message.text) ?? "",
  };
  if (message.timestamp) clean.timestamp = message.timestamp;
  if (message.skills?.length) clean.skills = message.skills;
  if (message.blocks?.length) clean.blocks = message.blocks.map(sanitizeBlock);
  if (message.attachments?.length) clean.attachments = message.attachments.map(stripAttachmentBody);
  return clean;
}

export function boundMessagesForCache(messages: ChatMessage[]): ChatMessage[] {
  let kept = messages.slice(-MAX_MESSAGES_PER_SESSION).map(sanitizeMessage);
  // Drop oldest until the serialized session fits, but always keep at least the
  // most recent message.
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_CHARS_PER_SESSION) {
    kept = kept.slice(1);
  }
  return kept;
}

// Cap session count (most-recent wins) and total size, evicting least-recent.
function evict(cache: TranscriptCache): TranscriptCache {
  const ordered = Object.entries(cache.sessions).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const sessions: Record<string, CachedTranscript> = {};
  let total = 0;
  for (const [piSessionId, entry] of ordered.slice(0, MAX_SESSIONS)) {
    const size = JSON.stringify(entry).length;
    if (total + size > MAX_TOTAL_CHARS && Object.keys(sessions).length > 0) break;
    sessions[piSessionId] = entry;
    total += size;
  }
  return { version: 1, sessions };
}

export function putTranscript(
  cache: TranscriptCache,
  piSessionId: string,
  messages: ChatMessage[],
  title: string | undefined,
  now: number,
): TranscriptCache {
  const bounded = boundMessagesForCache(messages);
  if (bounded.length === 0) return cache;
  return evict({
    version: 1,
    sessions: {
      ...cache.sessions,
      [piSessionId]: { messages: bounded, ...(title ? { title } : {}), updatedAt: now },
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseTranscriptCache(raw: string | null): TranscriptCache {
  if (!raw) return emptyCache();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sessions)) {
      return emptyCache();
    }
    return parsed as unknown as TranscriptCache;
  } catch {
    return emptyCache();
  }
}

function readCache(storage: TranscriptStorage): TranscriptCache {
  try {
    return parseTranscriptCache(storage.getItem(TRANSCRIPT_CACHE_KEY));
  } catch {
    return emptyCache();
  }
}

function persist(storage: TranscriptStorage, cache: TranscriptCache): void {
  try {
    storage.setItem(TRANSCRIPT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota/private-mode failure: shed the older half and try once more so the
    // freshest transcripts still survive.
    const ordered = Object.entries(cache.sessions)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, Math.max(1, Math.floor(MAX_SESSIONS / 2)));
    try {
      storage.setItem(
        TRANSCRIPT_CACHE_KEY,
        JSON.stringify({ version: 1, sessions: Object.fromEntries(ordered) }),
      );
    } catch {
      // Give up — the in-memory transcript and canonical JSONL remain.
    }
  }
}

/** Last-known transcript for a pi session, or null when nothing is cached. */
export function readTranscriptSnapshot(
  piSessionId: string | null | undefined,
  storage: TranscriptStorage | null = defaultStorage(),
): ChatMessage[] | null {
  if (!storage || !piSessionId) return null;
  const entry = readCache(storage).sessions[piSessionId];
  return entry && entry.messages.length > 0 ? entry.messages : null;
}

/** Record a session's transcript as the crash-recovery fallback for its pi id. */
export function writeTranscriptSnapshot(
  piSessionId: string | null | undefined,
  messages: ChatMessage[],
  title: string | undefined,
  storage: TranscriptStorage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!storage || !piSessionId || messages.length === 0) return;
  persist(storage, putTranscript(readCache(storage), piSessionId, messages, title, now));
}
