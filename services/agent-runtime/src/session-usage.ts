import { statSync } from "node:fs";
import type { SessionUsageTotals } from "../../../shared/agent/session-usage";
import {
  canResumeFrom,
  readRolloutHead,
  type ResumePoint,
  rolloutCache,
  scanRolloutFrom,
} from "./rollout-cache";

export type { SessionUsageTotals } from "../../../shared/agent/session-usage";

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

type CacheEntry = ResumePoint & {
  size: number;
  mtimeMs: number;
  totals: SessionUsageTotals;
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
    const head = await readRolloutHead(filepath);

    // Nothing in memory — but a previous process may have scanned this file.
    // Read the stored prefix even though the rollout has since grown: that is
    // exactly what makes the scan resumable across a restart.
    const previous = cached ?? usageDisk.readStale(filepath);
    const resumable = canResumeFrom(previous, head, stat.size);

    if (resumable && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
      cache.set(filepath, previous);
      return previous.totals;
    }

    const { value: totals, scannedBytes } = resumable
      ? await scanRolloutFrom(filepath, previous.scannedBytes, previous.totals, accumulateUsageLine)
      : await scanRolloutFrom(filepath, 0, emptyUsageTotals(), accumulateUsageLine);

    const entry = { size: stat.size, mtimeMs: stat.mtimeMs, totals, scannedBytes, head };
    cache.set(filepath, entry);
    usageDisk.write(filepath, stat, entry);
    return totals;
  } catch {
    return emptyUsageTotals();
  }
}
