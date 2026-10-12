import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { encodeCwdForPi, findSessionFile, loadSession } from "../src/sessions-store";

// Characterisation of `tail` / `before` paging.
//
// These exist because the cursor is a raw byte offset into the rollout and
// nothing pinned its behaviour. Any change to how the tail region is read has
// to keep every property below true: pages must tile the transcript exactly
// once, in order, and terminate. Getting this wrong does not throw — it
// silently drops or duplicates a stretch of someone's conversation.

const temporaryRoots: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;

beforeEach(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "session-paging-data-"));
  temporaryRoots.push(dataDir);
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const NO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * A rollout of `turns` user/assistant pairs, optionally padded with inert
 * `custom` entries between every turn — which is what real sessions look like
 * once an extension is writing state snapshots into the log.
 *
 * Built through SessionManager rather than hand-written JSONL: entries are a
 * parentId tree, and a hand-written file has no valid chain, so the
 * active-branch filter correctly discards all of it. (Learned the hard way —
 * the first version of this suite "failed" against perfectly good code.)
 */
function writeRollout(options: { turns: number; inertPerTurn?: number; inertBytes?: number }): {
  cwd: string;
  sessionId: string;
  /** Continue the same session, so the sidecar has to extend rather than rebuild. */
  appendTurns: (count: number) => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "session-paging-"));
  temporaryRoots.push(root);
  const agentDir = path.join(root, "pi-agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = path.join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const sessionDir = path.join(agentDir, "sessions", encodeCwdForPi(cwd));
  mkdirSync(sessionDir, { recursive: true });

  const manager = SessionManager.create(cwd, sessionDir, { id: "paging-session" });
  const padding = "x".repeat(options.inertBytes ?? 512);
  let written = 0;

  const appendTurns = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      const turn = written + index;
      manager.appendMessage({
        role: "user",
        content: [{ type: "text", text: `ask ${turn}` }],
        timestamp: Date.now(),
      });
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: `answer ${turn}` }],
        provider: "fake",
        model: "fake",
        usage: NO_USAGE,
        stopReason: "stop",
        timestamp: Date.now(),
      });
      for (let n = 0; n < (options.inertPerTurn ?? 0); n += 1) {
        manager.appendCustomEntry("noisy-extension:state", { padding, turn, n });
      }
    }
    written += count;
  };

  appendTurns(options.turns);
  return { cwd, sessionId: manager.getSessionId(), appendTurns };
}

const textOf = (event: Record<string, unknown>): string => {
  const message = event.message as { content?: Array<{ text?: string }> } | undefined;
  return message?.content?.[0]?.text ?? "";
};

/** Walk every page back to the start, newest page first. */
async function readAllPages(
  cwd: string,
  sessionId: string,
  tail: number,
): Promise<{ pages: string[][]; requests: number }> {
  const pages: string[][] = [];
  let cursor: number | null | undefined;
  let requests = 0;

  for (;;) {
    const page =
      requests === 0
        ? await loadSession(cwd, sessionId, { tail })
        : await loadSession(cwd, sessionId, { before: cursor as number });
    requests += 1;
    pages.push(page.events.map(textOf).filter(Boolean));
    if (page.cursor === null || page.cursor === undefined) break;
    if (cursor !== undefined && page.cursor === cursor) {
      throw new Error(`cursor stalled at ${page.cursor} — paging would never terminate`);
    }
    cursor = page.cursor;
    if (requests > 200) throw new Error("paging did not terminate within 200 requests");
  }
  return { pages, requests };
}

