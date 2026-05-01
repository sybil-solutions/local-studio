import { describe, expect, it } from "vitest";
import { replaySessionEvents } from "./chat-pane";

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
});
