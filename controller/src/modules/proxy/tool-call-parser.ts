import { randomUUID } from "node:crypto";
import { parseJsonWithRepair } from "@earendil-works/pi-ai";

export interface ToolCall {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export const createToolCallId = (): string => `call_${randomUUID().replace(/-/g, "").slice(0, 9)}`;

const parseJsonCandidate = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return parseJsonWithRepair(trimmed);
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

const toolCallRecordFromParsed = (parsed: unknown): { name: string; args: unknown } | null => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const name = String(record["tool"] ?? record["name"] ?? "").trim();
  if (!name) return null;
  return {
    name,
    args: record["args"] ?? record["arguments"] ?? record["parameters"] ?? {},
  };
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
        ? parseJsonCandidate(rawValue)
        : null;
    args[name] = parsed ?? rawValue;
  }
  return found ? args : null;
};

const parseInvokeToolCalls = (content: string, startIndex: number): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  const invokePattern = /<invoke\s+name=(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/invoke>/gi;
  for (const match of content.matchAll(invokePattern)) {
    const name = String(match[2] ?? "").trim();
    if (!name) continue;
    const args = parseParameterBlocks(String(match[3] ?? "")) ?? {};
    toolCalls.push(buildToolCall(name, args, startIndex + toolCalls.length));
  }
  return toolCalls;
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

const parseJsonToolCalls = (content: string, startIndex: number): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const objectStart = content.indexOf("{", cursor);
    if (objectStart < 0) break;
    const raw = extractBalancedValue(content, objectStart);
    if (!raw) {
      cursor = objectStart + 1;
      continue;
    }
    const parsed = parseJsonCandidate(raw);
    const record = toolCallRecordFromParsed(parsed);
    if (record) {
      toolCalls.push(buildToolCall(record.name, record.args, startIndex + toolCalls.length));
    }
    cursor = objectStart + raw.length;
  }
  return toolCalls;
};

export const stripToolCallsFromContent = (content: string): string => {
  if (!content) return "";
  let cleaned = content;
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  cleaned = cleaned.replace(/<invoke\s+name=(["']?)[^"'\s>]+\1[^>]*>[\s\S]*?<\/invoke>/gi, "");
  cleaned = cleaned.replace(/<?use_mcp[\s_]*tool>[\s\S]*?<\/use_mcp[\s_]*tool>/gi, "");
  cleaned = cleaned.replace(/(^|\n)[^\n]*\{[^\n]*\}[^\n]*(?=\n|$)/g, (line) => {
    return parseJsonToolCalls(line, 0).length > 0 ? (line.startsWith("\n") ? "\n" : "") : line;
  });
  // A tool call that opened but never closed (split across stream deltas, or
  // truncated) — drop the dangling block from the opening tag to the end so its
  // half-written arguments don't leak into the answer/reasoning.
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/i, "");
  // Final pass: remove ORPHAN tool-call structural tags. The <parameter>/
  // <arg_value> dialect, or a fragment whose opening tag arrived in an earlier
  // delta, can leave a stray tag (e.g. a lone "</arg_value>") that the patterns
  // above don't match — which then leaks into the visible answer or the
  // reasoning bubble. These tags never occur in real prose.
  cleaned = cleaned.replace(
    /<\/?(?:tool_call|arguments|arg_value|arg_key|invoke|function|parameter)(?:[=\s][^>]*)?>/gi,
    "",
  );
  return cleaned;
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
      const parsed = parseJsonCandidate(args);
      args = parsed ?? args;
    } else {
      args = parseParameterBlocks(block);
    }

    if (!toolName) {
      const jsonCandidate = block.match(/\{[\s\S]*\}/);
      const parsed = jsonCandidate ? parseJsonCandidate(jsonCandidate[0]) : null;
      const record = toolCallRecordFromParsed(parsed);
      if (record) {
        toolCalls.push(buildToolCall(record.name, record.args, toolCalls.length));
        continue;
      }
      continue;
    }

    toolCalls.push(buildToolCall(toolName, args ?? {}, toolCalls.length));
  }

  if (toolCalls.length === 0) {
    toolCalls.push(...parseInvokeToolCalls(content, 0));
  }

  if (toolCalls.length === 0) {
    toolCalls.push(...parseJsonToolCalls(content, 0));
  }

  if (toolCalls.length === 0) {
    const jsonPattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*/g;
    for (const match of content.matchAll(jsonPattern)) {
      const name = String(match[1] ?? "").trim();
      const argsStart = (match.index ?? 0) + match[0].length;
      const argsRaw = extractBalancedValue(content.slice(argsStart), 0) ?? "";
      const parsedArguments = argsRaw ? (parseJsonCandidate(argsRaw) ?? argsRaw) : {};
      if (name) {
        toolCalls.push(buildToolCall(name, parsedArguments, toolCalls.length));
      }
    }
  }

  return toolCalls;
};
