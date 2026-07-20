import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findSessionFile } from "../src/sessions-store";

const originalPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryRoots: string[] = [];

afterEach(() => {
  if (originalPiCodingAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiCodingAgentDir;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function encodeCwdForPi(cwd: string): string {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  const collapsed = normalized.replace(/^\//, "").replace(/\/+/g, "-");
  return `--${collapsed}--`;
}

function createFixture(): { cwd: string; sessionDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-session-lookup-"));
  temporaryRoots.push(root);
  const agentDir = path.join(root, "pi-agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = path.join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const sessionDir = path.join(agentDir, "sessions", encodeCwdForPi(cwd));
  mkdirSync(sessionDir, { recursive: true });
  return { cwd, sessionDir };
}

function writeSession(
  sessionDir: string,
  timestamp: string,
  filenameId: string,
  headerId = filenameId,
): string {
  const filepath = path.join(sessionDir, `${timestamp}_${filenameId}.jsonl`);
  writeFileSync(
    filepath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: headerId,
      timestamp: "2026-07-20T12:00:00.000Z",
      cwd: path.dirname(sessionDir),
    })}\n`,
  );
  return filepath;
}

describe("findSessionFile", () => {
  test("resolves an exact Pi session identity from a canonical filename", () => {
    const { cwd, sessionDir } = createFixture();
    const sessionId = "019ee398-14e2-7ad1-af6c-f79b45dabacd";
    const filepath = writeSession(sessionDir, "2026-07-20T12-00-00-000Z", sessionId);

    expect(findSessionFile(cwd, sessionId)).toBe(filepath);
  });

  test("does not resolve a short ID contained inside a longer session filename", () => {
    const { cwd, sessionDir } = createFixture();
    const sessionId = "019ee398-14e2-7ad1-af6c-f79b45dabacd";
    writeSession(sessionDir, "2026-07-20T12-00-00-000Z", sessionId);

    expect(findSessionFile(cwd, "019ee398")).toBeNull();
  });

  test("rejects an identity that maps to multiple session files", () => {
    const { cwd, sessionDir } = createFixture();
    const sessionId = "019ee398-14e2-7ad1-af6c-f79b45dabacd";
    writeSession(sessionDir, "2026-07-20T12-00-00-000Z", sessionId);
    writeSession(sessionDir, "2026-07-20T13-00-00-000Z", sessionId);

    expect(findSessionFile(cwd, sessionId)).toBeNull();
  });

  test("rejects traversal and special-character identifiers", () => {
    const { cwd } = createFixture();
    for (const invalidId of [
      "",
      "../session",
      "../../etc/passwd",
      "session/child",
      "session\\child",
      "session with spaces",
      "session%2Fchild",
      "_leading",
      "trailing-",
      ".",
      "session\0id",
    ]) {
      expect(findSessionFile(cwd, invalidId)).toBeNull();
    }
  });

  test("returns null for a valid identity that is not present", () => {
    const { cwd } = createFixture();

    expect(findSessionFile(cwd, "7159482b-4550-451c-859e-350f717dbab8")).toBeNull();
  });

  test("rejects a filename whose session header declares a different identity", () => {
    const { cwd, sessionDir } = createFixture();
    const requestedId = "019ee398-14e2-7ad1-af6c-f79b45dabacd";
    writeSession(
      sessionDir,
      "2026-07-20T12-00-00-000Z",
      requestedId,
      "7159482b-4550-451c-859e-350f717dbab8",
    );

    expect(findSessionFile(cwd, requestedId)).toBeNull();
  });
});
