import { randomUUID } from "node:crypto";
import { createToolCallId, parseToolCallsFromContent, type ToolCall } from "./tool-call-parser";

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export const createToolCallStream = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onUsage?: (usage: StreamUsage) => void
): ReadableStream<Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let pendingEventLines: string[] = [];
  let visibleContentBuffer = "";
  let toolCallsFound = false;
  let usageTracked = false;
  let thinkCarry = "";
  let inThink = false;
  let emittedLines = 0;
  let downstreamClosed = false;
  const tearDownUpstream = async (): Promise<void> => {
    try {
      await reader.cancel();
    } catch {
      // upstream already torn down; ignore.
    }
  };
  const thinkingOpenPrefixes = ["<thinking", "<analysis", "<think"];
  const thinkingClosePrefixes = ["</thinking", "</analysis", "</think"];
  const thinkingAllPrefixes = [...thinkingOpenPrefixes, ...thinkingClosePrefixes];

  const getThinkingTagLength = (
    suffix: string
  ): { kind: "open" | "close"; length: number } | null => {
    if (!suffix.startsWith("<")) return null;
    const closeIndex = suffix.indexOf(">");
    if (closeIndex < 0) return null;
    const tag = suffix.slice(0, closeIndex + 1);
    if (/^<(think|thinking|analysis)(?:\s+[^>]*)?>$/i.test(tag))
      return { kind: "open", length: closeIndex + 1 };
    if (/^<\/(think|thinking|analysis)(?:\s+[^>]*)?>$/i.test(tag))
      return { kind: "close", length: closeIndex + 1 };
    return null;
  };

  const thinkingTagPrefixIsPartial = (suffix: string): boolean => {
    const lower = suffix.toLowerCase();
    if (!lower.startsWith("<")) return false;

    for (const prefix of thinkingAllPrefixes) {
      if (prefix.startsWith(lower)) {
        return true;
      }
      if (lower.startsWith(prefix)) {
        const next = lower[prefix.length];
        if (!next) return true;
        if (
          next === ">" ||
          next === " " ||
          next === "/" ||
          next === "\t" ||
          next === "\n" ||
          next === "\r"
        )
          return true;
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
    return text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<?use_mcp[\s_]*tool>[\s\S]*?<\/use_mcp[\s_]*tool>/gi, "");
  };

  const rewriteThinkDelta = (
    deltaText: string,
    defaultToReasoning = false
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
          if (!inThink) {
            const before = contentOut.trim();
            if (before) {
              reasoningOut += contentOut;
              contentOut = "";
            }
          }
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

  const enqueueLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    line: string
  ): void => {
    if (downstreamClosed) return;
    try {
      controller.enqueue(encoder.encode(`${line}\n`));
      emittedLines += 1;
    } catch {
      downstreamClosed = true;
      void tearDownUpstream();
    }
  };

  const buildToolCallChunk = (toolCalls: ToolCall[]): string => {
    const payload = {
      id: `chatcmpl-${randomUUID().slice(0, 8)}`,
      choices: [
        {
          index: 0,
          delta: { tool_calls: toolCalls },
          finish_reason: "tool_calls",
        },
      ],
    };
    return `data: ${JSON.stringify(payload)}`;
  };

  const buildFlushChunk = (payload: {
    content?: string;
    reasoning_content?: string;
  }): string | null => {
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
    const chunk =
      inThink || carryLooksLikeThink
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
      const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as
        | Record<string, unknown>
        | undefined;
      if (!delta) continue;
      const toolCalls = delta["tool_calls"];
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        toolCallsFound = true;
      }
      const content = typeof delta["content"] === "string" ? String(delta["content"]) : "";
      const reasoning =
        typeof delta["reasoning_content"] === "string" ? String(delta["reasoning_content"]) : "";
      if (content) {
        visibleContentBuffer += content;
      }
      void reasoning;
    }
  };

  const maybeInjectToolCalls = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (toolCallsFound || !visibleContentBuffer) return;
    const parsed = parseToolCallsFromContent(visibleContentBuffer);
    if (parsed.length > 0) {
      enqueueLine(controller, buildToolCallChunk(parsed));
      toolCallsFound = true;
    }
  };

  type ReaderResult = { done: boolean; value?: Uint8Array | undefined };

  return new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
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
          for (const outLine of lines) {
            enqueueLine(controller, outLine);
          }
          return;
        }

        parseUsage(parsed);
        absorbDeltaContent(parsed);

        const choices = parsed["choices"];
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            const choiceRecord = choice as Record<string, unknown>;
            const delta = (choiceRecord["delta"] ?? choiceRecord["message"]) as
              | Record<string, unknown>
              | undefined;
            if (!delta) continue;
            const content = typeof delta["content"] === "string" ? String(delta["content"]) : "";
            const reasoningRaw =
              typeof delta["reasoning_content"] === "string"
                ? String(delta["reasoning_content"])
                : "";
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

      if (downstreamClosed) {
        try {
          controller.close();
        } catch {
          // already closed
        }
        await tearDownUpstream();
        return;
      }

      const emittedBeforePull = emittedLines;

      try {
        while (!downstreamClosed && emittedLines === emittedBeforePull) {
          let result: ReaderResult;
          try {
            result = await reader.read();
          } catch {
            downstreamClosed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
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
            try {
              controller.close();
            } catch {
              // already closed
            }
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
      } catch {
        downstreamClosed = true;
        await tearDownUpstream();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    async cancel(): Promise<void> {
      downstreamClosed = true;
      await tearDownUpstream();
    },
  });
};
