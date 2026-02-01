// CRITICAL
/**
 * Thinking Parser
 * Extracts <think>/<thinking> content from messages
 * Separates reasoning from visible content
 */

import type { IThinkingParser, ThinkingResult } from "../types";
import { boxTagsParser } from "./box-tags.parser";

const OPEN_TAGS = ["<think>", "<thinking>"];
const CLOSE_TAGS = ["</think>", "</thinking>"];

const HARMONY_ANALYSIS_RE =
  /<\|channel\|>\s*analysis\s*(?:<\|message\|>)?([\s\S]*?)(?=<\|end\|>|<\|return\|>|<\|channel\|>|$)/gi;
const HARMONY_FINAL_RE =
  /<\|channel\|>\s*final\s*(?:<\|message\|>)?([\s\S]*?)(?=<\|end\|>|<\|return\|>|$)/gi;
const HARMONY_FINAL_TAG_RE = /<\|channel\|>\s*final\s*<\|message\|>/i;
const HARMONY_FINAL_COMPLETE_RE =
  /<\|channel\|>\s*final\s*<\|message\|>[\s\S]*?(<\|end\|>|<\|return\|>)/i;

const extractHarmonyBlocks = (input: string, pattern: RegExp): string[] => {
  const blocks: string[] = [];
  pattern.lastIndex = 0;
  for (const match of input.matchAll(pattern)) {
    const block = match[1];
    if (block != null && block.length > 0) {
      blocks.push(block);
    }
  }
  pattern.lastIndex = 0;
  return blocks;
};

export class ThinkingParser implements IThinkingParser {
  readonly name = "thinking" as const;

  parse(input: string): ThinkingResult {
    if (!input) {
      return { thinkingContent: null, mainContent: "", isThinkingComplete: true };
    }

    if (input.includes("<|channel|>")) {
      const analysisBlocks = extractHarmonyBlocks(input, HARMONY_ANALYSIS_RE);
      const finalBlocks = extractHarmonyBlocks(input, HARMONY_FINAL_RE);
      const hasHarmony = analysisBlocks.length > 0 || finalBlocks.length > 0 || HARMONY_FINAL_TAG_RE.test(input);

      if (hasHarmony) {
        const thinkingText = boxTagsParser.parse(analysisBlocks.join("\n")).trim();
        const finalText = boxTagsParser.parse(finalBlocks.join("\n")).trim();
        const hasFinalTag = HARMONY_FINAL_TAG_RE.test(input);
        const lower = input.toLowerCase();
        const lastChannelIdx = lower.lastIndexOf("<|channel|>");
        const lastChannelIsFinal =
          lastChannelIdx >= 0 &&
          /<\|channel\|>\s*final\b/.test(lower.slice(lastChannelIdx, lastChannelIdx + 80));
        const isComplete =
          HARMONY_FINAL_COMPLETE_RE.test(input) ||
          (hasFinalTag && finalText.length > 0 && lastChannelIsFinal);

        return {
          thinkingContent: thinkingText || null,
          mainContent: finalText,
          isThinkingComplete: isComplete,
        };
      }
    }

    const reasoningParts: string[] = [];
    const visibleParts: string[] = [];
    let remaining = input;
    let isComplete = true;

    while (remaining) {
      const lower = remaining.toLowerCase();

      const openIdxs = OPEN_TAGS.map((t) => lower.indexOf(t)).filter((i) => i !== -1);
      const closeIdxs = CLOSE_TAGS.map((t) => lower.indexOf(t)).filter((i) => i !== -1);

      const openIdx = openIdxs.length ? Math.min(...openIdxs) : -1;
      const closeIdx = closeIdxs.length ? Math.min(...closeIdxs) : -1;

      if (openIdx === -1 && closeIdx === -1) {
        visibleParts.push(remaining);
        break;
      }

      const isOpenNext = openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx);

      if (isOpenNext) {
        if (openIdx > 0) {
          visibleParts.push(remaining.slice(0, openIdx));
        }

        const matchedOpen = OPEN_TAGS.find((t) => lower.startsWith(t, openIdx))!;
        remaining = remaining.slice(openIdx + matchedOpen.length);

        const lowerAfter = remaining.toLowerCase();
        const closeIdxAfter = CLOSE_TAGS.map((t) => lowerAfter.indexOf(t)).filter((i) => i !== -1);
        const closePos = closeIdxAfter.length ? Math.min(...closeIdxAfter) : -1;

        if (closePos === -1) {
          reasoningParts.push(remaining);
          remaining = "";
          isComplete = false;
          break;
        }

        reasoningParts.push(remaining.slice(0, closePos));
        const matchedClose = CLOSE_TAGS.find((t) => lowerAfter.startsWith(t, closePos))!;
        remaining = remaining.slice(closePos + matchedClose.length);
        continue;
      }

      // Closing tag without explicit opening (prompt may include opening tag)
      if (closeIdx > 0) {
        reasoningParts.push(remaining.slice(0, closeIdx));
      }
      const matchedClose = CLOSE_TAGS.find((t) => lower.startsWith(t, closeIdx))!;
      remaining = remaining.slice(closeIdx + matchedClose.length);
    }

