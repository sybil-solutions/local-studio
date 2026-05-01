// CRITICAL
import { describe, expect, it } from "bun:test";
import { createToolCallStream } from "../modules/proxy/tool-call-stream";
import { parseToolCallsFromContent } from "../modules/proxy/tool-call-parser";

const collectStream = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    output += decoder.decode(result.value);
  }
  return output;
};

const parseSseDataLines = (output: string): Array<Record<string, unknown> | "[DONE]"> => {
  const events: Array<Record<string, unknown> | "[DONE]"> = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      events.push("[DONE]");
      continue;
    }
    events.push(JSON.parse(data) as Record<string, unknown>);
  }
  return events;
};

const collectDeltaText = (
  events: Array<Record<string, unknown> | "[DONE]">
): { content: string; reasoning: string } => {
  let content = "";
  let reasoning = "";
  for (const event of events) {
    if (event === "[DONE]") continue;
    const choices = event["choices"];
    if (!Array.isArray(choices)) continue;
    const choice = choices[0] as Record<string, unknown> | undefined;
    if (!choice) continue;
    const delta = (choice["delta"] ?? choice["message"]) as Record<string, unknown> | undefined;
    if (!delta) continue;
    const c = delta["content"];
    const r = delta["reasoning_content"];
    if (typeof c === "string") content += c;
    if (typeof r === "string") reasoning += r;
  }
  return { content, reasoning };
};

