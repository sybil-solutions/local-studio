import { randomUUID } from "node:crypto";
import { parseToolCallsFromContent, type ToolCall } from "./tool-call-parser";
import { REASONING_FIELDS, firstReasoningField } from "./reasoning-fields";
import { createThinkRewriter, thinkingTagPrefixIsPartial } from "./think-rewriter";

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
}

export interface ToolCallStreamOptions {
  bufferImplicitReasoningContent?: boolean;
}

export const createToolCallStream = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onUsage?: (usage: StreamUsage) => void,
  onFirstToken?: () => void,
  options: ToolCallStreamOptions = {}
): ReadableStream<Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let pendingEventLines: string[] = [];
  let visibleContentBuffer = "";
  let toolCallsFound = false;
  let usageTracked = false;
  let emittedLines = 0;
  let downstreamClosed = false;
  let firstTokenTracked = false;
  const contentHistory = new Map<string, { text: string; snapshot: boolean }>();
  const reasoningHistory = new Map<string, { text: string; snapshot: boolean }>();
  const replayCursors = new Map<string, number>();
  const tearDownUpstream = async (): Promise<void> => {
    try {
      await reader.cancel();
    } catch {
      // upstream already torn down; ignore.
    }
  };
  const stripToolXmlDelta = (text: string): string => {
    return text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<?use_mcp[\s_]*tool>[\s\S]*?<\/use_mcp[\s_]*tool>/gi, "");
  };

  const normalizeTextDelta = (
    history: Map<string, { text: string; snapshot: boolean }>,
    key: string,
    text: string,
    forceSnapshot = false
  ): string => {
    if (!text) return text;
    const previous = history.get(key) ?? { text: "", snapshot: forceSnapshot };
    const replayCursor = replayCursors.get(key);
    if (replayCursor !== undefined) {
      const expected = previous.text.slice(replayCursor, replayCursor + text.length);
      if (expected === text) {
        const nextCursor = replayCursor + text.length;
        if (nextCursor >= previous.text.length) replayCursors.delete(key);
        else replayCursors.set(key, nextCursor);
        return "";
      }
      replayCursors.delete(key);
    }
    const isCumulative =
      previous.text.length > 0 &&
      text.length >= previous.text.length &&
      text.startsWith(previous.text);
    const shouldSlice = forceSnapshot || previous.snapshot || isCumulative;

    if (shouldSlice) {
      history.set(key, { text, snapshot: true });
      return isCumulative ? text.slice(previous.text.length) : text;
    }

    if (previous.text.length > text.length && previous.text.startsWith(text)) {
      replayCursors.set(key, text.length);
      return "";
    }

    history.set(key, { text: previous.text + text, snapshot: false });
    return text;
  };

  const contentThink = createThinkRewriter({
    bufferImplicitReasoningContent: Boolean(options.bufferImplicitReasoningContent),
  });
  const reasoningThink = createThinkRewriter();

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
  // Terminate each synthesized `data:` line with a blank line so the SSE parser
  // dispatches it as its own event; without it, an injected chunk followed by
  // `data: [DONE]` concatenates to `{...}\n[DONE]` and fails JSON.parse.
  const enqueueDataEvent = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    dataLine: string
  ): void => {
    enqueueLine(controller, dataLine);
    enqueueLine(controller, "");
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

  const emitVisibleContent = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    content: string
  ): void => {
    if (!content) return;
    visibleContentBuffer += content;
    const cleaned = stripToolXmlDelta(content);
    const chunk = buildFlushChunk({ content: cleaned });
    if (chunk) enqueueDataEvent(controller, chunk);
  };

  const flushThinkCarry = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    emitVisibleContent(controller, contentThink.drainPendingContent());
    const tail = contentThink.drainCarry();
    if (!tail) return;
    const carryLooksLikeThink = thinkingTagPrefixIsPartial(tail.trim());
    const chunk =
      contentThink.inThink() || carryLooksLikeThink
        ? buildFlushChunk({ reasoning_content: stripToolXmlDelta(tail) })
        : buildFlushChunk({ content: stripToolXmlDelta(tail) });
    if (chunk) enqueueDataEvent(controller, chunk);
  };

  const parseUsage = (data: Record<string, unknown>): void => {
    if (usageTracked || !onUsage) return;
    const usage = data["usage"] as Record<string, number> | undefined;
    if (usage && (usage["prompt_tokens"] || usage["completion_tokens"])) {
      onUsage({
        prompt_tokens: usage["prompt_tokens"] ?? 0,
        completion_tokens: usage["completion_tokens"] ?? 0,
        reasoning_tokens:
          (usage["reasoning_tokens"] as number | undefined) ??
          (usage["completion_tokens_details"] as Record<string, number> | undefined)?.[
            "reasoning_tokens"
          ] ??
          0,
        cache_read_tokens:
          (usage["prompt_tokens_details"] as Record<string, number> | undefined)?.[
            "cached_tokens"
          ] ?? 0,
        cache_write_tokens: 0,
      });
      usageTracked = true;
    }
  };

  const trackFirstToken = (): void => {
    if (firstTokenTracked) return;
    firstTokenTracked = true;
    onFirstToken?.();
  };

  const maybeInjectToolCalls = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (toolCallsFound || !visibleContentBuffer) return;
    const parsed = parseToolCallsFromContent(visibleContentBuffer);
    if (parsed.length > 0) {
      enqueueDataEvent(controller, buildToolCallChunk(parsed));
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
          flushThinkCarry(controller);
          maybeInjectToolCalls(controller);
          for (const outLine of otherLines) {
            enqueueLine(controller, outLine);
          }
          enqueueDataEvent(controller, "data: [DONE]");
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
        const choices = parsed["choices"];
        if (Array.isArray(choices)) {
          for (const [choiceIndex, choice] of choices.entries()) {
            const choiceRecord = choice as Record<string, unknown>;
            const hasDelta = choiceRecord["delta"] && typeof choiceRecord["delta"] === "object";
            const delta = (hasDelta ? choiceRecord["delta"] : choiceRecord["message"]) as
              | Record<string, unknown>
              | undefined;
            if (!delta) continue;
            const toolCalls = delta["tool_calls"];
            const hasActiveToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
            if (hasActiveToolCalls) {
              toolCallsFound = true;
              trackFirstToken();
            }
            const rawContent = typeof delta["content"] === "string" ? String(delta["content"]) : "";
            const content = normalizeTextDelta(
              contentHistory,
              `${choiceIndex}:content`,
              rawContent,
              !hasDelta
            );
            const rawReasoning = firstReasoningField(delta);
            const reasoningRaw = rawReasoning
              ? normalizeTextDelta(
                  reasoningHistory,
                  `${choiceIndex}:reasoning`,
                  rawReasoning,
                  !hasDelta
                )
              : "";
            if (content || reasoningRaw) trackFirstToken();
            let reasoning = "";
            let reasoningFromContent = "";
            if (content) {
              const rewritten = contentThink.rewrite(content, false);
              if (rewritten.content) {
                visibleContentBuffer += rewritten.content;
              }
              const cleanedContent = stripToolXmlDelta(rewritten.content);
              if (cleanedContent) {
                delta["content"] = cleanedContent;
              } else if ("content" in delta) {
                delete delta["content"];
              }
              reasoningFromContent = rewritten.reasoningAppend;
            } else if (rawContent && "content" in delta) {
              delete delta["content"];
            }

            if (reasoningRaw) {
              const rewrittenReasoning = reasoningThink.rewrite(reasoningRaw, true);
              reasoning = `${reasoning}${rewrittenReasoning.reasoningAppend}`;
            }

            if (reasoningFromContent) {
              reasoning = `${reasoning}${reasoningFromContent}`;
            }

            if (reasoning) {
              delta["reasoning_content"] = stripToolXmlDelta(reasoning);
            } else if (REASONING_FIELDS.some((field) => field in delta)) {
              delete delta["reasoning_content"];
            }
            delete delta["reasoning"];
            delete delta["reasoning_text"];
          }
        }

        for (const outLine of otherLines) {
          enqueueLine(controller, outLine);
        }
        enqueueDataEvent(controller, `data: ${JSON.stringify(parsed)}`);
      };

      if (downstreamClosed) {
        try {
          controller.close();
        } catch {}
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
            } catch {}
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
            flushThinkCarry(controller);
            maybeInjectToolCalls(controller);
            try {
              controller.close();
            } catch {}
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
        } catch {}
      }
    },
    async cancel(): Promise<void> {
      downstreamClosed = true;
      await tearDownUpstream();
    },
  });
};
