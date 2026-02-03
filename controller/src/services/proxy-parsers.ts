// CRITICAL
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
 * UTF-8 streaming state for handling incomplete multi-byte sequences.
 * Some tokenizers (like GLM) split Unicode characters across tokens,
 * causing replacement characters (U+FFFD) in streaming output.
 */
export interface Utf8State {
  /** Buffered content ending with replacement character */
  pendingContent: string;
  /** Buffered reasoning ending with replacement character */
  pendingReasoning: string;
}

/** Unicode replacement character */
const REPLACEMENT_CHAR = "\uFFFD";
const BOX_DRAWING_RANGE = "[\\u2500-\\u257F\\u2580-\\u259F]";
const BOX_DRAWING_REGEX = new RegExp(BOX_DRAWING_RANGE);

/**
 * Pattern matching partial UTF-8 byte suffixes from tokenizer corruption.
 * When emoji/Unicode are split across tokens, trailing bytes often appear as
 * hex-like strings (e.g., "8f", "bf") after replacement characters.
 * This matches: replacement char(s) followed by 1-2 hex digits at end of string.
 */
const PARTIAL_BYTE_SUFFIX_PATTERN = /\uFFFD+[0-9a-f]{1,2}$/i;

/**
 * Pattern for replacement chars followed by byte suffixes mid-string.
 * Matches patterns like "���8f " or "�orid" from corrupted emoji.
 */
const CORRUPTED_EMOJI_PATTERN = /\uFFFD+[0-9a-f]{1,2}(?=\s|$|[^\w])/gi;

/**
 * Clean streaming content that may have UTF-8 corruption from tokenizer byte fallback.
 * This handles cases where multi-byte Unicode characters are split across tokens,
 * causing replacement characters to appear in the stream.
 *
 * Handles both box-drawing characters (GLM table corruption) and emoji/Unicode
 * (4-byte sequences like 🌸 that get split into partial bytes).
 *
 * @param content - The content string to clean.
 * @param state - UTF-8 streaming state.
 * @returns Cleaned content string.
 */
