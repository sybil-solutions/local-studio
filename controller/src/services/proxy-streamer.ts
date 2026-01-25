// CRITICAL
import { randomUUID } from "node:crypto";
import type {
  ToolCall,
  ToolCallBuffer,
  ThinkState,
  Utf8State,
} from "./proxy-parsers";
import {
  createToolCallId,
  fixMalformedToolCalls,
  parseThinkTagsFromContent,
  parseToolCallsFromContent,
  cleanUtf8StreamContent,
} from "./proxy-parsers";

/**
 * Token usage from stream.
 */
export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

/**
 * Options for streaming proxy transforms.
 */
export interface ProxyStreamOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  toolCallBuffer: ToolCallBuffer;
  thinkState: ThinkState;
  utf8State: Utf8State;
  extractToolName: (content: string) => string;
  onUsage?: (usage: StreamUsage) => void;
}

const shouldSkipUserEcho = (payload: Record<string, unknown>): boolean => {
  const choices = payload["choices"];
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }
  for (const choice of choices) {
    const choiceRecord = choice as Record<string, unknown>;
    const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as
      | Record<string, unknown>
      | undefined;
    if (!delta || delta["role"] !== "user") {
      continue;
    }
    const toolCalls = delta["tool_calls"];
    if (!Array.isArray(toolCalls) || toolCalls.length !== 0) {
      continue;
    }
    const content = typeof delta["content"] === "string" ? delta["content"].trim() : "";
    const reasoning =
      typeof delta["reasoning_content"] === "string" ? delta["reasoning_content"].trim() : "";
    if (!content && !reasoning) {
      return true;
    }
  }
  return false;
};

const stripUserEchoLines = (chunk: string): string => {
  const lines = chunk.split("\n");
  const filtered = lines.map((line) => {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      const dataJson = line.slice(6);
      if (!dataJson.trim()) {
        return line;
      }
      try {
        const data = JSON.parse(dataJson) as Record<string, unknown>;
        if (shouldSkipUserEcho(data)) {
          return "";
        }
      } catch {
        return line;
      }
    }
    return line;
  });
  return filtered.join("\n");
};

/**
 * Create a transformed streaming response for LiteLLM output.
 * @param options - Streaming options.
 * @returns ReadableStream with transformed SSE chunks.
 */
