import { parseToolCallsFromContent, stripToolCallsFromContent } from "./tool-call-parser";

// Reasoning text can arrive under different keys depending on the upstream
// OpenAI-compatible server: vLLM/SGLang emit `reasoning_content`, while some
// endpoints use `reasoning` or `reasoning_text`. This mirrors how the pi SDK
// resolves reasoning (see @earendil-works/pi-ai openai-completions): take the
// first non-empty field so the same text is never counted twice.
export const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

/** Return the first non-empty reasoning field on a delta/message record. */
export const firstReasoningField = (record: Record<string, unknown>): string => {
  for (const field of REASONING_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
};

const thinkingOpenPrefixes = ["<thinking", "<analysis", "<think"];
const thinkingClosePrefixes = ["</thinking", "</analysis", "</think"];
const thinkingAllPrefixes = [...thinkingOpenPrefixes, ...thinkingClosePrefixes];

export type ThinkRewriter = {
  inThink: () => boolean;
  drainCarry: () => string;
  drainPendingContent: () => string;
  resolveImplicitPrefixAsContent: () => string;
  rewrite: (
    deltaText: string,
    defaultToReasoning?: boolean,
  ) => { content: string; reasoningAppend: string };
};

const getThinkingTagLength = (
  suffix: string,
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

export const thinkingTagPrefixIsPartial = (suffix: string): boolean => {
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

export const createThinkRewriter = (
  settings: {
    bufferImplicitReasoningContent?: boolean;
  } = {},
): ThinkRewriter => {
  let inThink = false;
  let thinkCarry = "";
  let pendingImplicitContent = "";
  let seenOpen = false;
  let resolvedImplicitPrefix = false;

  return {
    inThink(): boolean {
      return inThink;
    },
    drainCarry(): string {
      const tail = thinkCarry;
      thinkCarry = "";
      return tail;
    },
    drainPendingContent(): string {
      const pending = pendingImplicitContent;
      pendingImplicitContent = "";
      return pending;
    },
    resolveImplicitPrefixAsContent(): string {
      resolvedImplicitPrefix = true;
      const pending = pendingImplicitContent;
      pendingImplicitContent = "";
      return pending;
    },
    rewrite(
      deltaText: string,
      defaultToReasoning = false,
    ): { content: string; reasoningAppend: string } {
      const combined = thinkCarry + (deltaText ?? "");
      const combinedLower = combined.toLowerCase();
      let carryIndex = combined.length;
      let index = 0;
      let contentOut = "";
      let reasoningOut = "";

      while (index < carryIndex) {
        const remainingLower = combinedLower.slice(index);

        if (combined[index] === "<") {
          const thinkTag = getThinkingTagLength(remainingLower);
          if (thinkTag?.kind === "open") {
            if (pendingImplicitContent) {
              contentOut += pendingImplicitContent;
              pendingImplicitContent = "";
            }
            inThink = true;
            seenOpen = true;
            index += thinkTag.length;
            continue;
          }
          if (thinkTag?.kind === "close") {
            if (!inThink) {
              // Close tag without an opening tag: model uses implicit
              // thinking (e.g. DeepSeek sends `...` with no `...`).
              if (settings.bufferImplicitReasoningContent && !seenOpen && !resolvedImplicitPrefix) {
                reasoningOut += pendingImplicitContent;
                pendingImplicitContent = "";
                resolvedImplicitPrefix = true;
              }
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
        } else if (
          settings.bufferImplicitReasoningContent &&
          !seenOpen &&
          !resolvedImplicitPrefix
        ) {
          pendingImplicitContent += ch;
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
    },
  };
};

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

const extractThinkBlocks = (text: string): { cleaned: string; extracted: string } => {
  if (!text) return { cleaned: "", extracted: "" };

  const rewriter = createThinkRewriter();
  const { content, reasoningAppend } = rewriter.rewrite(String(text));
  const carry = rewriter.drainCarry();
  const cleaned = rewriter.inThink() ? content : content + carry;
  const extracted = rewriter.inThink() ? reasoningAppend + carry : reasoningAppend;

  return { cleaned: cleaned.trim(), extracted: extracted.trim() };
};

export const normalizeReasoningAndContentInMessage = (message: Record<string, unknown>): void => {
  // Only a string content carries inline <think> blocks or is safe to rewrite.
  // A multi-part array content (e.g. text + image_url) must be left untouched —
  // coercing it to "" here would silently drop the whole message body.
  const contentIsString = typeof message["content"] === "string";
  const contentRaw = contentIsString ? String(message["content"]) : "";
  const reasoningRaw = firstReasoningField(message);

  const contentThink = extractThinkBlocks(contentRaw);
  const reasoningThink = extractThinkBlocks(reasoningRaw);

  // Dedup identical segments: when a model emits its reasoning BOTH inline in
  // content (<think>…</think>) and in the dedicated reasoning field, the
  // content-extracted and reasoning-field text are the same string — joining
  // them verbatim doubled the reasoning.
  const nextReasoning = [
    reasoningThink.cleaned,
    contentThink.extracted,
    reasoningThink.extracted,
  ]
    .map((v) => v.trim())
    .filter((v, index, all) => v.length > 0 && all.indexOf(v) === index)
    .join("\n");
  const nextContent = contentThink.cleaned;

  if (contentIsString && nextContent !== contentRaw) message["content"] = nextContent;
  if (message["reasoning_content"] !== nextReasoning) message["reasoning_content"] = nextReasoning;

  if (contentIsString) {
    const strippedContent = stripToolCallXmlBlocks(String(message["content"] ?? ""));
    message["content"] = collapseRepeatedVisibleContent(strippedContent);
  }
  const strippedReasoning = stripToolCallXmlBlocks(
    typeof message["reasoning_content"] === "string" ? String(message["reasoning_content"]) : "",
  );
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

/**
 * Per-model quirks for reasoning/thinking content. The extractors above
 * handle the universal
 * `<think>`/tool-call-XML shapes; these two are narrow, model-specific
 * workarounds).
 */

/**
 * Trinity's "thinking" variant sometimes returns a response with empty
 * visible `content` but a populated `reasoning`/`reasoning_content` field —
 * callers that only render `content` would see a blank message. Promote the
 * reasoning text into `content` so it's visible, while still keeping it in
 * `reasoning_content` for callers that distinguish the two.
 */
export const exposeReasoningAsContentWhenEmpty = (
  message: Record<string, unknown>,
  model: string,
): boolean => {
  const modelLower = model.toLowerCase();
  if (!modelLower.includes("trinity-large-thinking")) return false;

  const content = typeof message["content"] === "string" ? message["content"].trim() : "";
  if (content) return false;

  const reasoning =
    typeof message["reasoning"] === "string"
      ? message["reasoning"].trim()
      : typeof message["reasoning_content"] === "string"
        ? message["reasoning_content"].trim()
        : "";
  if (!reasoning) return false;

  message["content"] = reasoning;
  if (!message["reasoning_content"]) {
    message["reasoning_content"] = reasoning;
  }
  return true;
};

export const shouldBufferImplicitReasoningContent = (
  model: string,
  reasoningParser: string | null | undefined,
): boolean => {
  const parser = (reasoningParser ?? "").toLowerCase();
  const modelLower = model.toLowerCase();
  return (
    parser === "deepseek_r1" ||
    parser === "minimax_m2_append_think" ||
    modelLower.includes("deepseek") ||
    modelLower.includes("r1") ||
    modelLower.includes("reasoning") ||
    modelLower.includes("thinking")
  );
};