    const thinkingText = boxTagsParser.parse(reasoningParts.join("")).trim();
    const visibleText = boxTagsParser.parse(visibleParts.join(""));

    return {
      thinkingContent: thinkingText || null,
      mainContent: visibleText,
      isThinkingComplete: isComplete,
    };
  }

  /**
   * Extract all thinking blocks from content
   * Returns array of blocks with content and completion status
   */
  extractAllBlocks(input: string): Array<{ content: string; isComplete: boolean }> {
    if (!input) return [];

    if (input.includes("<|channel|>")) {
      const analysisBlocks = extractHarmonyBlocks(input, HARMONY_ANALYSIS_RE);
      if (analysisBlocks.length > 0) {
        const hasFinalTag = HARMONY_FINAL_TAG_RE.test(input);
        const lower = input.toLowerCase();
        const lastChannelIdx = lower.lastIndexOf("<|channel|>");
        const lastChannelIsFinal =
          lastChannelIdx >= 0 &&
          /<\|channel\|>\s*final\b/.test(lower.slice(lastChannelIdx, lastChannelIdx + 80));
        const isComplete =
          HARMONY_FINAL_COMPLETE_RE.test(input) || (hasFinalTag && lastChannelIsFinal);
        return analysisBlocks
          .map((content) => boxTagsParser.parse(content).trim())
          .filter((content) => content.length > 0)
          .map((content) => ({ content, isComplete }));
      }
    }

    const blocks: Array<{ content: string; isComplete: boolean }> = [];
    let remaining = input;

    while (remaining) {
      const lower = remaining.toLowerCase();
      const openIdxs = OPEN_TAGS.map((t) => lower.indexOf(t)).filter((i) => i !== -1);
      if (!openIdxs.length) break;

      const openIdx = Math.min(...openIdxs);
      const matchedOpen = OPEN_TAGS.find((t) => lower.startsWith(t, openIdx))!;
      const afterOpen = remaining.slice(openIdx + matchedOpen.length);
      const lowerAfter = afterOpen.toLowerCase();
      const closeIdxs = CLOSE_TAGS.map((t) => lowerAfter.indexOf(t)).filter((i) => i !== -1);

      if (!closeIdxs.length) {
        const content = boxTagsParser.parse(afterOpen).trim();
        if (content) blocks.push({ content, isComplete: false });
        break;
      }

      const closeIdx = Math.min(...closeIdxs);
      const matchedClose = CLOSE_TAGS.find((t) => lowerAfter.startsWith(t, closeIdx))!;
      const content = boxTagsParser.parse(afterOpen.slice(0, closeIdx)).trim();
      if (content) blocks.push({ content, isComplete: true });
      remaining = afterOpen.slice(closeIdx + matchedClose.length);
    }

    return blocks;
  }
}

export const thinkingParser = new ThinkingParser();
