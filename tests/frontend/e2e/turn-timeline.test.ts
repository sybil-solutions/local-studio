import assert from "node:assert/strict";
import test from "node:test";

import { deriveTurnTimeline, type TurnRecord } from "@/features/agent/turn-timeline-model";
import type { ChatMessage } from "@/features/agent/messages/types";
import type { Session } from "@/features/agent/runtime/types";
import type { RuntimeContextUsage } from "@/features/agent/runtime/api";

function makeSession(patch: Partial<Session> = {}): Session {
  return {
    id: "s1",
    runtimeSessionId: "rt-s1",
    piSessionId: null,
    title: "Test session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

function userMessage(text: string, patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `u-${text}`,
    role: "user",
    text,
    ...patch,
  };
}

function assistantMessage(
  id: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    text: "",
    ...patch,
  };
}

test("empty session produces an empty timeline", () => {
  const session = makeSession();
  assert.deepEqual(deriveTurnTimeline(session), []);
});

test("single assistant turn derives model, timing, tokens, and context usage", () => {
  const session = makeSession({
    modelId: "qwen-27b",
    tokenStats: { read: 100, write: 50, current: 150 },
    contextUsage: {
      tokens: 150,
      contextWindow: 32768,
      percent: 0.46,
      shouldCompact: false,
    } satisfies RuntimeContextUsage,
    usedSkills: [{ id: "skill-1", name: "browser" }],
    messages: [
      userMessage("Hello", { timestamp: "2026-06-22T10:00:00.000Z" }),
      assistantMessage("a-1", {
        timestamp: "2026-06-22T10:00:01.000Z",
        text: "Hi there",
      }),
    ],
  });

  const timeline = deriveTurnTimeline(session);
  assert.equal(timeline.length, 1);
  const turn = timeline[0];

  assert.equal(turn.turnIndex, 0);
  assert.equal(turn.assistantMessageId, "a-1");
  assert.equal(turn.modelId, "qwen-27b");
  assert.equal(turn.startedAt, "2026-06-22T10:00:01.000Z");
  assert.equal(turn.endedAt, undefined);
  assert.equal(turn.durationMs, undefined);
  assert.equal(turn.tokenTotal, 150);
  assert.equal(turn.tokenDelta, 150);
  assert.equal(turn.contextPercentAfter, 0.46);
  assert.deepEqual(turn.activeSkills, [{ id: "skill-1", name: "browser" }]);
  assert.deepEqual(turn.toolCalls, []);
  assert.deepEqual(turn.filesTouched, []);
});

test("turn grouping is one record per assistant message", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", { text: "a1" }),
      userMessage("q2"),
      assistantMessage("a-2", { text: "a2" }),
      userMessage("q3"),
    ],
  });

  const timeline = deriveTurnTimeline(session);
  assert.equal(timeline.length, 2);
  assert.deepEqual(
    timeline.map((t) => ({ index: t.turnIndex, id: t.assistantMessageId })),
    [
      { index: 0, id: "a-1" },
      { index: 1, id: "a-2" },
    ],
  );
});

test("tool calls and files touched are scoped to each turn", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", {
        blocks: [
          {
            kind: "tool",
            id: "t1",
            name: "read_file",
            status: "done",
            args: { path: "src/auth.ts" },
            text: "",
          },
          {
            kind: "tool",
            id: "t2",
            name: "edit_file",
            status: "done",
            args: { file_path: "src/auth.ts" },
            text: "",
          },
        ],
      }),
      userMessage("q2"),
      assistantMessage("a-2", {
        blocks: [
          {
            kind: "tool",
            id: "t3",
            name: "grep",
            status: "done",
            args: { pattern: "middleware" },
            text: "",
          },
        ],
      }),
    ],
  });

  const [turn1, turn2] = deriveTurnTimeline(session);

  assert.equal(turn1.toolCalls.length, 2);
  assert.equal(turn1.toolCalls[0].name, "read_file");
  assert.equal(turn1.toolCalls[0].kind, "read");
  assert.equal(turn1.toolCalls[1].name, "edit_file");
  assert.equal(turn1.toolCalls[1].kind, "edit");

  assert.deepEqual(turn1.filesTouched, [
    { path: "src/auth.ts", mode: "both" },
  ]);

  assert.equal(turn2.toolCalls.length, 1);
  assert.equal(turn2.toolCalls[0].name, "grep");
  assert.equal(turn2.toolCalls[0].kind, "search");
  assert.deepEqual(turn2.filesTouched, []);
});

