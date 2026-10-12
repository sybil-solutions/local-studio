import { createReadStream, statSync } from "node:fs";
import { rolloutCache } from "./rollout-cache";

/** Everything the session has spent, for the whole of its life.
 *
 *  This is deliberately NOT the context window. Context resets on every
 *  compaction; spend does not. A session that has compacted four times still
 *  cost what it cost, and that total is the number worth showing. */
export type SessionUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  /** Total cost in USD when the provider reports one; 0 for local models. */
  cost: number;
  /** Assistant round-trips, i.e. how many times a model was actually called. */
  calls: number;
  /** Successful compactions, each one a point where the context was discarded. */
  compactions: number;
};

export function emptyUsageTotals(): SessionUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
    cost: 0,
    calls: 0,
    compactions: 0,
  };
}

type CacheEntry = {
  size: number;
  mtimeMs: number;
  totals: SessionUsageTotals;
  /**
   * Byte offset just past the last COMPLETE line folded into `totals`. A
   * rollout is appended to while we read it, so the tail of a scan is often a
   * half-written line; resuming from `size` would start mid-JSON and silently
   * drop a turn's usage. Resuming from here re-reads that partial line instead.
   */
  scannedBytes: number;
  /** First bytes of the file, to notice a rewrite rather than an append. */
  head: string;
};

// Rollouts are append-only, so a file whose size and mtime are unchanged has
// unchanged totals — and one that has only grown needs just its new bytes read.
// Keyed by path; one entry per session file.
const cache = new Map<string, CacheEntry>();

/**
 * The same memo, on disk, so a controller restart does not re-scan every large
 * rollout from zero. The stored entry carries its own size/mtime/head, so a
 * stale read is still useful: it is the prefix to resume from.
 */
const usageDisk = rolloutCache<CacheEntry>("usage-totals");

/**
 * Guard against the append-only assumption being wrong. If a session file is
 * ever replaced rather than extended, its opening bytes change, and resuming
 * mid-file would fold a stranger's numbers into this session's total. Cheap
 * enough to check every time: one small read at a fixed offset.
 */
const HEAD_FINGERPRINT_BYTES = 512;

async function readHead(filepath: string): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(filepath, { start: 0, end: HEAD_FINGERPRINT_BYTES - 1 });
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

type ScanResult = { totals: SessionUsageTotals; scannedBytes: number };

/**
 * Fold every complete line from `start` onward into `totals`.
 *
 * Splits on newlines by hand rather than using readline because the resume
 * point has to be a byte offset: line lengths in characters are not byte
 * offsets once any turn contains non-ASCII, and being one byte off here
 * corrupts every subsequent total.
 */
async function scanFrom(
  filepath: string,
  start: number,
  seed: SessionUsageTotals,
): Promise<ScanResult> {
  let totals = seed;
  let consumedBytes = start;
  let pending = "";

  const stream = createReadStream(filepath, { start, encoding: "utf-8" });
  for await (const chunk of stream) {
    pending += chunk as string;
    // Walk the buffer with a cursor and slice the remainder once per chunk.
    // Re-slicing `pending` per line instead is quadratic in chunk size, which
    // cost more than the readline call this replaced.
    let lineStart = 0;
    let newline = pending.indexOf("\n", lineStart);
    while (newline !== -1) {
      const line = pending.slice(lineStart, newline);
      if (line) totals = accumulateUsageLine(totals, line);
      consumedBytes += Buffer.byteLength(line, "utf-8") + 1;
      lineStart = newline + 1;
      newline = pending.indexOf("\n", lineStart);
    }
    pending = pending.slice(lineStart);
  }
  // `pending` is whatever followed the last newline — a partial write, or a
  // final line with no trailing newline. Either way it is not counted as
  // scanned, so the next call re-reads it.
  return { totals, scannedBytes: consumedBytes };
}

function numeric(source: Record<string, unknown> | null, keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Fold one rollout line into the running totals. */
export function accumulateUsageLine(totals: SessionUsageTotals, line: string): SessionUsageTotals {
  // Cheap pre-filter: the vast majority of lines are tool output and user text
  // with no usage block at all, and JSON.parse on a multi-GB log is the whole
  // cost of this scan.
  const hasUsage = line.includes('"usage"');
  const hasCompaction = line.includes("compaction");
  if (!hasUsage && !hasCompaction) return totals;

  let entry: Record<string, unknown> | null = null;
  try {
    entry = asRecord(JSON.parse(line));
  } catch {
    return totals;
  }
  if (!entry) return totals;

  if (entry.type === "compaction" || entry.customType === "compaction") {
    return { ...totals, compactions: totals.compactions + 1 };
  }

  const message = asRecord(entry.message);
  if (!message || message.role !== "assistant") return totals;
  const usage = asRecord(message.usage);
  if (!usage) return totals;

  const input = numeric(usage, ["input", "input_tokens", "prompt_tokens"]);
  const output = numeric(usage, ["output", "output_tokens", "completion_tokens"]);
  const cacheRead = numeric(usage, ["cacheRead", "cache_read_input_tokens"]);
  const cacheWrite = numeric(usage, ["cacheWrite", "cache_creation_input_tokens"]);
  const reasoning = numeric(usage, ["reasoning", "reasoning_tokens"]);
  const reported = numeric(usage, ["totalTokens", "total_tokens", "total"]);
  const cost = numeric(asRecord(usage.cost), ["total"]);

  return {
    input: totals.input + input,
    output: totals.output + output,
    cacheRead: totals.cacheRead + cacheRead,
    cacheWrite: totals.cacheWrite + cacheWrite,
    reasoning: totals.reasoning + reasoning,
    total: totals.total + (reported || input + output),
    cost: totals.cost + cost,
    calls: totals.calls + 1,
    compactions: totals.compactions,
  };
}

/** Walk a rollout and total what it spent.
 *
 *  Streams so memory stays flat regardless of file size, and never reads the
 *  same byte twice: an unchanged file returns the cached totals, and a grown
 *  one is resumed from the end of the last complete line rather than rescanned
 *  from zero. The status panel asks for this on every session open, and the
 *  session you are actively using is exactly the one whose file keeps growing —
 *  rescanning from zero made the busiest session the slowest to open. */
export async function readSessionUsageTotals(filepath: string): Promise<SessionUsageTotals> {
  let stat: { size: number; mtimeMs: number };
  try {
    stat = statSync(filepath);
  } catch {
    return emptyUsageTotals();
  }

  const cached = cache.get(filepath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.totals;
  }

  try {
    const head = await readHead(filepath);

    // Nothing in memory — but a previous process may have scanned this file.
    // Read the stored prefix even though the rollout has since grown: that is
    // exactly what makes the scan resumable across a restart.
    const previous = cached ?? usageDisk.readStale(filepath);

    // Resume only when this is the same file, grown. A shrunken file or a
    // changed head means it was rewritten, and the cached prefix is no longer
    // ours to trust.
    const resumable =
      previous !== undefined &&
      previous.head === head &&
      stat.size >= previous.scannedBytes &&
      previous.scannedBytes > 0;

    if (resumable && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
      cache.set(filepath, previous);
      return previous.totals;
    }

    const { totals, scannedBytes } = resumable
      ? await scanFrom(filepath, previous.scannedBytes, previous.totals)
      : await scanFrom(filepath, 0, emptyUsageTotals());

    const entry = { size: stat.size, mtimeMs: stat.mtimeMs, totals, scannedBytes, head };
    cache.set(filepath, entry);
    usageDisk.write(filepath, stat, entry);
    return totals;
  } catch {
    return emptyUsageTotals();
  }
}
