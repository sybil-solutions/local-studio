import { randomUUID } from "node:crypto";

/**
 * Tool call payload.
 */
export interface ToolCall {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * Thinking tag state tracker.
 */
export interface ThinkState {
  inThinking: boolean;
}

/**
 * Tool call buffer for streaming.
 */
export interface ToolCallBuffer {
  content: string;
  tool_args: string;
  tool_name: string;
  has_malformed_tool_calls: boolean;
  tool_calls_found: boolean;
}

/**
 * Build a tool call id.
 * @returns Tool call id.
 */
export const createToolCallId = (): string => `call_${randomUUID().replace(/-/g, "").slice(0, 9)}`;

/**
 * Parse tool calls from a text payload.
 * @param content - Raw model content.
 * @returns Parsed tool calls.
 */
export const parseToolCallsFromContent = (content: string): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  const mcpPattern = /<?use_mcp_tool>\s*<?server_name>([^<]*)<\/server_name>\s*<?tool_name>([^<]*)<\/tool_name>\s*<?arguments>\s*(\{.*?\})\s*<\/arguments>\s*<\/use_mcp[\s_]*tool>/gs;
  const mcpMatches = Array.from(content.matchAll(mcpPattern));
  for (const match of mcpMatches) {
    const toolName = (match[2] ?? "").trim();
    const argsJson = (match[3] ?? "").trim();
    toolCalls.push({
      index: toolCalls.length,
      id: createToolCallId(),
      type: "function",
      function: { name: toolName, arguments: argsJson },
    });
  }
  if (toolCalls.length > 0) {
    return toolCalls;
  }

  if (content.includes("</tool_call>")) {
    const pattern = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}\s*<\/tool_call>/gs;
    for (const match of content.matchAll(pattern)) {
      toolCalls.push({
        index: toolCalls.length,
        id: createToolCallId(),
        type: "function",
        function: { name: String(match[1] ?? ""), arguments: String(match[2] ?? "") },
      });
    }
  }

  if (toolCalls.length === 0 && content.includes("<tool_call>")) {
    const pattern = /<tool_call>\s*(\{.*?\})\s*<\/tool_call>/gs;
    for (const match of content.matchAll(pattern)) {
      try {
        const payload = match[1];
        if (!payload) {
          continue;
        }
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        toolCalls.push({
          index: toolCalls.length,
          id: createToolCallId(),
          type: "function",
          function: {
            name: String(parsed["name"] ?? ""),
            arguments: JSON.stringify(parsed["arguments"] ?? {}),
          },
        });
      } catch {
        continue;
      }
    }
  }

  if (toolCalls.length === 0 && content.includes("\"name\"") && content.includes("\"arguments\"")) {
    const pattern = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/gs;
    for (const match of content.matchAll(pattern)) {
      toolCalls.push({
        index: toolCalls.length,
        id: createToolCallId(),
        type: "function",
        function: { name: String(match[1] ?? ""), arguments: String(match[2] ?? "") },
      });
    }
  }

  return toolCalls;
};

/**
 * Parse think tags into reasoning content.
 * @param payload - SSE payload object.
 * @param state - Think state.
 * @returns Updated payload.
 */
export const parseThinkTagsFromContent = (
  payload: Record<string, unknown>,
  state: ThinkState,
): Record<string, unknown> => {
  const choices = payload["choices"];
  if (!Array.isArray(choices)) {
    return payload;
  }

  for (const choice of choices) {
    const choiceRecord = choice as Record<string, unknown>;
    const delta = choiceRecord["delta"] as Record<string, unknown> | undefined;
    if (!delta) {
      continue;
    }
    const content = delta["content"];
    if (typeof content !== "string" || content.length === 0) {
      continue;
    }
    if (delta["reasoning_content"]) {
      continue;
    }

    if (content.includes("</think>") && !content.includes("<think>") && !state.inThinking) {
      const [reasoning, remaining = ""] = content.split("</think>", 2);
      delta["reasoning_content"] = reasoning;
      delta["content"] = remaining?.trim() || null;
      continue;
    }

    if (content.includes("<think>")) {
      const [before = "", after = ""] = content.split("<think>", 2);
      state.inThinking = true;
      if (after.includes("</think>")) {
        const [reasoning, remaining = ""] = after.split("</think>", 2);
        state.inThinking = false;
        delta["reasoning_content"] = reasoning;
        delta["content"] = `${before}${remaining ?? ""}`.trim() || null;
      } else {
        delta["reasoning_content"] = after;
        delta["content"] = before.trim() || null;
      }
      continue;
    }

    if (state.inThinking) {
      if (content.includes("</think>")) {
        const [reasoning, remaining = ""] = content.split("</think>", 2);
        state.inThinking = false;
        delta["reasoning_content"] = reasoning;
        delta["content"] = remaining?.trim() || null;
      } else {
        delta["reasoning_content"] = content;
        delta["content"] = null;
      }
    }
  }

  return payload;
};

/**
 * Fix tool calls with missing function names by parsing from content.
 * @param payload - SSE payload object.
 * @param buffer - Tool call buffer.
 * @returns Updated payload.
 */
export const fixMalformedToolCalls = (
  payload: Record<string, unknown>,
  buffer: ToolCallBuffer,
): Record<string, unknown> => {
  const choices = payload["choices"];
  if (!Array.isArray(choices)) {
    return payload;
  }

  for (const choice of choices) {
    const choiceRecord = choice as Record<string, unknown>;
    const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as Record<string, unknown> | undefined;
    if (!delta) {
      continue;
    }
    const content = typeof delta["content"] === "string" ? String(delta["content"]) : "";
    if (content) {
      buffer.content += content;
    }
    const toolCalls = Array.isArray(delta["tool_calls"]) ? (delta["tool_calls"] as unknown[]) : [];
    if (toolCalls.length === 0) {
      continue;
    }
    const fixed = toolCalls.map((toolCall) => {
      const toolRecord = toolCall as Record<string, unknown>;
      const functionRecord = toolRecord["function"] as Record<string, unknown> | undefined;
      const name = functionRecord?.["name"];
      if (!name || String(name).trim() === "") {
        buffer.has_malformed_tool_calls = true;
        const nameMatch = buffer.content.match(/"name"\s*:\s*"([^"]+)"/);
        if (nameMatch && functionRecord) {
          functionRecord["name"] = nameMatch[1] ?? "";
        }
      }
      return toolRecord;
    });
    delta["tool_calls"] = fixed;
  }

  return payload;
};
