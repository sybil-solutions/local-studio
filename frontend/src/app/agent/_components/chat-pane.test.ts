import { describe, expect, it } from "vitest";
import { isAgentEndEvent } from "@/lib/agent/pi-events";
import {
  drainQueueAfterAgentEnd,
  mergeCanonicalAndRuntimeEvents,
  parseAgentTurnSsePayload,
  reconcileQueueWithPiEvent,
  replaySessionEvents,
} from "./chat-pane";

describe("isAgentEndEvent", () => {
  it("does not treat per-tool turn_end as full agent completion", () => {
    expect(isAgentEndEvent({ type: "turn_end" })).toBe(false);
    expect(isAgentEndEvent({ type: "agent_end" })).toBe(true);
  });
});

describe("parseAgentTurnSsePayload", () => {
  it("ignores malformed SSE data instead of throwing", () => {
    expect(parseAgentTurnSsePayload("data: {not json")).toBeNull();
    expect(parseAgentTurnSsePayload(": keep-alive")).toBeNull();
  });

  it("accepts status, error, and Pi event payloads", () => {
    expect(parseAgentTurnSsePayload('data: {"type":"status","phase":"running"}')).toEqual({
      type: "status",
      phase: "running",
    });
    expect(parseAgentTurnSsePayload('data: {"type":"error","error":"boom"}')).toEqual({
      type: "error",
      error: "boom",
    });
    expect(
      parseAgentTurnSsePayload('data: {"type":"pi","seq":2,"event":{"type":"agent_end"}}'),
    ).toEqual({ type: "pi", seq: 2, event: { type: "agent_end" } });
  });
});

describe("drainQueueAfterAgentEnd", () => {
  it("drops transient steers and returns the next follow-up", () => {
    const result = drainQueueAfterAgentEnd([
      { id: "steer-1", mode: "steer", text: "adjust current run", sent: true },
      { id: "follow-1", mode: "follow_up", text: "next prompt" },
      { id: "follow-2", mode: "follow_up", text: "third prompt" },
    ]);

    expect(result.next).toEqual({ id: "follow-1", mode: "follow_up", text: "next prompt" });
    expect(result.remaining).toEqual([{ id: "follow-2", mode: "follow_up", text: "third prompt" }]);
  });

  it("does not resubmit follow-ups already queued inside Pi", () => {
    expect(
      drainQueueAfterAgentEnd([
        { id: "follow-1", mode: "follow_up", text: "already sent", sent: true },
        { id: "follow-2", mode: "follow_up", text: "local fallback" },
      ]),
    ).toEqual({
      next: { id: "follow-2", mode: "follow_up", text: "local fallback" },
      remaining: [],
    });
  });

  it("returns an empty drain result when no follow-ups are pending", () => {
    expect(
      drainQueueAfterAgentEnd([{ id: "steer-1", mode: "steer", text: "visible steer" }]),
    ).toEqual({
      next: null,
      remaining: [],
    });
  });
});

describe("reconcileQueueWithPiEvent", () => {
  it("mirrors Pi queue updates without dropping local unsent follow-ups", () => {
    const result = reconcileQueueWithPiEvent(
      [
        { id: "local", mode: "follow_up", text: "local only" },
        { id: "sent-follow", mode: "follow_up", text: "kept", sent: true },
        { id: "sent-steer", mode: "steer", text: "delivered", sent: true },
      ],
      { type: "queue_update", steering: ["new steer"], followUp: ["kept"] },
    );

    expect(result).toEqual([
      { id: "local", mode: "follow_up", text: "local only" },
      { id: "sent-follow", mode: "follow_up", text: "kept", sent: true },
      { id: expect.any(String), mode: "steer", text: "new steer", sent: true },
    ]);
  });
});

describe("mergeCanonicalAndRuntimeEvents", () => {
  it("dedupes stored events and appends live runtime events in seq order", () => {
    const stored = [
      { type: "session", id: "s1" },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel" } },
    ];

    expect(
      mergeCanonicalAndRuntimeEvents(stored, [
        {
          seq: 3,
          event: {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Hello" },
          },
        },
        { seq: 2, event: stored[1] },
      ]),
    ).toEqual([
      { type: "session", id: "s1" },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } },
    ]);
  });
});

