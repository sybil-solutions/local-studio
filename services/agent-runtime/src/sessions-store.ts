import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  getAgentDir,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveDataDir } from "./data-dir";
import { expandHome } from "./pi-runtime-helpers";
import { rolloutCache, statRollout } from "./rollout-cache";
import { transcriptSource } from "./transcript-sidecar";
import {
  cleanSessionTitle,
  sessionTitleFromUserPrompt,
} from "../../../shared/agent/session-title";
import { readSessionListMetadata } from "./session-metadata-store";
import type { SessionSummary } from "../../../shared/agent/session-summary";
import {
  emptyUsageTotals,
  readSessionUsageTotals,
  type SessionUsageTotals,
} from "./session-usage";
export type { SessionSummary } from "../../../shared/agent/session-summary";

export type SessionEvent = Record<string, unknown> & { type?: string };

type ListSessionsOptions = {
  since?: Date;
  ids?: string[];
  includeArchived?: boolean;
  archivedOnly?: boolean;
  limit?: number;
};

type NormalizedListSessionsOptions = {
  sinceMs?: number;
  wantedIds: Set<string>;
  wantedIdList: string[];
  includeArchived: boolean;
  archivedOnly: boolean;
};

type PiMessageContent = string | Array<{ type?: string; text?: string }>;

type UserTurn = {
  isUser: boolean;
  text: string | null;
  at: string | null;
};

