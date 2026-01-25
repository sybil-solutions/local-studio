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

export class ThinkingParser implements IThinkingParser {
  readonly name = "thinking" as const;

  parse(input: string): ThinkingResult {
    if (!input) {
      return { thinkingContent: null, mainContent: "", isThinkingComplete: true };
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

  canParse(input: string): boolean {
    const lower = input.toLowerCase();
    return OPEN_TAGS.some((t) => lower.includes(t)) || CLOSE_TAGS.some((t) => lower.includes(t));
  }

  /**
   * Strip thinking tags but keep the text content inside
   */
  stripTagsKeepText(input: string): string {
    if (!input) return "";
    return input.replace(/<\/?think(?:ing)?>/gi, "");
  }

  /**
   * Extract all thinking blocks from content
   * Returns array of blocks with content and completion status
   */
  extractAllBlocks(input: string): Array<{ content: string; isComplete: boolean }> {
    if (!input) return [];

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
