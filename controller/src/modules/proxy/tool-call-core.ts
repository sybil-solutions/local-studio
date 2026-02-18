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

const extractBalancedValue = (input: string, start: number): string | null => {
  let index = start;
  while (index < input.length && /\s/.test(input[index] ?? "")) {
    index += 1;
  }
  if (index >= input.length) return null;

  const open = input[index];
  if (open !== "{" && open !== "[" && open !== "\"") return null;

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
      if (char === "\"") {
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
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
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

export const normalizeToolRequest = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (payload["functions"] && !payload["tools"] && Array.isArray(payload["functions"])) {
    payload["tools"] = (payload["functions"] as Array<Record<string, unknown>>).map((functionDefinition) => ({
      type: "function",
      function: functionDefinition,
    }));
    delete payload["functions"];
  }
  // Strip tool_choice: "auto" to avoid 400 errors from backends that don't have
  // --enable-auto-tool-choice configured. The backend will default to auto behavior anyway.
  if (payload["tool_choice"] === "auto") {
    delete payload["tool_choice"];
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
    const jsonPattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*/g;
    for (const match of content.matchAll(jsonPattern)) {
      const name = String(match[1] ?? "").trim();
      const argsStart = (match.index ?? 0) + match[0].length;
      const argsRaw = extractBalancedValue(content.slice(argsStart), 0) ?? "";
      const parsedArguments = argsRaw ? safeJsonParse(argsRaw) ?? argsRaw : {};
      if (name) {
        toolCalls.push(buildToolCall(name, parsedArguments, toolCalls.length));
      }
    }
  }

  return toolCalls;
};

const stripToolCallXmlBlocks = (text: string): string => {
  if (!text) return "";
  // Remove tool-call XML blocks from visible content after we have parsed tool_calls.
  // Keep this fairly conservative: only strip known tool wrapper blocks.
  let cleaned = text;
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  cleaned = cleaned.replace(/<?use_mcp[\s_]*tool>[\s\S]*?<\/use_mcp[\s_]*tool>/gi, "");
  // Collapse excessive whitespace left by removals.
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
};

const extractThinkBlocks = (text: string): { cleaned: string; extracted: string[] } => {
  if (!text) return { cleaned: "", extracted: [] };

  // Non-stream messages may contain incomplete thinking tags. We treat any text inside
  // <think>/<thinking>/<analysis> as reasoning and remove the tags from visible content,
  // even if the close tag never arrives.
  const extracted: string[] = [];
  const visibleParts: string[] = [];
  let remaining = String(text);

  const openPrefixes = ["<think", "<thinking", "<analysis"];
  const closePrefixes = ["</think", "</thinking", "</analysis"];

  const findNextTag = (lower: string): { kind: "open" | "close"; index: number } | null => {
    let openIndex = -1;
    for (const prefix of openPrefixes) {
      const index = lower.indexOf(prefix);
      if (index >= 0) openIndex = openIndex === -1 ? index : Math.min(openIndex, index);
    }
    let closeIndex = -1;
    for (const prefix of closePrefixes) {
      const index = lower.indexOf(prefix);
      if (index >= 0) closeIndex = closeIndex === -1 ? index : Math.min(closeIndex, index);
    }
    if (openIndex === -1 && closeIndex === -1) return null;
    if (openIndex !== -1 && (closeIndex === -1 || openIndex < closeIndex)) return { kind: "open", index: openIndex };
    return { kind: "close", index: closeIndex };
  };

  const parseTag = (input: string, start: number): { name: "think" | "thinking" | "analysis"; end: number } | null => {
    const closeIndex = input.indexOf(">", start);
    if (closeIndex < 0) return null;
    const tag = input.slice(start, closeIndex + 1);
    const open = tag.match(/^<(think|thinking|analysis)(?:\s+[^>]*)?>$/i);
    if (open) return { name: open[1]!.toLowerCase() as "think" | "thinking" | "analysis", end: closeIndex + 1 };
    const close = tag.match(/^<\/(think|thinking|analysis)(?:\s+[^>]*)?>$/i);
    if (close) return { name: close[1]!.toLowerCase() as "think" | "thinking" | "analysis", end: closeIndex + 1 };
    return null;
  };

  while (remaining) {
    const lower = remaining.toLowerCase();
    const next = findNextTag(lower);
    if (!next) {
      visibleParts.push(remaining);
      break;
    }

    if (next.kind === "open") {
      if (next.index > 0) visibleParts.push(remaining.slice(0, next.index));

      const openTag = parseTag(remaining, next.index);
      if (!openTag) {
        // Not a recognized tag; keep the "<" and continue.
        visibleParts.push(remaining.slice(0, next.index + 1));
        remaining = remaining.slice(next.index + 1);
        continue;
      }

      remaining = remaining.slice(openTag.end);
      const lowerAfter = remaining.toLowerCase();
      const closeStart = lowerAfter.indexOf(`</${openTag.name}`);
      if (closeStart < 0) {
        const value = remaining.trim();
        if (value) extracted.push(value);
        remaining = "";
        break;
      }

      const inner = remaining.slice(0, closeStart);
      const value = inner.trim();
      if (value) extracted.push(value);

      const closeTag = parseTag(remaining, closeStart);
      if (!closeTag) {
        remaining = remaining.slice(closeStart + 1);
        continue;
      }
      remaining = remaining.slice(closeTag.end);
      continue;
    }

    // Close tag without explicit opening: treat prior text as reasoning.
    if (next.index > 0) {
      const value = remaining.slice(0, next.index).trim();
      if (value) extracted.push(value);
    }
    const closeTag = parseTag(remaining, next.index);
    remaining = closeTag ? remaining.slice(closeTag.end) : remaining.slice(next.index + 1);
  }

  return { cleaned: visibleParts.join("").trim(), extracted };
};

export const normalizeReasoningAndContentInMessage = (message: Record<string, unknown>): void => {
  const contentRaw = typeof message["content"] === "string" ? String(message["content"]) : "";
  const reasoningRaw = typeof message["reasoning_content"] === "string" ? String(message["reasoning_content"]) : "";

  const contentThink = extractThinkBlocks(contentRaw);
  const reasoningThink = extractThinkBlocks(reasoningRaw);
  const extracted = [...contentThink.extracted, ...reasoningThink.extracted].filter(Boolean);

  const nextReasoning = [reasoningThink.cleaned, extracted.join("\n")].filter((v) => v.trim().length > 0).join("\n");
  const nextContent = contentThink.cleaned;

  if (nextContent !== contentRaw) message["content"] = nextContent;
  if (nextReasoning !== reasoningRaw) message["reasoning_content"] = nextReasoning;

  // Strip tool-call XML blocks after we have a canonical tool_calls field.
  const strippedContent = stripToolCallXmlBlocks(typeof message["content"] === "string" ? String(message["content"]) : "");
  const strippedReasoning = stripToolCallXmlBlocks(
    typeof message["reasoning_content"] === "string" ? String(message["reasoning_content"]) : "",
  );
  message["content"] = strippedContent;
  if (strippedReasoning) {
    message["reasoning_content"] = strippedReasoning;
  } else {
    delete message["reasoning_content"];
  }
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
  let pendingEventLines: string[] = [];
  let contentBuffer = "";
  let toolCallsFound = false;
  let usageTracked = false;
  let thinkCarry = "";
  let inThink = false;
  let emittedLines = 0;
  const thinkingOpenPrefixes = ["<thinking", "<analysis", "<think"];
  const thinkingClosePrefixes = ["</thinking", "</analysis", "</think"];
  const thinkingAllPrefixes = [...thinkingOpenPrefixes, ...thinkingClosePrefixes];

  const getThinkingTagLength = (suffix: string): { kind: "open" | "close"; length: number } | null => {
    if (!suffix.startsWith("<")) return null;
    const closeIndex = suffix.indexOf(">");
    if (closeIndex < 0) return null;
    const tag = suffix.slice(0, closeIndex + 1);
    if (/^<(think|thinking|analysis)(?:\s+[^>]*)?>$/i.test(tag)) return { kind: "open", length: closeIndex + 1 };
    if (/^<\/(think|thinking|analysis)(?:\s+[^>]*)?>$/i.test(tag)) return { kind: "close", length: closeIndex + 1 };
    return null;
  };

  const thinkingTagPrefixIsPartial = (suffix: string): boolean => {
    const lower = suffix.toLowerCase();
    if (!lower.startsWith("<")) return false;

    for (const prefix of thinkingAllPrefixes) {
      if (prefix.startsWith(lower)) {
        // Suffix is shorter than a known tag prefix and could complete in the next chunk.
        return true;
      }
      if (lower.startsWith(prefix)) {
        // Full prefix exists; ensure the next char could still produce a valid tag (<think>, <think ...>, <think/>).
        const next = lower[prefix.length];
        if (!next) return true;
        if (next === ">" || next === " " || next === "/" || next === "\t" || next === "\n" || next === "\r") return true;
      }
    }

    return false;
  };

  const isThinkingTag = (suffix: string): { kind: "open" | "close"; length: number } | null => {
    const match = getThinkingTagLength(suffix);
    if (!match) return null;
    return match;
  };

  const stripToolXmlDelta = (text: string): string => {
    // Best-effort for streaming: remove tool XML blocks within the current delta chunk.
    // Full-block stripping across chunk boundaries is handled in non-stream responses.
    return text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<?use_mcp[\s_]*tool>[\s\S]*?<\/use_mcp[\s_]*tool>/gi, "");
  };

  const rewriteThinkDelta = (
    deltaText: string,
    defaultToReasoning = false,
  ): { content: string; reasoningAppend: string } => {
    const combined = thinkCarry + (deltaText ?? "");
    const combinedLower = combined.toLowerCase();
    let carryIndex = combined.length;
    let index = 0;
    let contentOut = "";
    let reasoningOut = "";

    while (index < carryIndex) {
      const remainingLower = combinedLower.slice(index);

      if (combined[index] === "<") {
        const thinkTag = isThinkingTag(remainingLower);
        if (thinkTag?.kind === "open") {
          inThink = true;
          index += thinkTag.length;
          continue;
        }
        if (thinkTag?.kind === "close") {
          inThink = false;
          index += thinkTag.length;
          continue;
        }
        if (thinkingTagPrefixIsPartial(remainingLower)) {
          carryIndex = index;
          break;
        }
      }

      const ch = combined[index] ?? "";
      if (inThink || defaultToReasoning) {
        reasoningOut += ch;
      } else {
        contentOut += ch;
      }
      index += 1;
    }

    thinkCarry = carryIndex < combined.length ? combined.slice(carryIndex) : "";

    return {
      content: contentOut,
      reasoningAppend: reasoningOut,
    };
  };

  const enqueueLine = (controller: ReadableStreamDefaultController<Uint8Array>, line: string): void => {
    controller.enqueue(encoder.encode(`${line}\n`));
    emittedLines += 1;
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

  const buildFlushChunk = (payload: { content?: string; reasoning_content?: string }): string | null => {
    const content = payload.content ?? "";
    const reasoning = payload.reasoning_content ?? "";
    if (!content && !reasoning) return null;
    const delta: Record<string, string> = {};
    if (content) delta["content"] = content;
    if (reasoning) delta["reasoning_content"] = reasoning;
    return `data: ${JSON.stringify({ id: `chatcmpl-${randomUUID().slice(0, 8)}`, choices: [{ index: 0, delta }] })}`;
  };

  const flushThinkCarry = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!thinkCarry) return;
    const tail = thinkCarry;
    thinkCarry = "";
    const carryLooksLikeThink = thinkingTagPrefixIsPartial(tail.trim());
    const chunk = inThink || carryLooksLikeThink
      ? buildFlushChunk({ reasoning_content: stripToolXmlDelta(tail) })
      : buildFlushChunk({ content: stripToolXmlDelta(tail) });
    if (chunk) enqueueLine(controller, chunk);
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
    async start(controller): Promise<void> {
      // no-op: keep controller reference for flush on close via pull()
      void controller;
    },
    async pull(controller): Promise<void> {
      const flushEvent = (lines: string[]): void => {
        if (lines.length === 0) return;

        const dataLines: string[] = [];
        const otherLines: string[] = [];
        for (const rawLine of lines) {
          const trimmedStart = rawLine.trimStart();
          if (trimmedStart.startsWith("data:")) {
            dataLines.push(trimmedStart.slice("data:".length).trimStart());
          } else if (rawLine.length > 0) {
            otherLines.push(rawLine);
          }
        }

        if (dataLines.length === 0) {
          for (const outLine of lines) {
            enqueueLine(controller, outLine);
          }
          return;
        }

        const data = dataLines.join("\n").trim();
        if (data === "[DONE]") {
          maybeInjectToolCalls(controller);
          flushThinkCarry(controller);
          for (const outLine of otherLines) {
            enqueueLine(controller, outLine);
          }
          enqueueLine(controller, "data: [DONE]");
          return;
        }

        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
        if (!parsed) {
          // Preserve the upstream event as-is if we can't parse it.
          for (const outLine of lines) {
            enqueueLine(controller, outLine);
          }
          return;
        }

        parseUsage(parsed);
        absorbDeltaContent(parsed);

        // Rewrite deltas to avoid leaking <think> blocks into `content` and strip tool-call XML wrappers.
        const choices = parsed["choices"];
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            const choiceRecord = choice as Record<string, unknown>;
            const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as Record<string, unknown> | undefined;
            if (!delta) continue;
            const content = typeof delta["content"] === "string" ? String(delta["content"]) : "";
            const reasoningRaw =
              typeof delta["reasoning_content"] === "string" ? String(delta["reasoning_content"]) : "";
            let reasoning = "";
            let reasoningFromContent = "";
            if (content) {
              const rewritten = rewriteThinkDelta(content, false);
              const cleanedContent = stripToolXmlDelta(rewritten.content);
              if (cleanedContent) {
                delta["content"] = cleanedContent;
              } else if ("content" in delta) {
                delete delta["content"];
              }
              reasoningFromContent = rewritten.reasoningAppend;
            }

            if (reasoningRaw) {
              const rewrittenReasoning = rewriteThinkDelta(reasoningRaw, true);
              reasoning = rewrittenReasoning.reasoningAppend;
            }

            if (reasoningFromContent) {
              reasoning = `${reasoning}${reasoningFromContent}`;
            }

            if (reasoning) {
              delta["reasoning_content"] = stripToolXmlDelta(reasoning);
            } else if ("reasoning_content" in delta) {
              delete delta["reasoning_content"];
            }
          }
        }

        for (const outLine of otherLines) {
          enqueueLine(controller, outLine);
        }
        enqueueLine(controller, `data: ${JSON.stringify(parsed)}`);
      };

      const emittedBeforePull = emittedLines;

      while (emittedLines === emittedBeforePull) {
        let result: ReaderResult;
        try {
          result = await reader.read();
        } catch {
          controller.close();
          return;
        }
        if (result.done) {
          if (buffer) {
            const trailing = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
            if (trailing.length > 0) {
              pendingEventLines.push(trailing);
            }
            buffer = "";
          }
          if (pendingEventLines.length > 0) {
            flushEvent(pendingEventLines);
            pendingEventLines = [];
          }
          maybeInjectToolCalls(controller);
          flushThinkCarry(controller);
          controller.close();
          return;
        }

        const chunk = result.value ?? new Uint8Array();
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
          if (normalized === "") {
            flushEvent(pendingEventLines);
            pendingEventLines = [];
            enqueueLine(controller, "");
            continue;
          }
          pendingEventLines.push(normalized);
        }
      }
    },
    async cancel(): Promise<void> {
      await reader.cancel();
    },
  });
};