function summaryStartTime(session: Pick<SessionSummary, "startedAt" | "updatedAt">): number {
  const value = Date.parse(session.startedAt || session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export function encodeCwdForPi(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  const collapsed = normalized.replace(/^\//, "").replace(/\/+/g, "-");
  return `--${collapsed}--`;
}

export function configuredPiSessionDir(cwd: string): string | undefined {
  const envSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (envSessionDir) {
    return path.resolve(expandHome(envSessionDir));
  }
  return SettingsManager.create(cwd, getAgentDir()).getSessionDir();
}

function cwdVariants(cwd: string): string[] {
  const variants = [path.resolve(cwd)];
  try {
    variants.push(realpathSync.native(cwd));
  } catch {
    try {
      variants.push(realpathSync(cwd));
    } catch {
      // If the cwd no longer exists, fall back to the lexical path. Old
      // session loading should remain best-effort instead of throwing.
    }
  }
  return [...new Set(variants.map((value) => path.resolve(value)))];
}

function sessionsDirsForCwd(cwd: string): string[] {
  const encodedCwds = [...new Set(cwdVariants(cwd).map(encodeCwdForPi))];
  const nativeDir = configuredPiSessionDir(cwd) ?? SessionManager.create(cwd).getSessionDir();
  const legacyRoot = path.join(resolveDataDir(), "pi-agent", "sessions");
  const dirs = [
    path.resolve(nativeDir),
    ...encodedCwds.map((encoded) => path.join(legacyRoot, encoded)),
  ];
  return dirs.filter((value, index, values) => values.indexOf(value) === index);
}

export function sessionDirRootsForCwd(cwd: string): string[] {
  return [...new Set(sessionsDirsForCwd(cwd).map((dir) => path.dirname(dir)))];
}

function sessionCwdMatches(summaryCwd: string, cwd: string): boolean {
  if (!summaryCwd) return false;
  const expected = new Set(cwdVariants(cwd));
  return cwdVariants(summaryCwd).some((candidate) => expected.has(candidate));
}

function piTextContent(content: PiMessageContent | undefined): string | null {
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join(" ")
      .trim();
    return text || null;
  }
  if (typeof content !== "string") return null;
  const text = content.trim();
  return text || null;
}

function userEventTimestamp(event: Record<string, unknown>): string | null {
  if (typeof event.timestamp === "string" && event.timestamp) return event.timestamp;
  const message = event.message as { timestamp?: unknown } | undefined;
  return message && typeof message.timestamp === "string" && message.timestamp
    ? message.timestamp
    : null;
}

function userTurnFromEvent(event: Record<string, unknown>): UserTurn {
  if (event.type === "user_message") {
    return {
      isUser: true,
      text: piTextContent(event.content as PiMessageContent | undefined),
      at: userEventTimestamp(event),
    };
  }
  if (event.type !== "message" && event.type !== "message_end") {
    return { isUser: false, text: null, at: null };
  }
  const message = event.message as { role?: string; content?: PiMessageContent } | undefined;
  if (message?.role !== "user") return { isUser: false, text: null, at: null };
  return { isUser: true, text: piTextContent(message.content), at: userEventTimestamp(event) };
}

const SUMMARY_SCAN_LINE_CAP = 2000;

// Summary scans are the sidebar's hot path: every refresh re-lists every
// session file for every project, so cache the scan result per filepath and
// re-read only when the file changed. The header and first user message are
// immutable once found, but the last user prompt moves with every turn, so
// mtime — not scan completeness — is what keeps an entry valid.
type SummaryCacheEntry = {
  mtimeMs: number;
  core: Omit<
    SessionSummary,
    "updatedAt" | "archived" | "archivedAt" | "parentSessionId" | "subagentName"
  > | null;
};
const summaryCache = new Map<string, SummaryCacheEntry>();
const SUMMARY_CACHE_MAX_ENTRIES = 8192;

function summaryFromCore(core: SummaryCacheEntry["core"], mtime: Date): SessionSummary | null {
  if (!core) return null;
  return {
    ...core,
    updatedAt: mtime.toISOString(),
    archived: false,
    archivedAt: null,
    parentSessionId: null,
    subagentName: null,
  };
}

function rememberSummary(filepath: string, entry: SummaryCacheEntry): void {
  summaryCache.delete(filepath);
  summaryCache.set(filepath, entry);
  while (summaryCache.size > SUMMARY_CACHE_MAX_ENTRIES) {
    const oldest = summaryCache.keys().next().value;
    if (oldest === undefined) break;
    summaryCache.delete(oldest);
  }
}

// The recents list labels rows by the newest user prompt, which lives at the
// end of the transcript — read backward from the tail rather than rescanning
// the whole file.
async function readLastUserTurn(filepath: string): Promise<{ text: string; at: string } | null> {
  const transcript = await transcriptSource(filepath);
  if (!transcript.size) return null;
  const { events } = readTailRegion(transcript.filepath, transcript.size, 1, undefined);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = userTurnFromEvent(events[index]);
    if (turn.isUser && turn.text && turn.at) return { text: turn.text, at: turn.at };
  }
  return null;
}

async function readSessionSummary(
  filepath: string,
  filename: string,
): Promise<SessionSummary | null> {
  const stats = statSync(filepath);
  const cached = summaryCache.get(filepath);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return summaryFromCore(cached.core, stats.mtime);
  }
  let header: Record<string, unknown> | null = null;
  let firstUserMessage: string | null = null;

  const stream = createReadStream(filepath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let scanned = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      scanned += 1;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!header && event.type === "session") header = event;
      if (!firstUserMessage) {
        const userTurn = userTurnFromEvent(event);
        if (userTurn.isUser && userTurn.text) {
          firstUserMessage =
            cleanSessionTitle(sessionTitleFromUserPrompt(userTurn.text).slice(0, 120)) || null;
        }
      }
      if (header && firstUserMessage) break;
      if (scanned >= SUMMARY_SCAN_LINE_CAP) break;
    }
  } finally {
    stream.destroy();
  }

  let lastUserPromptText: string | undefined;
  let lastUserPromptAt: string | undefined;
  if (header && firstUserMessage) {
    const lastTurn = await readLastUserTurn(filepath);
    if (lastTurn) {
      // The raw turn text can open with injected context (<browser_context>…)
      // that is not what the user typed; the title helper already knows how
      // to peel it. An all-context turn yields no preview rather than noise.
      const visible = sessionTitleFromUserPrompt(lastTurn.text);
      if (visible) lastUserPromptText = visible;
      lastUserPromptAt = lastTurn.at;
    }
  }

  const core = header
    ? {
        id: typeof header.id === "string" ? header.id : "",
        filename,
        cwd: typeof header.cwd === "string" ? header.cwd : "",
        startedAt:
          typeof header.timestamp === "string" ? header.timestamp : stats.birthtime.toISOString(),
        modelId: typeof header.modelId === "string" ? header.modelId : null,
        provider: typeof header.provider === "string" ? header.provider : null,
        firstUserMessage,
        ...(lastUserPromptText !== undefined ? { lastUserPromptText } : {}),
        ...(lastUserPromptAt !== undefined ? { lastUserPromptAt } : {}),
      }
    : null;
  rememberSummary(filepath, { mtimeMs: stats.mtimeMs, core });
  return summaryFromCore(core, stats.mtime);
}