test("turn duration is derived from the next message timestamp", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", {
        timestamp: "2026-06-22T10:00:00.000Z",
      }),
      userMessage("q2", {
        timestamp: "2026-06-22T10:00:05.500Z",
      }),
    ],
  });

  const [turn] = deriveTurnTimeline(session);
  assert.equal(turn.durationMs, 5500);
  assert.equal(turn.endedAt, "2026-06-22T10:00:05.500Z");
});

test("token and context fields are attached only to the latest turn", () => {
  const session = makeSession({
    tokenStats: { read: 200, write: 100, current: 300 },
    contextUsage: {
      tokens: 300,
      contextWindow: 32768,
      percent: 0.92,
      shouldCompact: true,
    } satisfies RuntimeContextUsage,
    messages: [
      userMessage("q1"),
      assistantMessage("a-1"),
      userMessage("q2"),
      assistantMessage("a-2"),
    ],
  });

  const [turn1, turn2] = deriveTurnTimeline(session);
  assert.equal(turn1.tokenTotal, undefined);
  assert.equal(turn1.tokenDelta, undefined);
  assert.equal(turn1.contextPercentAfter, undefined);

  assert.equal(turn2.tokenTotal, 300);
  assert.equal(turn2.tokenDelta, undefined);
  assert.equal(turn2.contextPercentAfter, 0.92);
});

test("error tool status is preserved in the turn record", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", {
        blocks: [
          {
            kind: "tool",
            id: "t1",
            name: "read_file",
            status: "error",
            args: { path: "missing.ts" },
            text: "",
          },
        ],
      }),
    ],
  });

  const [turn] = deriveTurnTimeline(session);
  assert.equal(turn.toolCalls[0].status, "error");
  assert.deepEqual(turn.filesTouched, [{ path: "missing.ts", mode: "read" }]);
});

test("non-tool blocks are ignored", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", {
        blocks: [
          { kind: "text", id: "b1", text: "Hello" },
          { kind: "thinking", id: "b2", text: "..." },
        ],
      }),
    ],
  });

  const [turn] = deriveTurnTimeline(session);
  assert.deepEqual(turn.toolCalls, []);
  assert.deepEqual(turn.filesTouched, []);
});

test("attachments are derived from assistant message", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", {
        attachments: [
          {
            id: "att-1",
            name: "screenshot.png",
            type: "image/png",
            size: 2048,
            mode: "data-url",
            content: "data:image/png;base64,abc",
            previewKind: "image",
          },
          {
            id: "att-2",
            name: "notes.txt",
            type: "text/plain",
            size: 512,
            mode: "text",
            content: "hello",
            path: "/tmp/notes.txt",
          },
        ],
      }),
    ],
  });

  const [turn] = deriveTurnTimeline(session);
  assert.equal(turn.attachments.length, 2);
  assert.equal(turn.attachments[0].id, "att-1");
  assert.equal(turn.attachments[0].name, "screenshot.png");
  assert.equal(turn.attachments[0].type, "image/png");
  assert.equal(turn.attachments[0].size, 2048);
  assert.equal(turn.attachments[0].previewKind, "image");
  assert.equal(turn.attachments[1].id, "att-2");
  assert.equal(turn.attachments[1].name, "notes.txt");
  assert.equal(turn.attachments[1].path, "/tmp/notes.txt");
});

test("turns without attachments have empty attachments array", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", { text: "no attachments" }),
    ],
  });

  const [turn] = deriveTurnTimeline(session);
  assert.deepEqual(turn.attachments, []);
});

test("attachments are scoped per turn", () => {
  const session = makeSession({
    messages: [
      userMessage("q1"),
      assistantMessage("a-1", {
        attachments: [
          {
            id: "att-1",
            name: "file1.ts",
            type: "text/typescript",
            size: 100,
            mode: "text",
            content: "const a = 1;",
          },
        ],
      }),
      userMessage("q2"),
      assistantMessage("a-2", { text: "no atts" }),
    ],
  });

  const [turn1, turn2] = deriveTurnTimeline(session);
  assert.equal(turn1.attachments.length, 1);
  assert.equal(turn1.attachments[0].name, "file1.ts");
  assert.deepEqual(turn2.attachments, []);
});
