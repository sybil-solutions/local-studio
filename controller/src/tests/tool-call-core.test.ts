// CRITICAL
import { describe, expect, it } from "bun:test";
import { createToolCallStream, parseToolCallsFromContent } from "../services/tool-call-core";

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

describe("tool-call-core", () => {
  it("parses tool calls from XML blocks", () => {
    const content = `<tool_call><function=weather><arguments>{"city":"Paris"}</arguments></tool_call>`;
    const calls = parseToolCallsFromContent(content);
    expect(calls.length).toBe(1);
    expect(calls[0]?.function.name).toBe("weather");
    expect(calls[0]?.function.arguments).toContain("\"Paris\"");
  });

  it("parses MCP tool calls into server__tool", () => {
    const content = `<use_mcp_tool>
<server_name>exa</server_name>
<tool_name>search</tool_name>
<arguments>{"q":"vllm"}</arguments>
</use_mcp_tool>`;
    const calls = parseToolCallsFromContent(content);
    expect(calls.length).toBe(1);
    expect(calls[0]?.function.name).toBe("exa__search");
  });

  it("injects tool_calls before [DONE] for streaming XML", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode(
          "data: {\"choices\":[{\"delta\":{\"content\":\"<tool_call><function=calc><arguments>{\\\"x\\\":1}</arguments></tool_call>\"}}]}\n\n",
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const stream = createToolCallStream(source.getReader());
    const output = await collectStream(stream);
    expect(output).toContain("\"tool_calls\"");
    expect(output).toContain("\"name\":\"calc\"");
    expect(output).toContain("data: [DONE]");
  });
});