type SessionMetadataLookup = ReturnType<typeof readSessionListMetadata>;

function applySessionMetadata(
  summary: SessionSummary,
  metadataFor: SessionMetadataLookup,
): SessionSummary {
  const metadata = metadataFor(summary.id);
  const titled = typeof metadata.title === "string" ? metadata.title.trim() : "";
  return {
    ...summary,
    archived: metadata.archived,
    archivedAt: metadata.archivedAt,
    parentSessionId: metadata.parentSessionId,
    subagentName: metadata.subagentName,
    firstUserMessage: titled || summary.firstUserMessage,
  };
}

function summaryRelevantTime(summary: SessionSummary, archivedOnly: boolean): number {
  const value = archivedOnly
    ? summary.archivedAt || summary.updatedAt || summary.startedAt
    : summary.updatedAt || summary.startedAt;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeListOptions(options: ListSessionsOptions): NormalizedListSessionsOptions {
  const wantedIds = new Set((options.ids ?? []).map((id) => id.trim()).filter(Boolean));
  const sinceMs = options.since?.getTime();
  return {
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : undefined,
    wantedIds,
    wantedIdList: [...wantedIds],
    includeArchived: Boolean(options.includeArchived),
    archivedOnly: Boolean(options.archivedOnly),
  };
}

function summaryMatchesListOptions(
  summary: SessionSummary,
  options: NormalizedListSessionsOptions,
) {
  if (options.archivedOnly) {
    return (
      summary.archived &&
      (options.sinceMs === undefined || summaryRelevantTime(summary, true) >= options.sinceMs)
    );
  }
  return options.includeArchived || !summary.archived;
}

async function readListCandidate(
  cwd: string,
  dir: string,
  filename: string,
  options: NormalizedListSessionsOptions,
  metadataFor: SessionMetadataLookup,
): Promise<SessionSummary | null> {
  try {
    if (!filename.endsWith(".jsonl")) return null;
    if (
      options.wantedIdList.length > 0 &&
      !options.wantedIdList.some((id) => filename.includes(id) || filename.startsWith(id))
    ) {
      return null;
    }
    const filepath = path.join(dir, filename);
    const stats = statSync(filepath);
    if (
      options.sinceMs !== undefined &&
      !options.archivedOnly &&
      stats.mtime.getTime() < options.sinceMs
    ) {
      return null;
    }
    const summary = await readSessionSummary(filepath, filename);
    if (!summary?.id) return null;
    if (!sessionCwdMatches(summary.cwd, cwd)) return null;
    if (options.wantedIds.size > 0 && !options.wantedIds.has(summary.id)) return null;
    const decorated = applySessionMetadata(summary, metadataFor);
    return summaryMatchesListOptions(decorated, options) ? decorated : null;
  } catch {
    return null;
  }
}

function listCandidateFiles(
  cwd: string,
): Array<{ dir: string; filename: string; mtimeMs: number }> {
  const candidates: Array<{ dir: string; filename: string; mtimeMs: number }> = [];
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir)) {
      if (!filename.endsWith(".jsonl")) continue;
      try {
        candidates.push({ dir, filename, mtimeMs: statSync(path.join(dir, filename)).mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function limitSatisfied(
  summariesById: Map<string, SessionSummary>,
  limit: number | undefined,
  nextMtimeMs: number,
): boolean {
  if (!limit || summariesById.size < limit) return false;
  const startTimes = [...summariesById.values()].map(summaryStartTime).sort((a, b) => b - a);
  return nextMtimeMs < startTimes[limit - 1];
}

export async function listSessions(
  cwd: string,
  options: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const summariesById = new Map<string, SessionSummary>();
  const normalizedOptions = normalizeListOptions(options);
  const metadataFor = readSessionListMetadata();
  for (const candidate of listCandidateFiles(cwd)) {
    if (limitSatisfied(summariesById, options.limit, candidate.mtimeMs)) break;
    const summary = await readListCandidate(
      cwd,
      candidate.dir,
      candidate.filename,
      normalizedOptions,
      metadataFor,
    );
    const existing = summary ? summariesById.get(summary.id) : null;
    if (summary && (!existing || summary.updatedAt > existing.updatedAt)) {
      summariesById.set(summary.id, summary);
    }
  }
  const summaries = [...summariesById.values()];
  summaries.sort((a, b) => summaryStartTime(b) - summaryStartTime(a));
  return options.limit && options.limit > 0 ? summaries.slice(0, options.limit) : summaries;
}

const PI_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const PI_SESSION_HEADER_BYTE_CAP = 64 * 1024;

function readPiSessionHeader(filepath: string): { id: string; cwd: string } | null {
  let fd: number | null = null;
  try {
    const size = statSync(filepath).size;
    const bytesToRead = Math.min(size, PI_SESSION_HEADER_BYTE_CAP);
    const buffer = Buffer.alloc(bytesToRead);
    fd = openSync(filepath, "r");
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    const newline = buffer.indexOf(0x0a, 0);
    if (newline < 0 && size > PI_SESSION_HEADER_BYTE_CAP) return null;
    const lineEnd = newline >= 0 ? newline : bytesRead;
    const header = JSON.parse(buffer.toString("utf8", 0, lineEnd)) as Record<string, unknown>;
    return header.type === "session" && typeof header.id === "string"
      ? { id: header.id, cwd: typeof header.cwd === "string" ? header.cwd : "" }
      : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function findSessionFile(cwd: string, sessionId: string): string | null {
  if (!PI_SESSION_ID_PATTERN.test(sessionId)) return null;

  const filenameSuffix = `_${sessionId}.jsonl`;
  const matches = new Set<string>();
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(filenameSuffix)) continue;
        const filepath = path.join(dir, entry.name);
        const header = readPiSessionHeader(filepath);
        if (header?.id !== sessionId || !sessionCwdMatches(header.cwd, cwd)) continue;
        matches.add(filepath);
        if (matches.size > 1) return null;
      }
    } catch {
      continue;
    }
  }
  return matches.values().next().value ?? null;
}

export type LoadSessionOptions = {
  // Return only the last N transcript messages (snapped back to a user-turn
  // boundary so no assistant/tool group is cut mid-turn). Omit for a full read.
  tail?: number;
  // Byte offset cursor from a prior tail response: return the page of events
  // that ends just before this offset (for "load earlier").
  before?: number;
};

export type LoadSessionMeta = {
  title: string | null;
  modelId: string | null;
  startedAt: string | null;
  piSessionId: string | null;
  // Lifetime spend for the whole rollout, not just the returned page. A tail
  // load only returns recent events, but what the session cost includes every
  // turn that compaction has since discarded.
  usage: SessionUsageTotals;
};

export type LoadSessionResult = {
  events: SessionEvent[];
  // Byte offset to pass as `before` to fetch the previous (older) page, or null
  // when this page already reaches the start of the file.
  cursor: number | null;
  // Session-level metadata derived from a cheap head-scan (title/model/etc.),
  // present only on an initial tail load — a paged `before` request omits it.
  meta: LoadSessionMeta | null;
};

// Files above this never get read whole; a tail request caps its backward scan
// here (a runaway `custom`-event log can reach multiple GB — reading it whole
// blocks the event loop and buffers gigabytes into one JSON response).
const TAIL_SCAN_BYTE_CAP = 96 * 1024 * 1024;
const FULL_READ_BYTE_CAP = 96 * 1024 * 1024;
const TAIL_CHUNK_BYTES = 8 * 1024 * 1024;
const HEAD_SCAN_LINE_CAP = 400;

function parseEvent(line: string): SessionEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as SessionEvent;
  } catch {
    return null;
  }
}

