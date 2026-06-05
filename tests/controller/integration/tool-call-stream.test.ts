import { describe, expect, test } from "bun:test";

import { createToolCallStream } from "../../../controller/src/modules/proxy/tool-call-stream";
import {
  createThinkRewriter,
  thinkingTagPrefixIsPartial,
} from "../../../controller/src/modules/proxy/think-rewriter";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Run a synthetic upstream SSE payload through the controller's rewriter. */
async function runStream(upstream: string): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(upstream));
      controller.close();
    },
  });
  const out = createToolCallStream(source.getReader());
  const reader = out.getReader();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  return raw;
}

/**
 * Parse a raw SSE byte stream the way a spec-compliant client (the OpenAI SDK
 * inside pi) does: events are separated by a blank line, and consecutive
 * `data:` lines within one event are concatenated with `\n`.
 */
function parseSseEvents(raw: string): string[] {
  return raw
    .split(/\n\n+/)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n"),
    )
    .filter((value) => value.length > 0);
}

describe("createToolCallStream SSE framing", () => {
  // Regression: an injected `data: {...}` chunk (tool-call injection, think
  // carry, content flush) MUST be terminated by a blank line. Without it, the
  // chunk concatenates with the following `data: [DONE]` into a single event
  // whose value is `{...}\n[DONE]`, which fails JSON.parse with "Unexpected
  // non-whitespace character after JSON ... line 2 column 1" and aborts the
  // turn (stopReason: "error"). See controller/.../proxy/tool-call-stream.ts.
  test("injected tool-call chunk and [DONE] are separate, parseable events", async () => {
    const xml =
      '<tool_call><function=get_weather><arguments>{\\"city\\": \\"Paris\\"}</arguments></function></tool_call>';
    const upstream = [
      `data: {"choices":[{"index":0,"delta":{"content":"${xml}"},"finish_reason":null}]}`,
      "",
      `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const raw = await runStream(upstream);
    const events = parseSseEvents(raw);

    // Every non-[DONE] event must independently JSON.parse — this is exactly
    // what pi does and what regressed before the blank-line terminator.
    let toolCallSeen = false;
    let doneStandalone = false;
    for (const value of events) {
      if (value === "[DONE]") {
        doneStandalone = true;
        continue;
      }
      // Must NOT be a merged event (would contain an embedded newline).
      expect(value).not.toContain("\n");
      const parsed = JSON.parse(value) as {
        choices?: Array<{
          delta?: { tool_calls?: Array<{ function?: { name?: string } }> };
        }>;
      };
      const toolCalls = parsed.choices?.[0]?.delta?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        toolCallSeen = true;
        expect(toolCalls[0]?.function?.name).toBe("get_weather");
      }
    }

    expect(toolCallSeen).toBe(true);
    expect(doneStandalone).toBe(true);
  });

  test("plain content stream stays parseable and terminates with standalone [DONE]", async () => {
    const upstream = [
      `data: {"choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}`,
      "",
      `data: {"choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const events = parseSseEvents(await runStream(upstream));
    expect(events.length).toBeGreaterThan(0);
    for (const value of events) {
      if (value === "[DONE]") continue;
      expect(value).not.toContain("\n");
      expect(() => JSON.parse(value)).not.toThrow();
    }
    expect(events).toContain("[DONE]");
  });
});

describe("think rewriter", () => {
  test("carries partial analysis tags across chunk boundaries", () => {
    const rewriter = createThinkRewriter();

    expect(thinkingTagPrefixIsPartial("<anal")).toBe(true);
    expect(rewriter.rewrite("<anal")).toEqual({
      content: "",
      reasoningAppend: "",
    });
    expect(rewriter.rewrite("ysis>plan</analysis>answer")).toEqual({
      content: "answer",
      reasoningAppend: "plan",
    });
    expect(rewriter.drainCarry()).toBe("");
  });

  test("recognizes thinking aliases with attributes", () => {
    const rewriter = createThinkRewriter();

    expect(thinkingTagPrefixIsPartial("<thinking ")).toBe(true);
    expect(thinkingTagPrefixIsPartial("</thinking")).toBe(true);
    expect(
      rewriter.rewrite('<thinking mode="deep">reason</thinking>answer'),
    ).toEqual({
      content: "answer",
      reasoningAppend: "reason",
    });
  });
});
