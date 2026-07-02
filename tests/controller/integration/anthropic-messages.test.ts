import { describe, expect, it } from "bun:test";

import {
  anthropicPromptText,
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
} from "../../../controller/src/modules/proxy/anthropic-messages";
import {
  createAnthropicStreamTranslator,
  parseSseLine,
} from "../../../controller/src/modules/proxy/anthropic-messages-stream";

describe("anthropicRequestToOpenAI", () => {
  it("converts system, messages, and sampling params", () => {
    const openai = anthropicRequestToOpenAI({
      model: "local-model",
      max_tokens: 128,
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ["END"],
      system: "You are terse.",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(openai["model"]).toBe("local-model");
    expect(openai["max_tokens"]).toBe(128);
    expect(openai["temperature"]).toBe(0.5);
    expect(openai["stop"]).toEqual(["END"]);
    expect(openai["messages"]).toEqual([
      { role: "system", content: "You are terse." },
      { role: "user", content: "Hello" },
    ]);
  });

  it("converts system content blocks and multi-block user text", () => {
    const openai = anthropicRequestToOpenAI({
      model: "m",
      system: [{ type: "text", text: "sys" }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      ],
    });
    expect(openai["messages"]).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "a\nb" },
    ]);
  });

  it("converts tools, tool_choice, tool_use, and tool_result blocks", () => {
    const openai = anthropicRequestToOpenAI({
      model: "m",
      tools: [{ name: "get_weather", description: "d", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "checking" },
            { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "sf" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "sunny" },
            { type: "text", text: "and tomorrow?" },
          ],
        },
      ],
    });
    const messages = openai["messages"] as Record<string, unknown>[];
    expect(openai["tool_choice"]).toBe("required");
    expect((openai["tools"] as unknown[]).length).toBe(1);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "checking",
      tool_calls: [
        {
          id: "toolu_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"sf"}' },
        },
      ],
    });
    expect(messages[2]).toEqual({ role: "tool", tool_call_id: "toolu_1", content: "sunny" });
    expect(messages[3]).toEqual({ role: "user", content: "and tomorrow?" });
  });

  it("converts base64 images into data-uri image_url parts", () => {
    const openai = anthropicRequestToOpenAI({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "abc" } },
          ],
        },
      ],
    });
    const messages = openai["messages"] as Record<string, unknown>[];
    const parts = messages[0]?.["content"] as Record<string, unknown>[];
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,abc" },
    });
  });
});

describe("openAIResponseToAnthropic", () => {
  it("converts text responses with usage and stop reason", () => {
    const anthropic = openAIResponseToAnthropic({
      id: "chatcmpl-1",
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });
    expect(anthropic["type"]).toBe("message");
    expect(anthropic["content"]).toEqual([{ type: "text", text: "hi" }]);
    expect(anthropic["stop_reason"]).toBe("end_turn");
    expect(anthropic["usage"]).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  it("converts tool calls into tool_use blocks with parsed input", () => {
    const anthropic = openAIResponseToAnthropic({
      id: "chatcmpl-2",
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"sf"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(anthropic["stop_reason"]).toBe("tool_use");
    expect(anthropic["content"]).toEqual([
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "sf" } },
    ]);
  });
});

describe("createAnthropicStreamTranslator", () => {
  const events = (frames: string[]): string[] =>
    frames.map((frame) => frame.split("\n")[0]?.replace("event: ", "") ?? "");

  it("emits the anthropic event sequence for a text stream", () => {
    const translator = createAnthropicStreamTranslator("m");
    const first = translator.translateChunk({
      id: "c1",
      model: "m",
      choices: [{ index: 0, delta: { role: "assistant", content: "he" } }],
    });
    const second = translator.translateChunk({
      choices: [{ index: 0, delta: { content: "llo" } }],
    });
    const third = translator.translateChunk({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const tail = translator.finish();
    expect(events(first)).toEqual(["message_start", "content_block_start", "content_block_delta"]);
    expect(events(second)).toEqual(["content_block_delta"]);
    expect(events(third)).toEqual([]);
    expect(events(tail)).toEqual(["content_block_stop", "message_delta", "message_stop"]);
    const messageDelta = JSON.parse(tail[1]?.split("data: ")[1] ?? "{}") as Record<string, unknown>;
    expect(messageDelta["usage"]).toEqual({ input_tokens: 5, output_tokens: 2 });
    expect((messageDelta["delta"] as Record<string, unknown>)["stop_reason"]).toBe("end_turn");
  });

  it("switches from text to tool_use blocks with input_json deltas", () => {
    const translator = createAnthropicStreamTranslator("m");
    translator.translateChunk({
      id: "c1",
      choices: [{ index: 0, delta: { content: "let me check" } }],
    });
    const toolFrames = translator.translateChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"ci' } },
            ],
          },
        },
      ],
    });
    const moreArgs = translator.translateChunk({
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"sf"}' } }] } },
      ],
    });
    translator.translateChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    const tail = translator.finish();
    expect(events(toolFrames)).toEqual([
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
    ]);
    expect(events(moreArgs)).toEqual(["content_block_delta"]);
    const finalDelta = JSON.parse(tail[1]?.split("data: ")[1] ?? "{}") as Record<string, unknown>;
    expect((finalDelta["delta"] as Record<string, unknown>)["stop_reason"]).toBe("tool_use");
  });
});

describe("parseSseLine", () => {
  it("parses data lines, done markers, and ignores noise", () => {
    expect(parseSseLine('data: {"a":1}')).toEqual({ a: 1 });
    expect(parseSseLine("data: [DONE]")).toBe("done");
    expect(parseSseLine(": keepalive")).toBeNull();
    expect(parseSseLine("data: not-json")).toBeNull();
  });
});

describe("anthropicPromptText", () => {
  it("flattens system, message blocks, and tools for token counting", () => {
    const text = anthropicPromptText({
      system: "sys",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "yo" }] },
      ],
      tools: [{ name: "t" }],
    });
    expect(text).toContain("sys");
    expect(text).toContain("hi");
    expect(text).toContain("yo");
    expect(text).toContain('"name":"t"');
  });
});