describe("replaySessionEvents", () => {
  it("hydrates current Pi message events from stored sessions", () => {
    const result = replaySessionEvents([
      {
        type: "session",
        id: "session-1",
        cwd: "/tmp/project",
      },
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Build the landing page" }],
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I need to inspect the app." },
            {
              type: "toolCall",
              id: "call-1",
              name: "read",
              arguments: { path: "package.json" },
            },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: '{"scripts":{"dev":"next dev"}}' }],
          isError: false,
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done. I found the Next dev script." }],
        },
      },
    ]);

    expect(result.title).toBe("Build the landing page");
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toMatchObject({
      role: "user",
      text: "Build the landing page",
    });
    expect(result.messages[1].blocks).toEqual([
      { kind: "thinking", id: expect.any(String), text: "I need to inspect the app." },
      {
        kind: "tool",
        id: "call-1",
        name: "read",
        status: "done",
        args: { path: "package.json" },
        argsText: '{\n  "path": "package.json"\n}',
        text: '{"scripts":{"dev":"next dev"}}',
      },
    ]);
    expect(result.messages[2]).toMatchObject({
      role: "assistant",
      text: "Done. I found the Next dev script.",
    });
  });

  it("replays streamed tool-call argument deltas from Pi", () => {
    const result = replaySessionEvents([
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial: {
            content: [{ type: "toolCall", id: "call-write", name: "write", arguments: {} }],
          },
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: '{"path":"demo.txt","content":"hel',
          partial: {
            content: [
              {
                type: "toolCall",
                id: "call-write",
                name: "write",
                arguments: { path: "demo.txt", content: "hel" },
              },
            ],
          },
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 0,
          delta: 'lo"}',
          partial: {
            content: [
              {
                type: "toolCall",
                id: "call-write",
                name: "write",
                arguments: { path: "demo.txt", content: "hello" },
              },
            ],
          },
        },
      },
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toEqual([
      {
        kind: "tool",
        id: "call-write",
        name: "write",
        status: "running",
        args: { path: "demo.txt", content: "hello" },
        argsText: '{"path":"demo.txt","content":"hello"}',
        text: "",
      },
    ]);
  });

  it("deduplicates cumulative Pi text snapshots during replay", () => {
    const result = replaySessionEvents([
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "H" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "He" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } },
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "I" },
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "I know" },
      },
    ]);

    expect(result.messages[0].blocks).toMatchObject([
      { kind: "text", text: "Hello" },
      { kind: "thinking", text: "I know" },
    ]);
  });

  it("does not duplicate replayed prefix deltas over a hydrated assistant message", () => {
    const result = replaySessionEvents([
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
      },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "H" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello world!" },
      },
    ]);

    expect(result.messages[0].blocks).toMatchObject([{ kind: "text", text: "Hello world!" }]);
  });

  it("merges final assistant message snapshots into streamed text during replay", () => {
    const result = replaySessionEvents([
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Say done" }],
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "DO" },
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "DONE" },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "DONE" }],
        },
      },
    ]);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      text: "DONE",
    });
  });

  it("merges final assistant message_end into the streamed assistant during replay", () => {
    const result = replaySessionEvents([
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Say done" }],
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "DONE" },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "DONE" }],
        },
      },
    ]);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      text: "DONE",
    });
  });

  it("keeps failed tool calls as failed blocks instead of dropping the session", () => {
    const result = replaySessionEvents([
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Run the flaky tool" }],
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          partial: {
            content: [{ type: "toolCall", id: "call-flaky", name: "flaky", arguments: {} }],
          },
        },
      },
      {
        type: "tool_execution_end",
        toolCallId: "call-flaky",
        toolName: "flaky",
        isError: true,
        result: { content: [{ type: "text", text: "boom" }] },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "I can continue after that failed tool.",
        },
      },
    ]);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].blocks?.[0]).toMatchObject({
      kind: "tool",
      id: "call-flaky",
      name: "flaky",
      status: "error",
      resultText: "boom",
    });
    expect(result.messages[1].blocks?.[1]).toMatchObject({
      kind: "text",
      text: "I can continue after that failed tool.",
    });
  });

  it("renders compaction events as timeline event blocks during replay", () => {
    const result = replaySessionEvents([
      {
        type: "context_compacted",
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Continuing after compaction.",
        },
      },
    ]);

    expect(result.messages[0].blocks).toMatchObject([
      { kind: "event", text: "Context automatically compacted" },
      { kind: "text", text: "Continuing after compaction." },
    ]);
  });

  it("preserves multiple successful and failed tool calls in one assistant turn", () => {
    const result = replaySessionEvents([
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Run a mixed tool batch" }],
        },
      },
      { type: "tool_execution_start", toolCallId: "call-read", toolName: "read" },
      {
        type: "tool_execution_end",
        toolCallId: "call-read",
        toolName: "read",
        isError: false,
        result: { content: [{ type: "text", text: "read ok" }] },
      },
      { type: "tool_execution_start", toolCallId: "call-write", toolName: "write" },
      {
        type: "tool_execution_end",
        toolCallId: "call-write",
        toolName: "write",
        isError: false,
        result: { content: [{ type: "text", text: "write ok" }] },
      },
      { type: "tool_execution_start", toolCallId: "call-shell", toolName: "shell" },
      {
        type: "tool_execution_end",
        toolCallId: "call-shell",
        toolName: "shell",
        isError: true,
        result: { content: [{ type: "text", text: "shell failed" }] },
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "I handled the failed shell tool and continued.",
        },
      },
    ]);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].blocks).toMatchObject([
      { kind: "tool", id: "call-read", name: "read", status: "done", resultText: "read ok" },
      { kind: "tool", id: "call-write", name: "write", status: "done", resultText: "write ok" },
      {
        kind: "tool",
        id: "call-shell",
        name: "shell",
        status: "error",
        resultText: "shell failed",
      },
      { kind: "text", text: "I handled the failed shell tool and continued." },
    ]);
  });
});
