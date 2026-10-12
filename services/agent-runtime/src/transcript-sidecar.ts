//
// A rollout with the noise removed.
//
// 91-95% of a real rollout is `custom` / `custom_message` entries written by pi
// extensions on every turn — state snapshots that are inert to the transcript
// and thrown away on every read (see bench/rollout-census.bench.ts). Paging the
// transcript therefore means scanning 40-145 MB to find a few hundred messages,
// and no amount of seeking helps because the messages are interleaved
// throughout rather than clustered at the end.
//
// So keep a second copy containing only the lines that matter. It is a plain
// `.jsonl` in the same format, which is the point: `readTailRegion` runs over it
// unchanged, and cursors stay opaque byte offsets — just into a file that is
// twenty times smaller.
//
// Both files are append-only, so the sidecar is extended rather than rebuilt as
// the session grows, and a cursor handed out for an earlier page stays valid.
//

import { appendFileSync, createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  evictIfCrowded,
  rolloutCache,
  rolloutCacheFilePath,
  statRollout,
} from "./rollout-cache";

const SIDECAR_KIND = "transcript";

/**
 * Mirrors `isInertEvent` in sessions-store. Checked as a byte prefix on the raw
 * line so the common case never pays for `JSON.parse`.
 */
const INERT_PREFIXES = ['{"type":"custom"', '{"type":"custom_message"'];

function lineIsInert(line: string): boolean {
  for (const prefix of INERT_PREFIXES) {
    if (line.startsWith(prefix)) return true;
  }
  // Backstop for logs whose key order differs from what pi writes today.
  if (!line.includes('"custom')) return false;
  try {
    const type = (JSON.parse(line) as { type?: string }).type;
    return type === "custom" || type === "custom_message";
  } catch {
    return false;
  }
}

type SidecarState = {
  /** Source size when the sidecar was last extended. */
  sourceSize: number;
  sourceMtimeMs: number;
  /** Offset in the SOURCE just past the last complete line copied. */
  scannedBytes: number;
  /** Opening bytes of the source, to notice a rewrite rather than an append. */
  head: string;
};

const state = rolloutCache<SidecarState>("transcript-state");

const HEAD_FINGERPRINT_BYTES = 512;

async function readHead(filepath: string): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(filepath, { start: 0, end: HEAD_FINGERPRINT_BYTES - 1 });
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Copy every complete non-inert line from `start` onward onto the sidecar.
 * Returns the source offset just past the last complete line consumed — a
 * partial trailing line is left for the next call, exactly as the usage scan
 * does, because a rollout is appended to while it is being read.
 */
async function appendFrom(source: string, sidecar: string, start: number): Promise<number> {
  let consumedBytes = start;
  let pending = "";
  let batch: string[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    appendFileSync(sidecar, `${batch.join("\n")}\n`, "utf-8");
    batch = [];
  };

  const stream = createReadStream(source, { start, encoding: "utf-8" });
  for await (const chunk of stream) {
    pending += chunk as string;
    let lineStart = 0;
    let newline = pending.indexOf("\n", lineStart);
    while (newline !== -1) {
      const line = pending.slice(lineStart, newline);
      consumedBytes += Buffer.byteLength(line, "utf-8") + 1;
      if (line && !lineIsInert(line)) batch.push(line);
      lineStart = newline + 1;
      newline = pending.indexOf("\n", lineStart);
    }
    pending = pending.slice(lineStart);
    // Bounded so a multi-GB rollout never buffers its whole transcript.
    if (batch.length >= 2048) flush();
  }
  flush();
  return consumedBytes;
}

export type TranscriptSource = { filepath: string; size: number };

/**
 * The file to page the transcript from: the sidecar when one can be built,
 * otherwise the rollout itself.
 *
 * Never throws and never blocks correctness — every failure path returns the
 * original rollout, which reads identically, just slower.
 */
export async function transcriptSource(filepath: string): Promise<TranscriptSource> {
  const original = (): TranscriptSource => ({
    filepath,
    size: statRollout(filepath)?.size ?? 0,
  });

  const stat = statRollout(filepath);
  if (!stat) return original();

  try {
    const sidecar = rolloutCacheFilePath(SIDECAR_KIND, filepath, ".jsonl");
    const head = await readHead(filepath);
    const previous = state.readStale(filepath);

    const sidecarSize = (() => {
      try {
        return statSync(sidecar).size;
      } catch {
        return -1;
      }
    })();

    // Extend only when this is the same file, grown, and the sidecar we built
    // for it is still there. Anything else means starting over.
    const resumable =
      previous !== undefined &&
      previous.head === head &&
      stat.size >= previous.scannedBytes &&
      previous.scannedBytes > 0 &&
      sidecarSize >= 0;

    if (resumable && previous.sourceSize === stat.size && previous.sourceMtimeMs === stat.mtimeMs) {
      return { filepath: sidecar, size: sidecarSize };
    }

    mkdirSync(path.dirname(sidecar), { recursive: true });
    if (!resumable) writeFileSync(sidecar, "", "utf-8");

    const scannedBytes = await appendFrom(filepath, sidecar, resumable ? previous.scannedBytes : 0);
    state.write(filepath, stat, {
      sourceSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      scannedBytes,
      head,
    });
    // Sidecars are ~5% of their rollout but there is one per session ever
    // opened, so they need the same bound the envelopes get.
    evictIfCrowded(path.dirname(sidecar), ".jsonl");

    return { filepath: sidecar, size: statSync(sidecar).size };
  } catch {
    return original();
  }
}
