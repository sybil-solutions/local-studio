import { describe, expect, test } from "bun:test";

import { createToolCallStream } from "../../src/modules/proxy/tool-call-stream";
import {
  createThinkRewriter,
  thinkingTagPrefixIsPartial,
} from "../../src/modules/proxy/reasoning";

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

/** Concatenate the `content` deltas the rewriter emits for incremental tokens. */
async function streamContent(tokens: string[]): Promise<string> {
  const lines: string[] = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] })}`,
    "",
  ];
  for (const content of tokens) {
    lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}`, "");
  }
  lines.push("data: [DONE]", "");
  const events = parseSseEvents(await runStream(lines.join("\n")));
  let content = "";
  for (const value of events) {
    if (value === "[DONE]") continue;
    const delta = (JSON.parse(value) as { choices?: Array<{ delta?: { content?: string } }> })
      .choices?.[0]?.delta?.content;
    if (typeof delta === "string") content += delta;
  }
  return content;
}

describe("createToolCallStream content fidelity", () => {
  // Regression: standalone newline ("\n" / "\n\n") deltas were misread as a
  // "replayed prefix" and dropped whenever the accumulated message started with
  // a newline — collapsing every blank line and list break in the rendered
  // answer (e.g. "it.\n\nI rewrote it as:\n- a\n- b" -> "it.I rewrote it as:- a- b").
  test("preserves standalone newline deltas when the message starts with a newline", async () => {
    const tokens = [
      "\n",
      "Fair — I overdesigned it.",
      "\n\n",
      "I rewrote it as:",
      "\n",
      "- a",
      "\n",
      "- b",
    ];
    expect(await streamContent(tokens)).toBe(tokens.join(""));
  });

  test("preserves newline deltas in a list when the message starts with text", async () => {
    const tokens = ["Items:", "\n", "- one", "\n", "- two", "\n", "- three"];
    expect(await streamContent(tokens)).toBe(tokens.join(""));
  });

  // Regression: two CONSECUTIVE identical newline deltas while the accumulated
  // text is itself just that newline. The cumulative check used `>=`, so the
  // second "\n" (equal length, startsWith) was misread as a cumulative snapshot,
  // sliced to "" AND flipped the stream into snapshot mode — collapsing the rest
  // of the answer (a list rendered all on one line). Common when a model opens
  // its reply with a blank line before a list.
  test("preserves a blank line + list when the message opens with two newlines", async () => {
    const tokens = ["\n", "\n", "- alpha", "\n", "- beta", "\n", "- gamma"];
    expect(await streamContent(tokens)).toBe(tokens.join(""));
  });

  test("repeated whitespace-only deltas are never dropped or sliced", async () => {
    expect(await streamContent([" ", " ", " ", "x"])).toBe("   x");
    expect(await streamContent(["\n", "\n", "\n", "x"])).toBe("\n\n\nx");
  });

  // A backend that restarts an incremental token stream from the top must still
  // be de-duplicated (replay begins with real content, never whitespace).
  test("deduplicates an incremental stream that restarts from the beginning", async () => {
    expect(await streamContent(["Hello", " world", "Hello", " world", "!"])).toBe("Hello world!");
  });

  // A cumulative-snapshot backend (each delta is the full content so far) is
  // sliced to the new suffix rather than duplicated.
  test("slices cumulative snapshot deltas instead of duplicating them", async () => {
    const got = await streamContent([
      "Hello",
      "Hello world",
      "Hello world\n\n- a",
      "Hello world\n\n- a\n- b",
    ]);
    expect(got).toBe("Hello world\n\n- a\n- b");
  });

  // Regression: a multibyte UTF-8 character split across the FINAL upstream byte
  // chunk boundary was dropped, because the streaming decoder's trailing bytes
  // were never flushed with a no-arg decode() when the stream ended.
  test("preserves a multibyte char split across the final chunk boundary", async () => {
    const payload =
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "café" } }] })}\n\n` +
      "data: [DONE]\n\n";
    const bytes = new TextEncoder().encode(payload);
    // Split the "é" (0xC3 0xA9): cut one byte before the very end of its first
    // occurrence so its two bytes land in different reader chunks.
    const splitAt = payload.indexOf("é") + 1;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
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
    const content = parseSseEvents(raw)
      .filter((value) => value !== "[DONE]")
      .map((value) => {
        const delta = (JSON.parse(value) as { choices?: Array<{ delta?: { content?: string } }> })
          .choices?.[0]?.delta?.content;
        return typeof delta === "string" ? delta : "";
      })
      .join("");
    expect(content).toBe("café");
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
    expect(rewriter.rewrite('<thinking mode="deep">reason</thinking>answer')).toEqual({
      content: "answer",
      reasoningAppend: "reason",
    });
  });
});
