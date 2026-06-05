const thinkingOpenPrefixes = ["<thinking", "<analysis", "<think"];
const thinkingClosePrefixes = ["</thinking", "</analysis", "</think"];
const thinkingAllPrefixes = [...thinkingOpenPrefixes, ...thinkingClosePrefixes];

export type ThinkRewriter = {
  inThink: () => boolean;
  drainCarry: () => string;
  drainPendingContent: () => string;
  rewrite: (
    deltaText: string,
    defaultToReasoning?: boolean
  ) => { content: string; reasoningAppend: string };
};

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
  } = {}
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
    rewrite(
      deltaText: string,
      defaultToReasoning = false
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
