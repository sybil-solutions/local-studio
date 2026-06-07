import { parseToolCallsFromContent, stripToolCallsFromContent } from "./tool-call-parser";
import { firstReasoningField } from "./reasoning-fields";

const stripToolCallXmlBlocks = (text: string): string => {
  if (!text) return "";
  let cleaned = stripToolCallsFromContent(text);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
};

const collapseRepeatedVisibleContent = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length < 80) return text;
  for (let separatorLength = 0; separatorLength <= 4; separatorLength += 1) {
    const contentLength = trimmed.length - separatorLength;
    if (contentLength <= 0 || contentLength % 2 !== 0) continue;
    const midpoint = contentLength / 2;
    const first = trimmed.slice(0, midpoint).trimEnd();
    const second = trimmed.slice(midpoint + separatorLength).trimStart();
    if (first.length >= 40 && first === second) return first;
  }
  return text;
};

const extractThinkBlocks = (text: string): { cleaned: string; extracted: string[] } => {
  if (!text) return { cleaned: "", extracted: [] };

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
    if (openIndex !== -1 && (closeIndex === -1 || openIndex < closeIndex))
      return { kind: "open", index: openIndex };
    return { kind: "close", index: closeIndex };
  };

  const parseTag = (
    input: string,
    start: number
  ): { name: "think" | "thinking" | "analysis"; end: number } | null => {
    const closeIndex = input.indexOf(">", start);
    if (closeIndex < 0) return null;
    const tag = input.slice(start, closeIndex + 1);
    const open = tag.match(/^<(think|thinking|analysis)(?:\s+[^>]*)?>$/i);
    if (open)
      return {
        name: open[1]!.toLowerCase() as "think" | "thinking" | "analysis",
        end: closeIndex + 1,
      };
    const close = tag.match(/^<\/(think|thinking|analysis)(?:\s+[^>]*)?>$/i);
    if (close)
      return {
        name: close[1]!.toLowerCase() as "think" | "thinking" | "analysis",
        end: closeIndex + 1,
      };
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
  const reasoningRaw = firstReasoningField(message);

  const contentThink = extractThinkBlocks(contentRaw);
  const reasoningThink = extractThinkBlocks(reasoningRaw);
  const extracted = [...contentThink.extracted, ...reasoningThink.extracted].filter(Boolean);

  const nextReasoning = [reasoningThink.cleaned, extracted.join("\n")]
    .filter((v) => v.trim().length > 0)
    .join("\n");
  const nextContent = contentThink.cleaned;

  if (nextContent !== contentRaw) message["content"] = nextContent;
  if (message["reasoning_content"] !== nextReasoning) message["reasoning_content"] = nextReasoning;

  const strippedContent = stripToolCallXmlBlocks(
    typeof message["content"] === "string" ? String(message["content"]) : ""
  );
  const strippedReasoning = stripToolCallXmlBlocks(
    typeof message["reasoning_content"] === "string" ? String(message["reasoning_content"]) : ""
  );
  message["content"] = collapseRepeatedVisibleContent(strippedContent);
  if (strippedReasoning) {
    message["reasoning_content"] = strippedReasoning;
  } else {
    delete message["reasoning_content"];
  }
  delete message["reasoning"];
  delete message["reasoning_text"];
};

export const normalizeToolCallsInMessage = (message: Record<string, unknown>): boolean => {
  const existing = message["tool_calls"];
  const hasToolCalls = Array.isArray(existing) && existing.length > 0;
  if (hasToolCalls) {
    return false;
  }
  const content = typeof message["content"] === "string" ? String(message["content"]) : "";
  const parsed = parseToolCallsFromContent(content);
  if (parsed.length > 0) {
    message["tool_calls"] = parsed;
    return true;
  }
  return false;
};
