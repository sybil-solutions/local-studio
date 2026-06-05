import { createReadStream, existsSync, realpathSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { resolveDataDir } from "@/lib/data-dir";
import { cleanSessionTitle } from "@/lib/agent/session/helpers";
import { sessionArchiveState } from "@/lib/agent/session-metadata-store";
import type { SessionSummary } from "@/lib/agent/session-summary";
export type { SessionSummary } from "@/lib/agent/session-summary";

export type SessionEvent = Record<string, unknown> & { type?: string };

type ListSessionsOptions = {
  since?: Date;
  ids?: string[];
  includeArchived?: boolean;
  archivedOnly?: boolean;
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
};

function summaryStartTime(session: Pick<SessionSummary, "startedAt" | "updatedAt">): number {
  const value = Date.parse(session.startedAt || session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

// Pi encodes the cwd by stripping the leading '/' and replacing remaining '/'
// with '-', then wrapping with '--' on both sides. Example:
//   /Users/sero/projects/vllm-studio  →  --Users-sero-projects-vllm-studio--
function encodeCwdForPi(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  const collapsed = normalized.replace(/^\//, "").replace(/\/+/g, "-");
  return `--${collapsed}--`;
}

function piSessionRoots(): string[] {
  const roots = [
    process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "sessions") : null,
    path.join(resolveDataDir(), "pi-agent", "sessions"),
    path.join(homedir(), ".pi", "agent", "sessions"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots.map((root) => path.resolve(root)))];
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
  return piSessionRoots().flatMap((root) => encodedCwds.map((encoded) => path.join(root, encoded)));
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

function userTurnFromEvent(event: Record<string, unknown>): UserTurn {
  if (event.type === "user_message") {
    return { isUser: true, text: piTextContent(event.content as PiMessageContent | undefined) };
  }
  if (event.type !== "message" && event.type !== "message_end") {
    return { isUser: false, text: null };
  }
  const message = event.message as { role?: string; content?: PiMessageContent } | undefined;
  if (message?.role !== "user") return { isUser: false, text: null };
  return { isUser: true, text: piTextContent(message.content) };
}

async function readSessionSummary(
  filepath: string,
  filename: string,
): Promise<SessionSummary | null> {
  const stats = statSync(filepath);
  let header: Record<string, unknown> | null = null;
  let firstUserMessage: string | null = null;
  let turnCount = 0;

  const stream = createReadStream(filepath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!header && event.type === "session") header = event;
    // Pi writes per-message events. Older versions used `message_end`; current
    // versions use `message`, and some callers still emit flat `user_message`.
    const userTurn = userTurnFromEvent(event);
    if (userTurn.isUser) {
      turnCount += 1;
      if (!firstUserMessage && userTurn.text) {
        firstUserMessage = cleanSessionTitle(userTurn.text.slice(0, 120)) || null;
      }
    }
  }

  if (!header) return null;
  return {
    id: typeof header.id === "string" ? header.id : "",
    filename,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    startedAt:
      typeof header.timestamp === "string" ? header.timestamp : stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
    modelId: typeof header.modelId === "string" ? header.modelId : null,
    provider: typeof header.provider === "string" ? header.provider : null,
    firstUserMessage,
    turnCount,
    archived: false,
    archivedAt: null,
  };
}

function applySessionMetadata(summary: SessionSummary): SessionSummary {
  const archiveState = sessionArchiveState(summary.id);
  return { ...summary, ...archiveState };
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
  dir: string,
  filename: string,
  options: NormalizedListSessionsOptions,
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
    if (options.wantedIds.size > 0 && !options.wantedIds.has(summary.id)) return null;
    const decorated = applySessionMetadata(summary);
    return summaryMatchesListOptions(decorated, options) ? decorated : null;
  } catch {
    return null;
  }
}

export async function listSessions(
  cwd: string,
  options: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const summariesById = new Map<string, SessionSummary>();
  const normalizedOptions = normalizeListOptions(options);
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir)) {
      const summary = await readListCandidate(dir, filename, normalizedOptions);
      const existing = summary ? summariesById.get(summary.id) : null;
      if (summary && (!existing || summary.updatedAt > existing.updatedAt)) {
        summariesById.set(summary.id, summary);
      }
    }
  }
  const summaries = [...summariesById.values()];
  summaries.sort((a, b) => summaryStartTime(b) - summaryStartTime(a));
  return summaries;
}

export function findSessionFile(cwd: string, sessionId: string): string | null {
  const matches: Array<{ filepath: string; mtime: number }> = [];
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl") || (!name.includes(sessionId) && !name.startsWith(sessionId))) {
        continue;
      }
      const filepath = path.join(dir, name);
      matches.push({ filepath, mtime: statSync(filepath).mtimeMs });
    }
  }
  return matches.sort((a, b) => b.mtime - a.mtime)[0]?.filepath ?? null;
}

// Stream-load every event from a session JSONL. Used to replay a past
// conversation back into the renderer's `applyPiEvent` pipeline.
export async function loadSession(cwd: string, sessionId: string): Promise<SessionEvent[]> {
  const filepath = findSessionFile(cwd, sessionId);
  if (!filepath) return [];
  const events: SessionEvent[] = [];
  const stream = createReadStream(filepath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as SessionEvent;
      events.push({ ...event });
    } catch {
      // skip corrupted lines
    }
  }
  return events;
}
