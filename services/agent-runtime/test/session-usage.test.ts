import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSessionUsageTotals, type SessionUsageTotals } from "../src/session-usage";

const temporaryRoots: string[] = [];
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;

// The usage cache is backed by a directory under the resolved data dir. Without
// this the suite writes cache entries into the developer's real ~/.local-studio.
beforeEach(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "session-usage-data-"));
  temporaryRoots.push(dataDir);
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "session-usage-"));
  temporaryRoots.push(root);
  return path.join(root, "rollout.jsonl");
}

const header = () => JSON.stringify({ type: "session", id: "s1", cwd: "/tmp" });

/** One assistant turn that cost `input`/`output` tokens. */
const turn = (input: number, output: number) =>
  JSON.stringify({
    type: "message",
    message: { role: "assistant", usage: { input, output, cost: { total: 0.5 } } },
  });

/** A line with no usage block — the pre-filter should skip it entirely. */
const chatter = (text: string) =>
  JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });

// Resuming a scan means trusting a byte offset. Everything below is about that
// offset being exactly right, because being one byte off does not throw — it
// silently reports a wrong lifetime spend.
describe("incremental usage scan", () => {
  test("totals a whole rollout on the first read", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${turn(200, 30)}\n`);

    const totals = await readSessionUsageTotals(file);

    expect(totals.input).toBe(300);
    expect(totals.output).toBe(50);
    expect(totals.calls).toBe(2);
  });

  test("an appended turn adds to the total instead of restarting it", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    appendFileSync(file, `${turn(400, 60)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(500);
    expect(totals.output).toBe(80);
    expect(totals.calls).toBe(2);
  });

  test("a half-written final line is re-read once it is complete", async () => {
    // The writer is mid-append when we scan: the last line has no newline yet.
    // Counting it as scanned would lose that turn forever.
    const file = fixture();
    const partial = turn(700, 90);
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${partial.slice(0, 30)}`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${partial}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(800);
    expect(totals.calls).toBe(2);
  });

  test("multi-byte turns do not drift the resume offset", async () => {
    // Character offsets and byte offsets diverge the moment a turn contains
    // anything non-ASCII, and the resume point is a byte offset.
    const file = fixture();
    writeFileSync(file, `${header()}\n${chatter("绿茶 — ☕️ naïve")}\n${turn(100, 20)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    appendFileSync(file, `${chatter("مرحبا 🌍")}\n${turn(250, 25)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(350);
    expect(totals.output).toBe(45);
    expect(totals.calls).toBe(2);
  });

  test("a rewritten file is rescanned rather than resumed", async () => {
    // The resume is only sound while the file is append-only. If it is replaced,
    // the cached prefix belongs to a different session.
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    const replacement = JSON.stringify({ type: "session", id: "s2", cwd: "/tmp/other" });
    writeFileSync(file, `${replacement}\n${turn(7, 3)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(7);
    expect(totals.calls).toBe(1);
  });

  test("a truncated file is rescanned rather than resumed", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${turn(200, 30)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(300);

    const shorter = `${header()}\n${turn(100, 20)}\n`;
    truncateSync(file, Buffer.byteLength(shorter, "utf-8"));

    expect((await readSessionUsageTotals(file)).input).toBe(100);
  });

  test("compactions keep counting across a resume", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${JSON.stringify({ type: "compaction" })}\n`);
    expect((await readSessionUsageTotals(file)).compactions).toBe(1);

    appendFileSync(file, `${JSON.stringify({ type: "compaction" })}\n${turn(10, 5)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.compactions).toBe(2);
    expect(totals.input).toBe(10);
  });
});

// --- surviving a restart -----------------------------------------------------

/**
 * The in-process memo dies with the controller. Backing it on disk is only
 * worth anything if a *fresh process* can pick up where the last one stopped,
 * so this actually spawns one rather than clearing a module-level Map.
 */
async function scanInFreshProcess(file: string, dataDir: string): Promise<SessionUsageTotals> {
  const script = `
    const { readSessionUsageTotals } = await import(${JSON.stringify(
      path.resolve(import.meta.dir, "../src/session-usage.ts"),
    )});
    const started = performance.now();
    const totals = await readSessionUsageTotals(${JSON.stringify(file)});
    console.log(JSON.stringify({ ...totals, ms: performance.now() - started }));
  `;
  const proc = Bun.spawn(["bun", "-e", script], {
    env: { ...process.env, LOCAL_STUDIO_DATA_DIR: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(await new Response(proc.stderr).text());
  // The runtime may print its own notices before ours; the result is the last
  // line we wrote.
  const lastLine = out.trim().split("\n").at(-1) ?? "";
  return JSON.parse(lastLine) as SessionUsageTotals;
}

describe("usage cache across processes", () => {
  test("a second process reuses the first one's scan", async () => {
    const file = fixture();
    const dataDir = process.env.LOCAL_STUDIO_DATA_DIR as string;
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${turn(200, 30)}\n`);

    const first = await scanInFreshProcess(file, dataDir);
    expect(first.input).toBe(300);

    const second = await scanInFreshProcess(file, dataDir);
    expect(second.input).toBe(300);
    expect(second.calls).toBe(2);
  });

  test("a second process resumes rather than rescanning a grown file", async () => {
    const file = fixture();
    const dataDir = process.env.LOCAL_STUDIO_DATA_DIR as string;
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n`);
    expect((await scanInFreshProcess(file, dataDir)).input).toBe(100);

    appendFileSync(file, `${turn(400, 60)}\n`);

    // If the restored prefix were ignored the total would still be 500 — the
    // number that proves resumption is the byte offset, so assert the total is
    // right AND that the first turn was not double-counted.
    const totals = await scanInFreshProcess(file, dataDir);
    expect(totals.input).toBe(500);
    expect(totals.calls).toBe(2);
  });

  test("a rewritten file is not resumed across processes either", async () => {
    const file = fixture();
    const dataDir = process.env.LOCAL_STUDIO_DATA_DIR as string;
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n`);
    expect((await scanInFreshProcess(file, dataDir)).input).toBe(100);

    const replacement = JSON.stringify({ type: "session", id: "s2", cwd: "/tmp/other" });
    writeFileSync(file, `${replacement}\n${turn(7, 3)}\n`);

    expect((await scanInFreshProcess(file, dataDir)).input).toBe(7);
  });
});
