import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { resolveDataDir } from "@/lib/data-dir";

export type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  turnCount: number;
};

export type SessionEvent = Record<string, unknown> & { type?: string };

type ListSessionsOptions = {
  since?: Date;
};

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

function sessionsDirsForCwd(cwd: string): string[] {
  const encoded = encodeCwdForPi(cwd);
  return piSessionRoots().map((root) => path.join(root, encoded));
}

export function sessionsDirForCwd(cwd: string): string {
  return sessionsDirsForCwd(cwd)[0];
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
    // Pi writes per-message events. Older versions used `message_end`;
    // current versions use `message` with the message object nested under
    // `event.message`. Accept both shapes, and also tolerate a flat
    // `user_message` event with `content` directly on the event.
    if (event.type === "message" || event.type === "message_end") {
      const message = event.message as
        | { role?: string; content?: Array<{ type?: string; text?: string }> | string }
        | undefined;
      if (message?.role === "user") {
        turnCount += 1;
        if (!firstUserMessage) {
          let text: string | null = null;
          if (Array.isArray(message.content)) {
            text = message.content
              .filter((part) => part?.type === "text" && typeof part.text === "string")
              .map((part) => part.text as string)
              .join(" ")
              .trim();
          } else if (typeof message.content === "string") {
            text = message.content.trim();
          }
          if (text) firstUserMessage = text.slice(0, 120);
        }
      }
    } else if (event.type === "user_message") {
      turnCount += 1;
      if (!firstUserMessage) {
        const content = event.content as
          | string
          | Array<{ type?: string; text?: string }>
          | undefined;
        let text: string | null = null;
        if (Array.isArray(content)) {
          text = content
            .filter((part) => part?.type === "text" && typeof part.text === "string")
            .map((part) => part.text as string)
            .join(" ")
            .trim();
        } else if (typeof content === "string") {
          text = content.trim();
        }
        if (text) firstUserMessage = text.slice(0, 120);
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
  };
}

export async function listSessions(
  cwd: string,
  options: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const summariesById = new Map<string, SessionSummary>();
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    for (const filename of entries) {
      try {
        const filepath = path.join(dir, filename);
        if (options.since && statSync(filepath).mtime < options.since) continue;
        const summary = await readSessionSummary(filepath, filename);
        if (!summary?.id) continue;
        const existing = summariesById.get(summary.id);
        if (!existing || summary.updatedAt > existing.updatedAt) {
          summariesById.set(summary.id, summary);
        }
      } catch {
        // skip corrupted files
      }
    }
  }
  const summaries = [...summariesById.values()];
  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

function findSessionFile(cwd: string, sessionId: string): string | null {
  for (const dir of sessionsDirsForCwd(cwd)) {
    if (!existsSync(dir)) continue;
    const match = readdirSync(dir).find(
      (name) => name.endsWith(".jsonl") && (name.includes(sessionId) || name.startsWith(sessionId)),
    );
    if (match) return path.join(dir, match);
  }
  return null;
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

export async function deleteSession(cwd: string, sessionId: string): Promise<boolean> {
  const filepath = findSessionFile(cwd, sessionId);
  if (!filepath) return false;
  await unlink(filepath);
  return true;
}
