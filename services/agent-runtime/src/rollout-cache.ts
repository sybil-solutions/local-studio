//
// Disk-backed memo for per-rollout derived data.
//
// Two things a session open needs — the active-branch id set and the lifetime
// usage totals — cost a full pass over the rollout to compute. Both are already
// memoised in process on (size, mtime). That is not enough: the expensive
// sessions are the large ones, and a controller restart drops every entry, so
// the first open of a big session after a restart re-pays the whole thing. On
// the largest rollout on this machine (3.56 GB) that is ~25s for the branch
// walk alone.
//
// Persisting the same memo turns once-per-process into once-ever.
//
// The cache is strictly derived data: a miss, a corrupt file, an unwritable
// directory, and a schema change all degrade to "recompute", never to an error
// and never to a wrong answer. Nothing here is authoritative.
//

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./data-dir";

/**
 * Bump when the shape of any cached payload changes. Entries written by an
 * older build are ignored rather than misread — cheaper and safer than
 * migrating derived data we can always recompute.
 */
const CACHE_SCHEMA = 1;

type Envelope<T> = {
  schema: number;
  /** Rollout size in bytes when the value was computed. */
  size: number;
  /** Rollout mtime in ms when the value was computed. */
  mtimeMs: number;
  value: T;
};

function cacheRoot(): string {
  return path.join(resolveDataDir(), "rollout-cache");
}

/**
 * Rollout paths are long, contain the encoded cwd, and are not filename-safe.
 * Hash them, and keep a readable prefix so the directory can be eyeballed.
 */
function cacheFileFor(kind: string, filepath: string, extension = ".json"): string {
  const digest = createHash("sha256").update(path.resolve(filepath)).digest("hex").slice(0, 32);
  const readable = (path.basename(filepath).match(/^[\w.-]{0,40}/)?.[0] ?? "rollout").replace(
    /\.jsonl$/,
    "",
  );
  return path.join(cacheRoot(), kind, `${readable}.${digest}${extension}`);
}

/**
 * A path this rollout owns inside the cache, for callers that need a real file
 * rather than a JSON envelope — the transcript sidecar is a `.jsonl` that gets
 * read with the same tail scanner as the rollout itself.
 */
export function rolloutCacheFilePath(kind: string, filepath: string, extension: string): string {
  return cacheFileFor(kind, filepath, extension);
}

/** Omit size/mtime to accept the entry whatever the rollout looks like now. */
function readEnvelope<T>(file: string, size?: number, mtimeMs?: number): T | undefined {
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8")) as Envelope<T>;
  } catch {
    return undefined;
  }
  if (parsed?.schema !== CACHE_SCHEMA) return undefined;
  if (size !== undefined && parsed.size !== size) return undefined;
  if (mtimeMs !== undefined && parsed.mtimeMs !== mtimeMs) return undefined;
  return parsed.value;
}

/**
 * Entries are keyed by rollout path, and rollouts are deleted, renamed and
 * archived without telling us. Nothing would ever remove those entries, so the
 * directory would grow for the life of the install. Cap it: when a kind's
 * directory exceeds the limit, drop the least recently used entries.
 *
 * The cost of over-evicting is one recomputation, so this can be crude.
 */
const MAX_ENTRIES_PER_KIND = 512;

/**
 * Evict least-recently-used entries from a cache directory.
 *
 * Exported because the transcript sidecar is a `.jsonl` living in its own
 * directory rather than a JSON envelope, so it does not pass through
 * `writeEnvelope` and would otherwise accumulate one file per session opened,
 * forever, at roughly 5% of each rollout's size.
 */
export function evictIfCrowded(directory: string, extension = ".json"): void {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(extension));
  } catch {
    return;
  }
  if (names.length <= MAX_ENTRIES_PER_KIND) return;

  const byAge = names
    .map((name) => {
      const file = path.join(directory, name);
      try {
        return { file, atimeMs: statSync(file).atimeMs };
      } catch {
        return { file, atimeMs: 0 };
      }
    })
    .sort((a, b) => a.atimeMs - b.atimeMs);

  for (const { file } of byAge.slice(0, byAge.length - MAX_ENTRIES_PER_KIND)) {
    try {
      unlinkSync(file);
    } catch {
      // Another process got there first, or the entry is locked; either is fine.
    }
  }
}

function writeEnvelope<T>(file: string, envelope: Envelope<T>): void {
  try {
    const directory = path.dirname(file);
    mkdirSync(directory, { recursive: true });
    // Write-then-rename: a reader must never see a half-written entry, and two
    // agent-runtime processes opening the same session would otherwise
    // interleave into one corrupt file.
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(envelope), "utf-8");
    renameSync(temporary, file);
    evictIfCrowded(directory);
  } catch {
    // A cache that cannot be written is still a correct cache.
  }
}

export type RolloutCache<T> = {
  /** Cached value for this rollout, or undefined if it must be recomputed. */
  read(filepath: string, stat: { size: number; mtimeMs: number }): T | undefined;
  /**
   * The stored value regardless of whether the rollout has changed since.
   *
   * For a whole-file answer a stale entry is useless, but for a *resumable*
   * one it is the entire point: the usage scan wants the prefix it computed
   * last time so it can read only the bytes appended since. The caller owns
   * deciding whether the staleness is the kind it can resume from.
   */
  readStale(filepath: string): T | undefined;
  /** Record a freshly computed value against the stat it was computed from. */
  write(filepath: string, stat: { size: number; mtimeMs: number }, value: T): void;
  /** Drop this rollout's entry — used when the on-disk value is proven stale. */
  forget(filepath: string): void;
};

/**
 * A named disk cache. `kind` becomes a subdirectory, so each caller's entries
 * can be inspected and invalidated independently.
 *
 * `serialize`/`deserialize` exist because the most valuable payload is a Set of
 * ids, and JSON has no Set.
 */
export function rolloutCache<T, S = T>(
  kind: string,
  codec?: { serialize: (value: T) => S; deserialize: (raw: S) => T },
): RolloutCache<T> {
  const decode = (raw: S): T | undefined => {
    try {
      return codec ? codec.deserialize(raw) : (raw as unknown as T);
    } catch {
      return undefined;
    }
  };

  return {
    read(filepath, stat) {
      const raw = readEnvelope<S>(cacheFileFor(kind, filepath), stat.size, stat.mtimeMs);
      return raw === undefined ? undefined : decode(raw);
    },
    readStale(filepath) {
      const raw = readEnvelope<S>(cacheFileFor(kind, filepath));
      return raw === undefined ? undefined : decode(raw);
    },
    write(filepath, stat, value) {
      writeEnvelope(cacheFileFor(kind, filepath), {
        schema: CACHE_SCHEMA,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        value: codec ? codec.serialize(value) : (value as unknown as S),
      });
    },
    forget(filepath) {
      try {
        unlinkSync(cacheFileFor(kind, filepath));
      } catch {
        // Already gone, or never written.
      }
    },
  };
}

/** stat a rollout, or undefined when it has disappeared. */
export function statRollout(filepath: string): { size: number; mtimeMs: number } | undefined {
  try {
    const { size, mtimeMs } = statSync(filepath);
    return { size, mtimeMs };
  } catch {
    return undefined;
  }
}
