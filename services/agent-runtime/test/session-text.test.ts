import { describe, expect, it } from "vitest";
import { lastAssistantResultFromJsonl } from "../src/session-text";

describe("lastAssistantResultFromJsonl", () => {
  it("returns the latest assistant text", () => {
    const result = lastAssistantResultFromJsonl(
      [
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "first" }] },
        }),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "latest" }] },
        }),
      ].join("\n"),
    );

    expect(result).toEqual({ text: "latest", error: null });
  });

  it("returns the concrete assistant error when no text is produced", () => {
    const result = lastAssistantResultFromJsonl(
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "Upstream connection failed",
        },
      }),
    );

    expect(result).toEqual({ text: "", error: "Upstream connection failed" });
  });
});