type ActiveBranchCacheEntry = { size: number; mtimeMs: number; ids: Set<string> };

/**
 * `buildContextEntries()` walks the rollout from the current leaf to the root,
 * so it costs the whole file — 121ms on a 40MB session, 366ms on a 145MB one —
 * and `loadSession` calls it on every open AND every "load earlier" page, each
 * of which returns at most a few hundred events.
 *
 * Memoised on (size, mtime) exactly like `readSessionUsageTotals` next door,
 * and for the same reason: a rollout is append-only, so a file that has not
 * grown cannot have a different active branch. A session that IS being appended
 * to invalidates on its next open, which is the correct answer — branching and
 * compaction both write to the file.
 */
const activeBranchCache = new Map<string, ActiveBranchCacheEntry>();

/**
 * The in-process map is dropped on every controller restart, and the sessions
 * this walk is expensive for are precisely the ones a user keeps coming back
 * to. Backing it with disk makes the cost once-ever instead of once-per-boot.
 */
const activeBranchDisk = rolloutCache<Set<string>, string[]>("active-branch", {
  serialize: (ids) => [...ids],
  deserialize: (raw) => new Set(raw),
});

function activeBranchIds(filepath: string): Set<string> | null {
  const stat = statRollout(filepath);
  if (!stat) return null;

  const cached = activeBranchCache.get(filepath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.ids;

  const fromDisk = activeBranchDisk.read(filepath, stat);
  if (fromDisk) {
    activeBranchCache.set(filepath, { size: stat.size, mtimeMs: stat.mtimeMs, ids: fromDisk });
    return fromDisk;
  }

  const ids = new Set(
    SessionManager.open(filepath)
      .buildContextEntries()
      .map((entry) => entry.id),
  );
  activeBranchCache.set(filepath, { size: stat.size, mtimeMs: stat.mtimeMs, ids });
  activeBranchDisk.write(filepath, stat, ids);
  return ids;
}

function activeBranchEvents(filepath: string, events: SessionEvent[]): SessionEvent[] {
  try {
    const activeIds = activeBranchIds(filepath);
    if (!activeIds) return events;
    return events.filter(
      (event) =>
        event.type === "session" || (typeof event.id === "string" && activeIds.has(event.id)),
    );
  } catch {
    return events;
  }
}

// `custom` / `custom_message` events are background-task state snapshots — inert
// to the transcript fold and, in pathological sessions, 99%+ of the bytes. They
// are dropped from tail slices so a page carries real transcript, not noise.
function isInertEvent(event: SessionEvent): boolean {
  return event.type === "custom" || event.type === "custom_message";
}

function isMessageEvent(event: SessionEvent): boolean {
  if (event.type !== "message" && event.type !== "message_end") return false;
  const message = event.message as { role?: string } | undefined;
  return Boolean(message && typeof message.role === "string");
}

function messageRole(event: SessionEvent): string | undefined {
  return (event.message as { role?: string } | undefined)?.role;
}

// Header block: session/model_change/thinking_level_change entries that precede
// the first real message. They carry modelId/startedAt/piSessionId the fold
// needs — a tail slice that starts deep in the file must be prefixed with them.
function isHeaderEvent(event: SessionEvent): boolean {
  return (
    event.type === "session" ||
    event.type === "model_change" ||
    event.type === "thinking_level_change"
  );
}

// Serialized pi events always put `type` first, so inert `custom` /
// `custom_message` lines (99%+ of a pathological log's bytes) can be skipped
// without JSON.parse by checking the raw byte prefix.
const INERT_LINE_PREFIX = Buffer.from('{"type":"custom');

function lineIsInert(bytes: Buffer, start: number, end: number): boolean {
  if (end - start < INERT_LINE_PREFIX.length) return false;
  for (let i = 0; i < INERT_LINE_PREFIX.length; i += 1) {
    if (bytes[start + i] !== INERT_LINE_PREFIX[i]) return false;
  }
  return true;
}

// Parse one contiguous byte region into events, skipping inert lines. `\n`
// (0x0A) never appears inside a UTF-8 multibyte sequence, so splitting on the
// byte and decoding each line individually is UTF-8 safe even when the region
// begins mid-line. Returns the parsed events plus the region's leading partial
// segment (bytes up to and including the first newline) — the caller carries it
// into the next-earlier chunk, where the straddling line becomes complete.
function parseRegion(
  bytes: Buffer,
  regionStart: number,
): { events: Array<{ offset: number; event: SessionEvent }>; head: Buffer } {
  const events: Array<{ offset: number; event: SessionEvent }> = [];
  let lineStart = 0;
  let head = Buffer.alloc(0);
  let sawNewline = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0x0a) continue;
    sawNewline = true;
    if (lineStart === 0 && regionStart !== 0) {
      // Leading partial segment (its start is in an earlier, unread chunk).
      // Keep the newline so the carried segment stays a terminated line.
      head = Buffer.from(bytes.subarray(0, i + 1));
    } else if (!lineIsInert(bytes, lineStart, i)) {
      const event = parseEvent(bytes.toString("utf8", lineStart, i));
      // isInertEvent backstops the byte-prefix check for re-serialized logs
      // whose key order differs.
      if (event && !isInertEvent(event)) events.push({ offset: regionStart + lineStart, event });
    }
    lineStart = i + 1;
  }
  // A region with no newline at all sits entirely inside one giant line —
  // carry the whole region so the line completes in an earlier chunk.
  if (!sawNewline && regionStart !== 0) head = Buffer.from(bytes);
  // Bytes after the last newline are an unterminated trailing line (only
  // possible on the endmost chunk of an initial tail read) — dropped, matching
  // a torn in-flight write.
  return { events, head };
}

