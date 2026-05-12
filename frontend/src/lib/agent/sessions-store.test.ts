import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listSessions, loadSession } from "./sessions-store";

const originalEnv = { ...process.env };
const roots: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const encodeCwdForPi = (cwd: string): string => {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  const collapsed = normalized.replace(/^\//, "").replace(/\/+/g, "-");
  return `--${collapsed}--`;
};

describe("session store", () => {
  it("hydrates sessions saved under Pi's resolved cwd", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-sessions-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-agent");

    const actualCwd = path.join(root, "actual");
    const linkedCwd = path.join(root, "linked");
    mkdirSync(actualCwd, { recursive: true });
    symlinkSync(actualCwd, linkedCwd);
    const piCwd = realpathSync.native(actualCwd);

    const sessionId = "session-realpath";
    const sessionDir = path.join(
      process.env.PI_CODING_AGENT_DIR,
      "sessions",
      encodeCwdForPi(piCwd),
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, `2026-05-10T00-00-00-000Z_${sessionId}.jsonl`),
      [
        JSON.stringify({ type: "session", id: sessionId, cwd: piCwd }),
        JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
      ].join("\n"),
    );

    const events = await loadSession(linkedCwd, sessionId);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "session", id: sessionId });
  });

  it("orders sessions by start time instead of later file updates", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-sessions-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-agent");

    const cwd = path.join(root, "project");
    const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", encodeCwdForPi(cwd));
    mkdirSync(sessionDir, { recursive: true });
    const older = path.join(sessionDir, "older.jsonl");
    const newer = path.join(sessionDir, "newer.jsonl");
    writeFileSync(
      older,
      JSON.stringify({ type: "session", id: "older", cwd, timestamp: "2026-05-10T00:00:00.000Z" }),
    );
    writeFileSync(
      newer,
      JSON.stringify({ type: "session", id: "newer", cwd, timestamp: "2026-05-10T00:05:00.000Z" }),
    );
    utimesSync(older, new Date("2026-05-10T00:20:00.000Z"), new Date("2026-05-10T00:20:00.000Z"));
    utimesSync(newer, new Date("2026-05-10T00:10:00.000Z"), new Date("2026-05-10T00:10:00.000Z"));

    await expect(listSessions(cwd)).resolves.toMatchObject([{ id: "newer" }, { id: "older" }]);
  });

  it("can restrict summaries to requested ids without hydrating every session", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-sessions-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-agent");

    const cwd = path.join(root, "project");
    const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", encodeCwdForPi(cwd));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, "2026-05-10T00-00-00-000Z_session-a.jsonl"),
      JSON.stringify({ type: "session", id: "session-a", cwd }),
    );
    writeFileSync(
      path.join(sessionDir, "2026-05-10T00-01-00-000Z_session-b.jsonl"),
      JSON.stringify({ type: "session", id: "session-b", cwd }),
    );

    await expect(listSessions(cwd, { ids: ["session-b"] })).resolves.toMatchObject([
      { id: "session-b" },
    ]);
  });

  it("summarizes user turns from current and legacy Pi event shapes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-sessions-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-agent");

    const cwd = path.join(root, "project");
    const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", encodeCwdForPi(cwd));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, "2026-05-10T00-00-00-000Z_session-summary.jsonl"),
      [
        JSON.stringify({ type: "session", id: "session-summary", cwd }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "text", text: "first" },
              { type: "image", text: "ignored" },
              { type: "text", text: "turn" },
            ],
          },
        }),
        JSON.stringify({ type: "message_end", message: { role: "assistant", content: "ok" } }),
        JSON.stringify({ type: "user_message", content: "second turn" }),
      ].join("\n"),
    );

    await expect(listSessions(cwd)).resolves.toMatchObject([
      { id: "session-summary", firstUserMessage: "first turn", turnCount: 2 },
    ]);
  });

  it("loads the newest matching session file when duplicate roots exist", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-sessions-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-agent");

    const cwd = path.join(root, "project");
    const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", encodeCwdForPi(cwd));
    mkdirSync(sessionDir, { recursive: true });
    const oldFile = path.join(sessionDir, "old_session-dupe.jsonl");
    const newFile = path.join(sessionDir, "new_session-dupe.jsonl");
    writeFileSync(
      oldFile,
      [
        JSON.stringify({ type: "session", id: "session-dupe", cwd }),
        JSON.stringify({ type: "message", message: { role: "user", content: "old" } }),
      ].join("\n"),
    );
    writeFileSync(
      newFile,
      [
        JSON.stringify({ type: "session", id: "session-dupe", cwd }),
        JSON.stringify({ type: "message", message: { role: "user", content: "new" } }),
      ].join("\n"),
    );
    utimesSync(oldFile, new Date("2026-05-10T00:00:00.000Z"), new Date("2026-05-10T00:00:00.000Z"));
    utimesSync(newFile, new Date("2026-05-10T00:10:00.000Z"), new Date("2026-05-10T00:10:00.000Z"));

    const events = await loadSession(cwd, "session-dupe");

    expect(events[1]).toMatchObject({ message: { role: "user", content: "new" } });
  });
});