export const cleanUtf8StreamContent = (
  content: string,
  state: Utf8State,
): string => {
  if (!content) return content;

  // Prepend any pending content from previous chunk
  let result = state.pendingContent + content;
  state.pendingContent = "";

  // Buffer trailing replacement chars - they may combine with next chunk
  // This handles ALL multi-byte Unicode, not just box-drawing
  if (result.endsWith(REPLACEMENT_CHAR)) {
    state.pendingContent = result;
    return "";
  }

  // Buffer patterns like "���8f" at end - partial emoji byte sequences
  // These may combine with next chunk to form valid Unicode
  const partialMatch = result.match(PARTIAL_BYTE_SUFFIX_PATTERN);
  if (partialMatch) {
    // Only buffer if this looks like mid-emission (short content or ends string)
    const matchIndex = result.lastIndexOf(partialMatch[0]);
    if (matchIndex > 0) {
      // Buffer the corrupted suffix for potential recombination
      state.pendingContent = result.slice(matchIndex);
      result = result.slice(0, matchIndex);
      if (!result) return "";
    }
  }

  // Clean up corrupted emoji patterns that won't recombine
  // Pattern: replacement chars + hex suffix + boundary (space/punctuation/end)
  result = result.replace(CORRUPTED_EMOJI_PATTERN, "");

  // Clean orphaned replacement chars followed by common word patterns
  // e.g., "�orid" was meant to be an emoji + "orid" suffix - just keep the text
  result = result.replace(/\uFFFD+(?=[a-z]{2,})/gi, "");

  // Drop trailing replacement chars after box-drawing characters
  result = result.replace(new RegExp(`(${BOX_DRAWING_RANGE})\\uFFFD+$`, "g"), "$1");

  // Remove replacement characters in box-drawing corruption patterns:

  // 1. Before box-drawing characters (e.g., "�─" should be just "─")
  result = result.replace(new RegExp(`\\uFFFD+(?=${BOX_DRAWING_RANGE})`, "g"), "");

  // 2. After box-drawing characters (e.g., "─�" where corner/tee was corrupted)
  result = result.replace(new RegExp(`(${BOX_DRAWING_RANGE})\\uFFFD+`, "g"), "$1");

  // 3. Inside backticks (code context)
  result = result.replace(/`\uFFFD`/g, "``");
  result = result.replace(/`\uFFFD,/g, "`,");
  result = result.replace(/`\uFFFD\)/g, "`)");
  result = result.replace(/\uFFFD`/g, "`");

  // 4. Space + replacement patterns
  result = result.replace(new RegExp(` \\uFFFD+(?=${BOX_DRAWING_RANGE}|[ ,\`])`, "g"), " ");
  result = result.replace(/ \uFFFD+ /g, "  ");

  // 5. After common ASCII punctuation
  result = result.replace(/([,.:;])\uFFFD+/g, "$1");

  // 6. Clean remaining replacement chars in contexts where they're clearly corruption
  if (result.includes(REPLACEMENT_CHAR)) {
    const hasBoxContext = BOX_DRAWING_REGEX.test(result);
    // Also clean if we see HTML tag context (emoji in HTML attributes/content)
    const hasHtmlContext = /<[^>]*>/.test(result) || result.includes("</");
    if (hasBoxContext || hasHtmlContext) {
      result = result.replace(/\uFFFD/g, "");
    }
  }

  return result;
};

/**
 * Build a tool call id.
 * @returns Tool call id.
 */
export const createToolCallId = (): string => `call_${randomUUID().replace(/-/g, "").slice(0, 9)}`;

const parseHermesToolCalls = (content: string): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  const functionPattern = /<function=([^>\s]+)>/i;
  const parameterEqualsPattern = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/gi;
  const parameterNamePattern =
    /<parameter\s+name=[\"']?([^>\"'\s]+)[\"']?>([\s\S]*?)<\/parameter>/gi;
  const argsPattern = /<arguments>([\s\S]*?)<\/arguments>/i;

  for (const match of content.matchAll(toolCallPattern)) {
    const block = String(match[1] ?? "");
    const functionMatch = block.match(functionPattern);
    const toolName = functionMatch?.[1]?.trim() ?? "";
    if (!toolName) {
      continue;
    }

    const args: Record<string, unknown> = {};
    let hasParameters = false;

    for (const parameterMatch of block.matchAll(parameterEqualsPattern)) {
      const parameterName = String(parameterMatch[1] ?? "").trim();
      if (!parameterName) continue;
      hasParameters = true;
      const rawValue = String(parameterMatch[2] ?? "").trim();
      let value: unknown = rawValue;
      if (rawValue && (rawValue.startsWith("{") || rawValue.startsWith("["))) {
        try {
          value = JSON.parse(rawValue);
        } catch {
          value = rawValue;
        }
      }
      args[parameterName] = value;
    }

    if (!hasParameters) {
      for (const parameterMatch of block.matchAll(parameterNamePattern)) {
        const parameterName = String(parameterMatch[1] ?? "").trim();
        if (!parameterName) continue;
        hasParameters = true;
        const rawValue = String(parameterMatch[2] ?? "").trim();
        let value: unknown = rawValue;
        if (rawValue && (rawValue.startsWith("{") || rawValue.startsWith("["))) {
          try {
            value = JSON.parse(rawValue);
          } catch {
            value = rawValue;
          }
        }
        args[parameterName] = value;
      }
    }

    if (!hasParameters) {
      const argsMatch = block.match(argsPattern);
      if (argsMatch && argsMatch[1]) {
        const rawArguments = argsMatch[1].trim();
        if (rawArguments) {
          try {
            const parsed = JSON.parse(rawArguments);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              Object.assign(args, parsed as Record<string, unknown>);
            }
          } catch {
            args["raw"] = rawArguments;
          }
        }
      }
    }

    toolCalls.push({
      index: toolCalls.length,
      id: createToolCallId(),
      type: "function",
      function: { name: toolName, arguments: JSON.stringify(args) },
    });
  }

  return toolCalls;
};

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

  if (content.includes("<tool_call>") && content.includes("<function=")) {
    const hermesToolCalls = parseHermesToolCalls(content);
    if (hermesToolCalls.length > 0) {
      return hermesToolCalls;
    }
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
    const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as Record<string, unknown> | undefined;
    if (!delta) {
      continue;
    }
    const content = delta["content"];
    if (typeof content !== "string" || content.length === 0) {
      continue;
    }
    const hasReasoning = typeof delta["reasoning_content"] === "string";
    if (hasReasoning) {
      if (content.includes("<think>") || content.includes("</think>")) {
        const cleaned = content.replace(/<\/?think>/g, "").trim();
        delta["content"] = cleaned || null;
      }
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
        const functionMatch = buffer.content.match(/<function=([^>\s]+)>/i);
        if (functionRecord) {
          if (nameMatch) {
            functionRecord["name"] = nameMatch[1] ?? "";
          } else if (functionMatch) {
            functionRecord["name"] = functionMatch[1] ?? "";
          }
        }
      }
      return toolRecord;
    });
    delta["tool_calls"] = fixed;
  }

  return payload;
};