// Walk parsed lines from the end: gather at least `tail` message events, then
// keep going back until a user message (turn boundary) so tool results always
// travel with the assistant turn that owns them. Returns the index into `lines`
// where the slice should begin.
function tailBoundaryIndex(
  lines: Array<{ offset: number; event: SessionEvent }>,
  tail: number,
): number {
  let messageCount = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isMessageEvent(lines[i].event)) continue;
    messageCount += 1;
    if (messageCount >= tail && messageRole(lines[i].event) === "user") return i;
  }
  return 0;
}

// Cheap head-scan: read the first lines of the file to recover the header block
// (to prefix onto a deep tail slice) and the real session title (the first user
// prompt — a tail slice's own first user message is NOT the session title).
async function readSessionHead(
  filepath: string,
): Promise<{ headerEvents: SessionEvent[]; meta: LoadSessionMeta }> {
  const headerEvents: SessionEvent[] = [];
  const meta: LoadSessionMeta = {
    title: null,
    modelId: null,
    startedAt: null,
    usage: emptyUsageTotals(),
    piSessionId: null,
  };
  const stream = createReadStream(filepath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let scanned = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      scanned += 1;
      const event = parseEvent(line);
      if (!event) {
        if (scanned >= HEAD_SCAN_LINE_CAP) break;
        continue;
      }
      if (isHeaderEvent(event)) headerEvents.push(event);
      if (event.type === "session") {
        if (typeof event.timestamp === "string") meta.startedAt = event.timestamp;
        const model = [event.modelId, event.model, event.model_id].find(
          (value): value is string => typeof value === "string",
        );
        if (model) meta.modelId = model;
        if (typeof event.id === "string") meta.piSessionId = event.id;
      }
      if (event.type === "model_change") {
        const model = [event.model, event.modelId].find(
          (value): value is string => typeof value === "string",
        );
        if (model) meta.modelId = model;
      }
      if (!meta.title) {
        const userTurn = userTurnFromEvent(event);
        if (userTurn.isUser && userTurn.text) {
          meta.title = cleanSessionTitle(userTurn.text.slice(0, 120)) || null;
        }
      }
      if (meta.title && meta.startedAt && scanned >= headerEvents.length && scanned >= 8) {
        // Header block is contiguous at the top; once a title is found past it
        // there is nothing more to learn from the head.
        break;
      }
      if (scanned >= HEAD_SCAN_LINE_CAP) break;
    }
  } finally {
    stream.destroy();
  }
  return { headerEvents, meta };
}

