import { randomUUID } from "node:crypto";

export interface ToolCall {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export const createToolCallId = (): string =>
  `call_${randomUUID().replace(/-/g, "").slice(0, 9)}`;

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
    const name = String(match[1] ?? "")
      .replace(/["']/g, "")
      .trim();
    if (!name) continue;
    found = true;
    const rawValue = String(match[2] ?? "").trim();
    const parsed =
      rawValue && (rawValue.startsWith("{") || rawValue.startsWith("["))
        ? safeJsonParse(rawValue)
        : null;
    args[name] = parsed ?? rawValue;
  }
  return found ? args : null;
};

const extractBalancedValue = (input: string, start: number): string | null => {
  let index = start;
  while (index < input.length && /\s/.test(input[index] ?? "")) {
    index += 1;
  }
  if (index >= input.length) return null;

  const open = input[index];
  if (open !== "{" && open !== "[" && open !== '"') return null;

  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) {
    let cursor = index + 1;
    let escaping = false;
    for (; cursor < input.length; cursor += 1) {
      const char = input[cursor];
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        return input.slice(index, cursor + 1);
      }
    }
    return null;
  }

  let depth = 0;
  let cursor = index;
  let inString = false;
  let escaping = false;
  for (; cursor < input.length; cursor += 1) {
    const char = input[cursor];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return input.slice(index, cursor + 1);
      }
    }
  }
  return null;
};

const buildToolCall = (name: string, args: unknown, index: number): ToolCall => ({
  index,
  id: createToolCallId(),
  type: "function",
  function: { name, arguments: coerceArguments(args) },
});

export const parseToolCallsFromContent = (content: string): ToolCall[] => {
  if (!content) return [];
  const toolCalls: ToolCall[] = [];

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
    const jsonPattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*/g;
    for (const match of content.matchAll(jsonPattern)) {
      const name = String(match[1] ?? "").trim();
      const argsStart = (match.index ?? 0) + match[0].length;
      const argsRaw = extractBalancedValue(content.slice(argsStart), 0) ?? "";
      const parsedArguments = argsRaw ? (safeJsonParse(argsRaw) ?? argsRaw) : {};
      if (name) {
        toolCalls.push(buildToolCall(name, parsedArguments, toolCalls.length));
      }
    }
  }

  return toolCalls;
};
