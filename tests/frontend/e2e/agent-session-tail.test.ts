import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function encodeCwdForPi(cwd: string): string {
  return `--${path.resolve(cwd).slice(1).replaceAll("/", "-")}--`;
}

function messageEvent(role: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  };
}

function messageTexts(events: Record<string, unknown>[]): string[] {
  return events.flatMap((event) => {
    const message = event.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  });
}

test("tail hydration pages complete turns without dropping or duplicating messages", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-session-tail-"));
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "pi-agent");
  const sessionDir = path.join(agentDir, "sessions", encodeCwdForPi(cwd));
  const sessionId = "tail-regression-session";
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    mkdirSync(sessionDir, { recursive: true });
    const events = [
      {
        type: "session",
        id: sessionId,
        cwd,
        timestamp: "2026-07-11T12:00:00.000Z",
        modelId: "fixture-model",
      },
      messageEvent("user", "first prompt"),
      messageEvent("assistant", "first answer"),
      messageEvent("user", "second prompt"),
      messageEvent("assistant", "second tool call"),
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call-2",
          content: [{ type: "text", text: "second tool result" }],
          isError: false,
        },
      },
      messageEvent("assistant", "second summary"),
      messageEvent("user", "third prompt"),
      messageEvent("assistant", "third answer"),
    ];
    writeFileSync(
      path.join(sessionDir, `${sessionId}.jsonl`),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const { loadSession } = await import("@local-studio/agent-runtime/sessions-store");

    const latest = await loadSession(cwd, sessionId, { tail: 2 });
    assert.notEqual(latest.cursor, null);
    assert.deepEqual(messageTexts(latest.events), ["third prompt", "third answer"]);
    assert.equal(latest.meta?.title, "first prompt");
    assert.equal(latest.meta?.modelId, "fixture-model");

    const earlier = await loadSession(cwd, sessionId, { before: latest.cursor ?? 0 });
    assert.equal(earlier.cursor, null);
    assert.deepEqual(messageTexts(earlier.events), [
      "first prompt",
      "first answer",
      "second prompt",
      "second tool call",
      "second tool result",
      "second summary",
    ]);
  } finally {
    if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
});
