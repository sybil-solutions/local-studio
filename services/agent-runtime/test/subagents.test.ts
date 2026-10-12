import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeCwdForPi } from "../src/sessions-store";
import { subagentReport, type SubagentRun } from "../src/subagents";

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

/** A child transcript whose last assistant entry is the abort marker pi
 *  writes when a run is stopped mid-flight. */
function writeAbortedTranscript(piSessionId: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "subagents-"));
  temporaryRoots.push(root);
  const agentDir = path.join(root, "pi-agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = path.join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const sessionDir = path.join(agentDir, "sessions", encodeCwdForPi(cwd));
  mkdirSync(sessionDir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "session", id: piSessionId, cwd }),
    JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "partial work" }] },
    }),
    JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [], errorMessage: "Request was aborted" },
    }),
  ];
  writeFileSync(path.join(sessionDir, `rollout_${piSessionId}.jsonl`), `${lines.join("\n")}\n`);
  return cwd;
}

function runWith(status: SubagentRun["status"], piSessionId: string, cwd: string): SubagentRun {
  return {
    id: "run-1",
    parentPiSessionId: "parent-1",
    name: "smoke",
    task: "test task",
    piSessionId,
    runtimeSessionId: "subagent:parent-1:run-1",
    cwd,
    status,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

describe("subagentReport", () => {
  test("a cancelled run does not adopt the transcript's abort marker as an error", () => {
    const piSessionId = "01a02222-0000-7000-8000-000000000001";
    const cwd = writeAbortedTranscript(piSessionId);
    const report = subagentReport(runWith("cancelled", piSessionId, cwd));
    expect(report.error).toBeNull();
    expect(report.text).toBe("partial work");
  });

  test("a failed run still surfaces the transcript error", () => {
    const piSessionId = "01a02222-0000-7000-8000-000000000002";
    const cwd = writeAbortedTranscript(piSessionId);
    const report = subagentReport(runWith("error", piSessionId, cwd));
    expect(report.error).toBe("Request was aborted");
    expect(report.text).toBe("partial work");
  });
});