export const createProxyStream = (options: ProxyStreamOptions): ReadableStream<Uint8Array> => {
  const { reader, toolCallBuffer, thinkState, utf8State, extractToolName, onUsage } = options;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let usageTracked = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        const result = await reader.read();
        value = result.value;
        done = result.done;
      } catch {
        controller.close();
        return;
      }
      if (done) {
        const parsedTools: ToolCall[] = [];
        if (!toolCallBuffer.tool_calls_found && toolCallBuffer.tool_args) {
          const argsString = toolCallBuffer.tool_args.trim();
          let name = toolCallBuffer.tool_name;
          if (!name) {
            name = extractToolName(toolCallBuffer.content);
          }
          if (argsString.startsWith("{") && argsString.endsWith("}") && name) {
            parsedTools.push({
              index: 0,
              id: createToolCallId(),
              type: "function",
              function: { name, arguments: argsString },
            });
          }
        }
        if (parsedTools.length === 0 && !toolCallBuffer.tool_calls_found && toolCallBuffer.content) {
          const content = toolCallBuffer.content;
          const hasPattern = content.includes("</tool_call>") ||
            content.includes("<tool_call>") ||
            content.includes("</use_mcp_tool>") ||
            content.includes("use_mcp_tool>") ||
            (content.includes("\"name\"") && content.includes("\"arguments\""));
          if (hasPattern) {
            const parsed = parseToolCallsFromContent(content);
            parsedTools.push(...parsed);
          }
        }
        if (parsedTools.length > 0) {
          const finalChunk = {
            id: `chatcmpl-${randomUUID().slice(0, 8)}`,
            choices: [{
              index: 0,
              delta: { tool_calls: parsedTools },
              finish_reason: "tool_calls",
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
        }
        controller.close();
        return;
      }

      let chunk = decoder.decode(value, { stream: true });
      chunk = stripUserEchoLines(chunk);

      if (chunk.includes("\"reasoning\":") && chunk.includes("\"reasoning_content\":")) {
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) {
              return line;
            }
            try {
              const data = JSON.parse(dataJson) as Record<string, unknown>;
              const choices = data["choices"];
              if (Array.isArray(choices)) {
                for (const choice of choices) {
                  const choiceRecord = choice as Record<string, unknown>;
                  const delta = choiceRecord["delta"] as Record<string, unknown> | undefined;
                  if (delta && delta["reasoning"]) {
                    delete delta["reasoning"];
                  }
                }
              }
              return `data: ${JSON.stringify(data)}`;
            } catch {
              return line;
            }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      if (chunk.includes("<think>") || chunk.includes("</think>") || thinkState.inThinking) {
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) {
              return line;
            }
            try {
              const data = JSON.parse(dataJson) as Record<string, unknown>;
              const updated = parseThinkTagsFromContent(data, thinkState);
              return `data: ${JSON.stringify(updated)}`;
            } catch {
              return line;
            }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      if (chunk.includes("\"tool_calls\"") || chunk.includes("<tool_call>") || chunk.includes("\"name\"")) {
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) {
              return line;
            }
            try {
              const data = JSON.parse(dataJson) as Record<string, unknown>;
              const updated = fixMalformedToolCalls(data, toolCallBuffer);
              return `data: ${JSON.stringify(updated)}`;
            } catch {
              return line;
            }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      // Clean UTF-8 corruption from streaming tokenizer byte fallback
      // This handles GLM and other models that split Unicode chars across tokens
      if (chunk.includes("\uFFFD") || utf8State.pendingContent || utf8State.pendingReasoning) {
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) {
              return line;
            }
            try {
              const data = JSON.parse(dataJson) as Record<string, unknown>;
              const choices = data["choices"];
              if (Array.isArray(choices)) {
                for (const choice of choices) {
                  const choiceRecord = choice as Record<string, unknown>;
                  const delta = choiceRecord["delta"] as Record<string, unknown> | undefined;
                  if (delta) {
                    // Clean content field
                    if (typeof delta["content"] === "string") {
                      const cleaned = cleanUtf8StreamContent(delta["content"] as string, utf8State);
                      delta["content"] = cleaned || null;
                    }
                    // Clean reasoning_content field
                    if (typeof delta["reasoning_content"] === "string") {
                      // Use a separate state for reasoning to avoid cross-contamination
                      const reasoningState = { pendingContent: utf8State.pendingReasoning, pendingReasoning: "" };
                      const cleaned = cleanUtf8StreamContent(delta["reasoning_content"] as string, reasoningState);
                      utf8State.pendingReasoning = reasoningState.pendingContent;
                      delta["reasoning_content"] = cleaned || null;
                    }
                  }
                }
              }
              return `data: ${JSON.stringify(data)}`;
            } catch {
              return line;
            }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          const jsonPart = line.slice(6);
          if (!jsonPart.trim()) {
            continue;
          }
          try {
            const data = JSON.parse(jsonPart) as Record<string, unknown>;

            // Track usage when it appears (typically in final chunks)
            if (!usageTracked && data["usage"] && onUsage) {
              const usage = data["usage"] as Record<string, number>;
              if (usage["prompt_tokens"] || usage["completion_tokens"]) {
                onUsage({
                  prompt_tokens: usage["prompt_tokens"] ?? 0,
                  completion_tokens: usage["completion_tokens"] ?? 0,
                });
                usageTracked = true;
              }
            }

            const choices = data["choices"];
            if (Array.isArray(choices)) {
              for (const choice of choices) {
                const choiceRecord = choice as Record<string, unknown>;
                const delta = choiceRecord["delta"] as Record<string, unknown> | undefined;
                const content = typeof delta?.["content"] === "string" ? String(delta["content"]) : "";
                const reasoning = typeof delta?.["reasoning_content"] === "string" ? String(delta["reasoning_content"]) : "";
                if (content) {
                  toolCallBuffer.content += content;
                }
                if (reasoning) {
                  toolCallBuffer.content += reasoning;
                }
                const toolCalls = Array.isArray(delta?.["tool_calls"]) ? (delta?.["tool_calls"] as unknown[]) : [];
                if (toolCalls.length > 0) {
                  for (const toolCall of toolCalls) {
                    const toolRecord = toolCall as Record<string, unknown>;
                    const functionRecord = toolRecord["function"] as Record<string, unknown> | undefined;
                    const name = typeof functionRecord?.["name"] === "string" ? String(functionRecord["name"]) : "";
                    const args = typeof functionRecord?.["arguments"] === "string" ? String(functionRecord["arguments"]) : "";
                    if (name) {
                      toolCallBuffer.tool_name = name;
                      toolCallBuffer.tool_calls_found = true;
                    }
                    if (args) {
                      toolCallBuffer.tool_args += args;
                    }
                  }
                }
              }
            }
          } catch {
            continue;
          }
        }
      }

      controller.enqueue(encoder.encode(chunk));
    },
    async cancel(): Promise<void> {
      await reader.cancel();
    },
  });
};