// Read the tail of a JSONL file by seeking backward in chunks — never reading
// more than the byte cap — and return the (inert-filtered) events from the
// chosen user-turn boundary forward, plus the `before` cursor for paging
// further back. Memory stays bounded: one chunk + the retained events; inert
// lines are skipped by byte prefix without ever being decoded.
function readTailRegion(
  filepath: string,
  size: number,
  tail: number,
  before: number | undefined,
): { events: SessionEvent[]; cursor: number | null } {
  const end = before === undefined ? size : Math.max(0, Math.min(before, size));
  if (end <= 0) return { events: [], cursor: null };
  const fd = openSync(filepath, "r");
  try {
    let regionStart = end;
    // Leading partial segment of the region parsed so far; prepending the
    // next-earlier chunk completes the line that straddles the chunk boundary.
    let carry: Buffer = Buffer.alloc(0);
    let kept: Array<{ offset: number; event: SessionEvent }> = [];
    while (regionStart > 0 && end - regionStart < TAIL_SCAN_BYTE_CAP) {
      const readLen = Math.min(TAIL_CHUNK_BYTES, regionStart);
      regionStart -= readLen;
      const chunk = Buffer.allocUnsafe(readLen);
      readSync(fd, chunk, 0, readLen, regionStart);
      const combined = carry.length > 0 ? Buffer.concat([chunk, carry]) : chunk;
      const parsed = parseRegion(combined, regionStart);
      kept = parsed.events.length > 0 ? [...parsed.events, ...kept] : kept;
      carry = parsed.head;
      if (regionStart === 0) break;
      // Stop once a user-turn boundary sits strictly inside the window (the
      // whole first turn is then known to be captured).
      const messageCount = kept.reduce(
        (count, line) => (isMessageEvent(line.event) ? count + 1 : count),
        0,
      );
      if (messageCount >= tail && tailBoundaryIndex(kept, tail) > 0) break;
    }
    const boundaryIndex = tailBoundaryIndex(kept, tail);
    const slice = kept.slice(boundaryIndex);
    // Cursor for the next page back: the boundary line's offset when one was
    // found; otherwise (scan cap hit inside a stretch with no boundary — e.g. a
    // wall of inert events) the first COMPLETE line boundary we reached, so the
    // next page resumes exactly at a line start and no line is ever straddled.
    const reachedStart = regionStart === 0 && boundaryIndex === 0;
    const cursor = reachedStart
      ? null
      : boundaryIndex > 0
        ? kept[boundaryIndex].offset
        : regionStart + carry.length;
    return { events: slice.map((line) => line.event), cursor };
  } finally {
    closeSync(fd);
  }
}