describe("tool-call-core", () => {
  it("parses tool calls from XML blocks", () => {
    const content = `<tool_call><function=weather><arguments>{"city":"Paris"}</arguments></tool_call>`;
    const calls = parseToolCallsFromContent(content);
    expect(calls.length).toBe(1);
    expect(calls[0]?.function.name).toBe("weather");
    expect(calls[0]?.function.arguments).toContain('"Paris"');
  });

  it("parses JSON fallback tool calls with nested braces in arguments", () => {
    const content = `{"name":"write_file","arguments":{"path":"app.ts","content":"const x = {a: {b: 1}}"}}`;
    const calls = parseToolCallsFromContent(content);
    expect(calls.length).toBe(1);
    expect(calls[0]?.function.name).toBe("write_file");
    expect(calls[0]?.function.arguments).toContain('"content":"const x = {a: {b: 1}}"');
  });

  it("ignores legacy MCP XML blocks", () => {
    const content = `<use_mcp_tool>
<server_name>exa</server_name>
<tool_name>search</tool_name>
<arguments>{"q":"vllm"}</arguments>
</use_mcp_tool>`;
    const calls = parseToolCallsFromContent(content);
    expect(calls.length).toBe(0);
  });

  it("injects tool_calls before [DONE] for streaming XML", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"<tool_call><function=calc><arguments>{\\"x\\":1}</arguments></tool_call>"}}]}\n\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    expect(output).toContain('"tool_calls"');
    expect(output).toContain('"name":"calc"');
    expect(output).toContain("data: [DONE]");
  });

  it("moves split <think> blocks to reasoning_content in streaming output", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"foo <thi"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"nk>secret</think> world"}}]}\n\n')
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("foo  world");
    expect(delta.reasoning).toBe("secret");
    expect(delta.content.toLowerCase()).not.toContain("<think");
    expect(delta.reasoning.toLowerCase()).not.toContain("<think");
  });

  it("moves two split <think> blocks in order", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"start <thi"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"nk>first</think> mid <thi"}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"nk>second</think> end"}}]}\n\n')
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("start  mid  end");
    expect(delta.reasoning).toContain("first");
    expect(delta.reasoning).toContain("second");
    expect(delta.content.toLowerCase()).not.toContain("<think");
    expect(delta.content.toLowerCase()).not.toContain("nk>");
    expect(delta.reasoning.toLowerCase()).not.toContain("<think");
  });

  it("moves split <thinking> blocks to reasoning_content in streaming output", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"foo <think"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"ing>secret</thinking> bar"}}]}\n\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("foo  bar");
    expect(delta.reasoning).toBe("secret");
    expect(delta.content.toLowerCase()).not.toContain("<thinking");
    expect(delta.reasoning.toLowerCase()).not.toContain("<thinking");
  });

  it("handles multi-line SSE data events and still extracts thinking blocks", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"foo <think>secret</think> bar"}}]\n'
          )
        );
        controller.enqueue(encoder.encode("data: }\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("foo  bar");
    expect(delta.reasoning).toBe("secret");
    expect(delta.content.toLowerCase()).not.toContain("<think");
    expect(delta.reasoning.toLowerCase()).not.toContain("<think");
  });

  it("continues extracting thinking after tool_calls deltas", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"before <think>one</think> after"}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"noop","arguments":"{}"}}]}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":" tail <think>two</think> end"}}]}\n\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("before  after tail  end");
    expect(delta.reasoning).toContain("one");
    expect(delta.reasoning).toContain("two");
    expect(delta.content.toLowerCase()).not.toContain("<think");
    expect(delta.reasoning.toLowerCase()).not.toContain("<think");
  });

  it("moves split <think> blocks in reasoning_content to reasoning", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"<thi"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"nk>classified</think>"}}]}\n\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("");
    expect(delta.reasoning).toBe("classified");
    expect(delta.reasoning.toLowerCase()).not.toContain("<think");
  });

  it("handles stray close tag without prior open in streaming", async () => {
    const encoder = new TextEncoder();
    const closeTag = String.raw`</think` + ">";
    const payload = `data: {"choices":[{"delta":{"content":"hidden reasoning${closeTag} visible"}}]}\n\n`;
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode(payload));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe(" visible");
    expect(delta.reasoning).toBe("hidden reasoning");
    expect(delta.content.toLowerCase()).not.toContain("</think");
    expect(delta.reasoning.toLowerCase()).not.toContain("</think");
  });

  it("does not inject tool calls from reasoning content", async () => {
    const encoder = new TextEncoder();
    const toolCallXml = `❌<function=calc><arguments>{"x":1}</arguments>❌`;
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(`data: {"choices":[{"delta":{"content":"result is 42"}}]}\n\n`)
        );
        controller.enqueue(
          encoder.encode(
            `data: {"choices":[{"delta":{"reasoning_content":"let me use ${toolCallXml}"}}]}\n\n`
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    expect(output).not.toContain('"tool_calls"');
    expect(output).toContain("result is 42");
  });

  it("handles unclosed think tag at stream end", async () => {
    const encoder = new TextEncoder();
    const openTag = String.raw`<think` + ">";
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(`data: {"choices":[{"delta":{"content":"visible ${openTag}"}}]}\n\n`)
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"\\nreasoning text"}}]}\n\n')
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("visible ");
    expect(delta.reasoning).toContain("reasoning text");
    expect(delta.content.toLowerCase()).not.toContain("<think");
  });

  it("handles thinking tag split across many tiny deltas", async () => {
    const encoder = new TextEncoder();
    const parts = ["<", "t", "h", "i", "n", "k", ">secret<", "/", "t", "h", "i", "n", "k", ">"];
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const part of parts) {
          controller.enqueue(
            encoder.encode(`data: {"choices":[{"delta":{"content":"${part}"}}]}\n\n`)
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe("");
    expect(delta.reasoning).toBe("secret");
  });

  it("handles close tag in separate delta from any open tag", async () => {
    const encoder = new TextEncoder();
    const closeTag = String.raw`</think` + ">";
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(
          encoder.encode(
            `data: {"choices":[{"delta":{"content":"secret text${closeTag} after"}}]}\n\n`
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    const events = parseSseDataLines(output);
    const delta = collectDeltaText(events);
    expect(delta.content).toBe(" after");
    expect(delta.reasoning).toBe("secret text");
  });
});

describe("normalizeChatMessageContentParts", () => {
  it("collapses OpenAI text content arrays for text-only local backends", async () => {
    const { normalizeChatMessageContentParts } = await import("../modules/proxy/content-normalizer");
    const payload: Record<string, unknown> = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "say " },
            { type: "text", text: "hi" },
          ],
        },
        { role: "assistant", content: "hello" },
      ],
    };

    expect(normalizeChatMessageContentParts(payload)).toBe(true);
    expect(payload).toEqual({
      messages: [
        { role: "user", content: "say hi" },
        { role: "assistant", content: "hello" },
      ],
    });
  });

  it("leaves multimodal arrays intact", async () => {
    const { normalizeChatMessageContentParts } = await import("../modules/proxy/content-normalizer");
    const content = [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ];
    const payload: Record<string, unknown> = { messages: [{ role: "user", content }] };

    expect(normalizeChatMessageContentParts(payload)).toBe(false);
    expect((payload["messages"] as Array<Record<string, unknown>>)[0]?.["content"]).toBe(content);
  });
});
