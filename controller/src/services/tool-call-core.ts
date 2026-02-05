// CRITICAL
import { randomUUID } from "node:crypto";

export interface ToolCall {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export const createToolCallId = (): string => `call_${randomUUID().replace(/-/g, "").slice(0, 9)}`;

const safeJsonParse = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const coerceArguments = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return "{}";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
};

const parseParameterBlocks = (block: string): Record<string, unknown> | null => {
  const args: Record<string, unknown> = {};
  const parameterPattern = /<parameter(?:\s+name=|=)([^>\s]+)>([\s\S]*?)<\/parameter>/gi;
  let found = false;
  for (const match of block.matchAll(parameterPattern)) {
    const name = String(match[1] ?? "").replace(/["']/g, "").trim();
    if (!name) continue;
    found = true;
    const rawValue = String(match[2] ?? "").trim();
    const parsed = rawValue && (rawValue.startsWith("{") || rawValue.startsWith("[")) ? safeJsonParse(rawValue) : null;
    args[name] = parsed ?? rawValue;
  }
  return found ? args : null;
};

const buildToolCall = (name: string, args: unknown, index: number): ToolCall => ({
  index,
  id: createToolCallId(),
  type: "function",
  function: { name, arguments: coerceArguments(args) },
});

export const normalizeToolRequest = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (payload["functions"] && !payload["tools"] && Array.isArray(payload["functions"])) {
    payload["tools"] = (payload["functions"] as Array<Record<string, unknown>>).map((functionDefinition) => ({
      type: "function",
      function: functionDefinition,
    }));
    delete payload["functions"];
  }
  return payload;
};

export const parseToolCallsFromContent = (content: string): ToolCall[] => {
  if (!content) return [];
  const toolCalls: ToolCall[] = [];

  const mcpPattern = /<?use_mcp_tool>\s*<?server_name>([^<]*)<\/server_name>\s*<?tool_name>([^<]*)<\/tool_name>\s*<?arguments>\s*([\s\S]*?)\s*<\/arguments>\s*<\/use_mcp[\s_]*tool>/gi;
  for (const match of content.matchAll(mcpPattern)) {
    const server = String(match[1] ?? "").trim();
    const tool = String(match[2] ?? "").trim();
    const argsRaw = String(match[3] ?? "").trim();
    if (!tool) continue;
    const argsParsed = argsRaw ? safeJsonParse(argsRaw) ?? argsRaw : {};
    const name = server ? `${server}__${tool}` : tool;
    toolCalls.push(buildToolCall(name, argsParsed, toolCalls.length));
  }

  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  for (const match of content.matchAll(toolCallPattern)) {
    const block = String(match[1] ?? "");
    const functionMatch = block.match(/<function(?:=|\s+name=)([^>\s]+)[^>]*>/i);
    const toolName = functionMatch ? String(functionMatch[1]).replace(/["']/g, "").trim() : "";
    const argsMatch = block.match(/<arguments>([\s\S]*?)<\/arguments>/i);
    let args: unknown = argsMatch ? String(argsMatch[1] ?? "").trim() : null;
    if (typeof args === "string" && args) {
      const parsed = safeJsonParse(args);
      args = parsed ?? args;
    } else {
      args = parseParameterBlocks(block);
    }

    if (!toolName) {
      const jsonCandidate = block.match(/\{[\s\S]*\}/);
      const parsed = jsonCandidate ? safeJsonParse(jsonCandidate[0]) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const name = String((parsed as Record<string, unknown>)["name"] ?? "").trim();
        const argumentsValue = (parsed as Record<string, unknown>)["arguments"];
        if (name) {
          toolCalls.push(buildToolCall(name, argumentsValue ?? {}, toolCalls.length));
          continue;
        }
      }
      continue;
    }

    toolCalls.push(buildToolCall(toolName, args ?? {}, toolCalls.length));
  }

  if (toolCalls.length === 0) {
    const jsonPattern = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
    for (const match of content.matchAll(jsonPattern)) {
      const name = String(match[1] ?? "").trim();
      const argsRaw = String(match[2] ?? "").trim();
      const parsedArguments = argsRaw ? safeJsonParse(argsRaw) ?? argsRaw : {};
      if (name) {
        toolCalls.push(buildToolCall(name, parsedArguments, toolCalls.length));
      }
    }
  }

  return toolCalls;
};

export const normalizeToolCallsInMessage = (message: Record<string, unknown>): boolean => {
  const existing = message["tool_calls"];
  const hasToolCalls = Array.isArray(existing) && existing.length > 0;
  if (hasToolCalls) {
    return false;
  }
  const content = typeof message["content"] === "string" ? String(message["content"]) : "";
  const reasoning = typeof message["reasoning_content"] === "string" ? String(message["reasoning_content"]) : "";
  const parsed = parseToolCallsFromContent(`${content}${reasoning}`);
  if (parsed.length > 0) {
    message["tool_calls"] = parsed;
    return true;
  }
  return false;
};

export const createToolCallStream = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onUsage?: (usage: StreamUsage) => void,
): ReadableStream<Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let contentBuffer = "";
  let toolCallsFound = false;
  let usageTracked = false;

  const enqueueLine = (controller: ReadableStreamDefaultController<Uint8Array>, line: string): void => {
    controller.enqueue(encoder.encode(`${line}\n`));
  };

  const buildToolCallChunk = (toolCalls: ToolCall[]): string => {
    const payload = {
      id: `chatcmpl-${randomUUID().slice(0, 8)}`,
      choices: [{
        index: 0,
        delta: { tool_calls: toolCalls },
        finish_reason: "tool_calls",
      }],
    };
    return `data: ${JSON.stringify(payload)}`;
  };

  const parseUsage = (data: Record<string, unknown>): void => {
    if (usageTracked || !onUsage) return;
    const usage = data["usage"] as Record<string, number> | undefined;
    if (usage && (usage["prompt_tokens"] || usage["completion_tokens"])) {
      onUsage({
        prompt_tokens: usage["prompt_tokens"] ?? 0,
        completion_tokens: usage["completion_tokens"] ?? 0,
      });
      usageTracked = true;
    }
  };

  const absorbDeltaContent = (data: Record<string, unknown>): void => {
    const choices = data["choices"];
    if (!Array.isArray(choices)) return;
    for (const choice of choices) {
      const choiceRecord = choice as Record<string, unknown>;
      const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as Record<string, unknown> | undefined;
      if (!delta) continue;
      const toolCalls = delta["tool_calls"];
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        toolCallsFound = true;
      }
      const content = typeof delta["content"] === "string" ? String(delta["content"]) : "";
      const reasoning = typeof delta["reasoning_content"] === "string" ? String(delta["reasoning_content"]) : "";
      if (content) contentBuffer += content;
      if (reasoning) contentBuffer += reasoning;
    }
  };

  const maybeInjectToolCalls = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (toolCallsFound || !contentBuffer) return;
    const parsed = parseToolCallsFromContent(contentBuffer);
    if (parsed.length > 0) {
      enqueueLine(controller, buildToolCallChunk(parsed));
      toolCallsFound = true;
    }
  };

  type ReaderResult = { done: boolean; value?: Uint8Array | undefined };

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      let result: ReaderResult;
      try {
        result = await reader.read();
      } catch {
        controller.close();
        return;
      }
      if (result.done) {
        if (buffer.trim()) {
          enqueueLine(controller, buffer);
          buffer = "";
        }
        maybeInjectToolCalls(controller);
        controller.close();
        return;
      }

      const chunk = result.value ?? new Uint8Array();
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            maybeInjectToolCalls(controller);
            enqueueLine(controller, "data: [DONE]");
            continue;
          }
          if (data) {
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              parseUsage(parsed);
              absorbDeltaContent(parsed);
            } catch {
              // passthrough
            }
          }
        }
        enqueueLine(controller, line);
      }
    },
    async cancel(): Promise<void> {
      await reader.cancel();
    },
  });
};
