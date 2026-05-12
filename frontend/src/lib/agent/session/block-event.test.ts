import { describe, expect, it } from "vitest";
import type { AssistantBlock } from "./types";
import { applyAssistantPiEventToBlocks } from "./block-event";

const makeId = (prefix: string) => `${prefix}-id`;

describe("applyAssistantPiEventToBlocks", () => {
  it("accumulates text and thinking deltas behind one assistant block seam", () => {
    const textBlocks = applyAssistantPiEventToBlocks(
      [],
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hel" } },
      makeId,
    );
    expect(textBlocks).toEqual([{ kind: "text", id: "text-id", text: "hel" }]);

    const completedText = applyAssistantPiEventToBlocks(
      textBlocks ?? [],
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } },
      makeId,
    );
    expect(completedText).toEqual([{ kind: "text", id: "text-id", text: "hello" }]);

    const thinking = applyAssistantPiEventToBlocks(
      completedText ?? [],
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "plan" },
      },
      makeId,
    );
    expect(thinking?.at(-1)).toEqual({ kind: "thinking", id: "thinking-id", text: "plan" });
  });

  it("accumulates streaming tool-call arguments", () => {
    const started = applyAssistantPiEventToBlocks(
      [],
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { id: "call-1", name: "write_file", arguments: { path: "a.ts" } },
        },
      },
      makeId,
    );
    const updated = applyAssistantPiEventToBlocks(
      started ?? [],
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          toolCall: { id: "call-1", name: "write_file" },
          argumentsDelta: '{"content":"x"}',
        },
      },
      makeId,
    );

    expect(updated).toMatchObject([
      {
        kind: "tool",
        id: "call-1",
        name: "write_file",
        status: "running",
        argsText: '{\n  "path": "a.ts"\n}{"content":"x"}',
        args: { path: "a.ts" },
      },
    ]);
  });

  it("canonicalizes tool-call args on end while preserving rendered args text", () => {
    const existing: AssistantBlock[] = [
      {
        kind: "tool",
        id: "call-1",
        name: "write_file",
        status: "running",
        argsText: "{partial",
        text: "{partial",
      },
    ];

    const blocks = applyAssistantPiEventToBlocks(
      existing,
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_end",
          toolCall: { id: "call-1", name: "write_file", arguments: { path: "a.ts" } },
        },
      },
      makeId,
    );

    expect(blocks).toMatchObject([
      {
        id: "call-1",
        name: "write_file",
        argsText: '{\n  "path": "a.ts"\n}',
        args: { path: "a.ts" },
        text: "{partial",
      },
    ]);
  });

  it("marks tool execution done without losing argument display text", () => {
    const existing: AssistantBlock[] = [
      {
        kind: "tool",
        id: "call-1",
        name: "read_file",
        status: "running",
        argsText: '{"path":"a.ts"}',
        text: "",
      },
    ];

    const blocks = applyAssistantPiEventToBlocks(existing, {
      type: "tool_execution_end",
      toolCallId: "call-1",
      result: { content: [{ type: "text", text: "file body" }] },
    });

    expect(blocks).toMatchObject([
      {
        id: "call-1",
        status: "done",
        resultText: "file body",
        text: '{"path":"a.ts"}',
      },
    ]);
  });

  it("renders compaction events as idempotent event blocks", () => {
    const compacted = applyAssistantPiEventToBlocks(
      [],
      { type: "context_compaction", summary: "Compacted old context" },
      makeId,
    );
    expect(compacted).toEqual([{ kind: "event", id: "event-id", text: "Compacted old context" }]);

    expect(
      applyAssistantPiEventToBlocks(
        compacted ?? [],
        { type: "context_compaction", summary: "Compacted old context" },
        makeId,
      ),
    ).toBe(compacted);
  });
});