describe("session paging", () => {
  test("a tail smaller than the transcript leaves a cursor for the rest", async () => {
    const { cwd, sessionId } = writeRollout({ turns: 40 });

    const page = await loadSession(cwd, sessionId, { tail: 5 });

    expect(page.events.length).toBeGreaterThan(0);
    expect(page.cursor).not.toBeNull();
    // Whatever the boundary rule is, the newest turn must be on the first page.
    expect(page.events.map(textOf)).toContain("answer 39");
  });

  test("a tail larger than the transcript reads the whole thing and ends paging", async () => {
    const { cwd, sessionId } = writeRollout({ turns: 6 });

    const page = await loadSession(cwd, sessionId, { tail: 500 });

    expect(page.cursor).toBeNull();
    expect(page.events.map(textOf)).toContain("ask 0");
    expect(page.events.map(textOf)).toContain("answer 5");
  });

  test("pages tile the transcript exactly once, in order", async () => {
    const { cwd, sessionId } = writeRollout({ turns: 40 });

    const { pages } = await readAllPages(cwd, sessionId, 5);
    // Pages come newest-first; concatenating oldest-first must rebuild the log.
    const rebuilt = pages.reverse().flat();
    const expected: string[] = [];
    for (let turn = 0; turn < 40; turn += 1) expected.push(`ask ${turn}`, `answer ${turn}`);

    expect(rebuilt).toEqual(expected);
  });

  test("paging terminates on a rollout padded with inert entries", async () => {
    // The shape that made this worth pinning: most of the file is extension
    // noise, so the scan crosses long stretches containing no message at all.
    const { cwd, sessionId } = writeRollout({ turns: 30, inertPerTurn: 8, inertBytes: 2048 });

    const { pages, requests } = await readAllPages(cwd, sessionId, 4);
    const rebuilt = pages.reverse().flat();
    const expected: string[] = [];
    for (let turn = 0; turn < 30; turn += 1) expected.push(`ask ${turn}`, `answer ${turn}`);

    expect(rebuilt).toEqual(expected);
    expect(requests).toBeLessThan(200);
  });

  test("inert entries never reach the transcript", async () => {
    const { cwd, sessionId } = writeRollout({ turns: 10, inertPerTurn: 5 });

    const page = await loadSession(cwd, sessionId, { tail: 500 });

    expect(page.events.some((event) => event.type === "custom")).toBe(false);
  });

  test("each cursor is strictly earlier than the one before it", async () => {
    // Monotonic decrease is what guarantees termination; a cursor that stands
    // still or moves forward is an infinite "load earlier" loop in the UI.
    //
    // A fixture small enough to run fast finishes in a couple of pages — the
    // backward scan reads in 8MB chunks — so this asserts the ordering property
    // over however many cursors occur. Multi-page tiling is covered above.
    const { cwd, sessionId } = writeRollout({ turns: 30, inertPerTurn: 8, inertBytes: 2048 });

    const cursors: number[] = [];
    let cursor: number | null = (await loadSession(cwd, sessionId, { tail: 4 })).cursor;
    while (cursor !== null && cursors.length < 100) {
      cursors.push(cursor);
      cursor = (await loadSession(cwd, sessionId, { before: cursor })).cursor;
    }

    expect(cursors.length).toBeGreaterThan(0);
    for (let index = 1; index < cursors.length; index += 1) {
      expect(cursors[index]).toBeLessThan(cursors[index - 1]);
    }
  });
});

// --- the de-noised sidecar ---------------------------------------------------

/**
 * Paging reads from a sidecar containing only the non-inert lines. These pin
 * the properties that makes that substitution safe: same transcript, same
 * order, and a clean fall back to the rollout when the sidecar cannot be built.
 */
describe("transcript sidecar", () => {
  test("is smaller than the rollout and holds no inert entries", async () => {
    const { cwd, sessionId } = writeRollout({ turns: 20, inertPerTurn: 10, inertBytes: 4096 });

    await loadSession(cwd, sessionId, { tail: 500 });

    const cacheDir = path.join(process.env.LOCAL_STUDIO_DATA_DIR as string, "rollout-cache");
    const sidecars = readdirSync(path.join(cacheDir, "transcript"));
    expect(sidecars.length).toBe(1);

    const sidecar = path.join(cacheDir, "transcript", sidecars[0]);
    const body = readFileSync(sidecar, "utf-8");
    expect(body).not.toContain("noisy-extension:state");
    expect(body).toContain("answer 19");

    const rollout = findSessionFile(cwd, sessionId) as string;
    expect(statSync(sidecar).size).toBeLessThan(statSync(rollout).size / 5);
  });

  test("extends rather than rebuilds when the session grows, and still tiles", async () => {
    const { cwd, sessionId, appendTurns } = writeRollout({ turns: 10, inertPerTurn: 4 });
    await loadSession(cwd, sessionId, { tail: 500 });

    appendTurns(10);

    const { pages } = await readAllPages(cwd, sessionId, 4);
    const rebuilt = pages.reverse().flat();
    const expected: string[] = [];
    for (let turn = 0; turn < 20; turn += 1) expected.push(`ask ${turn}`, `answer ${turn}`);

    expect(rebuilt).toEqual(expected);
  });

  test("falls back to the rollout when the sidecar cannot be written", async () => {
    const { cwd, sessionId } = writeRollout({ turns: 12, inertPerTurn: 3 });
    // Occupy the sidecar directory's name with a regular file, so creating it
    // fails. The reader has to carry on against the original rollout rather
    // than returning nothing — the sidecar is an optimisation, never a
    // dependency.
    const cacheDir = path.join(process.env.LOCAL_STUDIO_DATA_DIR as string, "rollout-cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, "transcript"), "not a directory", "utf-8");

    const page = await loadSession(cwd, sessionId, { tail: 500 });

    expect(page.events.map(textOf)).toContain("ask 0");
    expect(page.events.map(textOf)).toContain("answer 11");
    expect(page.events.some((event) => event.type === "custom")).toBe(false);
  });
});
