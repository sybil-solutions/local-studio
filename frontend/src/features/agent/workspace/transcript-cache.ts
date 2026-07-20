import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
} from "@/features/agent/messages/types";
import { isRecord } from "@/lib/guards";

type TranscriptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const TRANSCRIPT_CACHE_PREFIX = "local-studio.agent.transcript.v2.";

const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CHARS_PER_SESSION = 512 * 1024;
const MAX_SESSIONS = 24;
const MAX_BLOCK_TEXT = 16 * 1024;

export type CachedTranscript = {
  version: 2;
  updatedAt: number;
  title?: string;
  messages: ChatMessage[];
};

function defaultStorage(): TranscriptStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function sessionKey(piSessionId: string): string {
  return `${TRANSCRIPT_CACHE_PREFIX}${piSessionId}`;
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
  const kept = messages.slice(-MAX_MESSAGES_PER_SESSION).map(sanitizeMessage);
  // Size each message once instead of re-stringifying the whole array per trim
  // iteration — near the cap that loop stringified ~0.5 MB repeatedly on every
  // settled turn, on the main thread.
  const sizes = kept.map((message) => JSON.stringify(message).length + 1);
  let total = sizes.reduce((sum, size) => sum + size, 2);
  let start = 0;
  while (kept.length - start > 1 && total > MAX_CHARS_PER_SESSION) {
    total -= sizes[start];
    start += 1;
  }
  return start > 0 ? kept.slice(start) : kept;
}

function parseCachedTranscript(raw: string | null): CachedTranscript | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.messages)) return null;
    return parsed as unknown as CachedTranscript;
  } catch {
    return null;
  }
}

function cacheKeys(storage: TranscriptStorage): string[] {
  const local = storage as Partial<Storage>;
  if (typeof local.length !== "number" || typeof local.key !== "function") return [];
  const keys: string[] = [];
  for (let index = 0; index < local.length; index += 1) {
    const key = local.key(index);
    if (key?.startsWith(TRANSCRIPT_CACHE_PREFIX)) keys.push(key);
  }
  return keys;
}

function evictStaleSessions(storage: TranscriptStorage, keepKey: string): void {
  const keys = cacheKeys(storage);
  if (keys.length <= MAX_SESSIONS) return;
  const dated = keys
    .filter((key) => key !== keepKey)
    .map((key) => {
      const entry = parseCachedTranscript(storage.getItem(key));
      return { key, updatedAt: entry?.updatedAt ?? 0 };
    })
    .sort((a, b) => a.updatedAt - b.updatedAt);
  for (const { key } of dated.slice(0, keys.length - MAX_SESSIONS)) {
    storage.removeItem(key);
  }
}

export function readTranscriptSnapshot(
  piSessionId: string | null | undefined,
  storage: TranscriptStorage | null = defaultStorage(),
): ChatMessage[] | null {
  if (!storage || !piSessionId) return null;
  try {
    const entry = parseCachedTranscript(storage.getItem(sessionKey(piSessionId)));
    return entry && entry.messages.length > 0 ? entry.messages : null;
  } catch {
    return null;
  }
}

export function writeTranscriptSnapshot(
  piSessionId: string | null | undefined,
  messages: ChatMessage[],
  title: string | undefined,
  storage: TranscriptStorage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!storage || !piSessionId || messages.length === 0) return;
  const key = sessionKey(piSessionId);
  const entry: CachedTranscript = {
    version: 2,
    updatedAt: now,
    ...(title ? { title } : {}),
    messages: boundMessagesForCache(messages),
  };
  try {
    storage.setItem(key, JSON.stringify(entry));
    evictStaleSessions(storage, key);
  } catch {
    try {
      for (const stale of cacheKeys(storage)) {
        if (stale !== key) storage.removeItem(stale);
      }
      storage.setItem(key, JSON.stringify(entry));
    } catch {
      return;
    }
  }
}