// Stream-load events from a session JSONL to replay a past conversation into the
// renderer's fold. Without options it reads the whole file (capped); with `tail`
// it reads only the last N messages from the end of the file, and with `before`
// it pages to the previous chunk — so a multi-GB log never gets read whole.
export async function loadSession(
  cwd: string,
  sessionId: string,
  options: LoadSessionOptions = {},
): Promise<LoadSessionResult> {
  const filepath = findSessionFile(cwd, sessionId);
  if (!filepath) return { events: [], cursor: null, meta: null };
  const { size } = statSync(filepath);
  const tail = options.tail && options.tail > 0 ? Math.floor(options.tail) : undefined;
  const paging = options.before !== undefined;

  // Full read only when no tail/paging is requested and the file is safely
  // small; otherwise fall back to a large tail so we never buffer a giant file.
  if (!tail && !paging) {
    if (size <= FULL_READ_BYTE_CAP) {
      const events: SessionEvent[] = [];
      const stream = createReadStream(filepath, { encoding: "utf-8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const event = parseEvent(line);
        if (event) events.push(event);
      }
      return { events: activeBranchEvents(filepath, events), cursor: null, meta: null };
    }
    return loadSession(cwd, sessionId, { tail: 2000 });
  }

  const effectiveTail = tail ?? 500;
  // Page the transcript out of the de-noised sidecar when there is one. It is
  // the same JSONL in the same order with the inert entries dropped, so the
  // scan below is unchanged and cursors remain opaque byte offsets — into a
  // file that is 10-20x smaller. Falls back to the rollout on any problem.
  const transcript = await transcriptSource(filepath);
  const { events, cursor } = readTailRegion(
    transcript.filepath,
    transcript.size,
    effectiveTail,
    options.before,
  );

  // Initial tail load: prefix the header block (model/started metadata the fold
  // needs) and return real session metadata from the head-scan. Paged `before`
  // loads are continuations — no header, no meta.
  if (!paging) {
    // The head-scan and the usage scan read opposite ends of the same file for
    // different reasons; run them together so an initial open pays one wait.
    const [{ headerEvents, meta }, usage] = await Promise.all([
      readSessionHead(filepath),
      readSessionUsageTotals(filepath),
    ]);
    meta.usage = usage;
    const hasHeader = events.some((event) => event.type === "session");
    return {
      events: activeBranchEvents(filepath, hasHeader ? events : [...headerEvents, ...events]),
      cursor,
      meta,
    };
  }
  return { events: activeBranchEvents(filepath, events), cursor, meta: null };
}
