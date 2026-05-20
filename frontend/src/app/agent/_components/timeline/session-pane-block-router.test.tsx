import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantBlock, ChatMessage } from "@/lib/agent/session";
import { groupAssistantBlocks, SessionPaneBlockRouter } from "./session-pane-block-router";

describe("groupAssistantBlocks", () => {
  it("starts a new activity group after assistant content", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think", text: "plan" },
      { kind: "thinking", id: "think-2", text: "more plan" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "" },
      { kind: "tool", id: "tool-2", name: "write_file", status: "done", text: "" },
      { kind: "text", id: "text", text: "done" },
      { kind: "tool", id: "tool-3", name: "bash", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      {
        kind: "activity-group",
        id: "activity-reasoning-think",
        segments: [
          { kind: "reasoning", id: "reasoning-think", blocks: [blocks[0], blocks[1]] },
          { kind: "tools", id: "tools-tool-1", blocks: [blocks[2], blocks[3]] },
        ],
      },
      { kind: "content", block: blocks[4] },
      {
        kind: "activity-group",
        id: "activity-tools-tool-3",
        segments: [{ kind: "tools", id: "tools-tool-3", blocks: [blocks[5]] }],
      },
    ]);
  });

  it("ignores empty text blocks so they don't split a single activity group", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think-1", text: "plan" },
      { kind: "tool", id: "tool-1", name: "ls", status: "done", text: "" },
      { kind: "text", id: "empty", text: "" },
      { kind: "thinking", id: "think-2", text: "more" },
      { kind: "tool", id: "tool-2", name: "bash", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      {
        kind: "activity-group",
        id: "activity-reasoning-think-1",
        segments: [
          { kind: "reasoning", id: "reasoning-think-1", blocks: [blocks[0]] },
          { kind: "tools", id: "tools-tool-1", blocks: [blocks[1]] },
          { kind: "reasoning", id: "reasoning-think-2", blocks: [blocks[3]] },
          { kind: "tools", id: "tools-tool-2", blocks: [blocks[4]] },
        ],
      },
    ]);
  });

  it("keeps interleaved reasoning and tools in one ordered activity group", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", id: "think-1", text: "inspect" },
      { kind: "tool", id: "tool-1", name: "read_file", status: "done", text: "" },
      { kind: "thinking", id: "think-2", text: "adjust" },
      { kind: "tool", id: "tool-2", name: "apply_patch", status: "done", text: "" },
    ];

    expect(groupAssistantBlocks(blocks)).toEqual([
      {
        kind: "activity-group",
        id: "activity-reasoning-think-1",
        segments: [
          { kind: "reasoning", id: "reasoning-think-1", blocks: [blocks[0]] },
          { kind: "tools", id: "tools-tool-1", blocks: [blocks[1]] },
          { kind: "reasoning", id: "reasoning-think-2", blocks: [blocks[2]] },
          { kind: "tools", id: "tools-tool-2", blocks: [blocks[3]] },
        ],
      },
    ]);
  });
});

describe("SessionPaneBlockRouter", () => {
  it("renders collapsed tool group previews without mounting completed tool details", () => {
    const message: ChatMessage = {
      id: "assistant",
      role: "assistant",
      text: "",
      blocks: [
        {
          kind: "tool",
          id: "tool-1",
          name: "write_file",
          status: "done",
          text: "",
          args: { path: "src/example.ts", content: "const value = 1;" },
        },
        {
          kind: "tool",
          id: "tool-2",
          name: "bash",
          status: "done",
          text: "",
          args: { cmd: "npm test -- tool-block-view.test.tsx" },
        },
      ],
    };

    const html = renderToStaticMarkup(<SessionPaneBlockRouter message={message} />);

    expect(html).toContain("2 tools");
    expect(html).toContain("npm test");
    expect(html).not.toContain("edit example.ts");
    expect(html).not.toContain("border border-(--border)/70");
    expect(html).not.toContain("language-ts");
  });
});
