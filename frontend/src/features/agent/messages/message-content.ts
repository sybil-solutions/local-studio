import type { TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import { newId } from "@/features/agent/messages/helpers";
import type { AssistantBlock, TextBlock } from "@/features/agent/messages/types";

const isRecordArray = (value: unknown): value is Array<Record<string, unknown>> =>
  Array.isArray(value);

const toolArgs = (part: { arguments?: unknown }): Record<string, unknown> | undefined => {
  if (part.arguments && typeof part.arguments === "object" && !Array.isArray(part.arguments)) {
    return part.arguments as Record<string, unknown>;
  }
  if (typeof part.arguments !== "string" || !part.arguments.trim()) return undefined;
  try {
    const parsed = JSON.parse(part.arguments) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

export function blockFromContentPart(
  part: Record<string, unknown>,
  options: { textAsThinking?: boolean } = {},
): AssistantBlock[] {
  if (part.type === "text") {
    const reasoningText = typeof part.reasoning_content === "string" ? part.reasoning_content : "";
    const text = typeof part.text === "string" ? part.text : "";
    if (options.textAsThinking) {
      const combined = [reasoningText, text].filter(Boolean).join("\n");
      return combined ? [{ kind: "thinking", id: newId("thinking"), text: combined }] : [];
    }
    return [
      ...(reasoningText
        ? [{ kind: "thinking" as const, id: newId("thinking"), text: reasoningText }]
        : []),
      ...(text ? [{ kind: "text" as const, id: newId("text"), text }] : []),
    ];
  }
  if (part.type === "thinking" && typeof part.thinking === "string") {
    return [{ kind: "thinking", id: newId("thinking"), text: part.thinking }];
  }
  if (part.type === "reasoning") {
    const text = [part.reasoning, part.thinking, part.text].find(
      (value): value is string => typeof value === "string",
    );
    return text ? [{ kind: "thinking", id: newId("thinking"), text }] : [];
  }
  if (part.type !== "toolCall") return [];

  const args = toolArgs(part);
  const argsText = args
    ? JSON.stringify(args, null, 2)
    : typeof part.arguments === "string" && part.arguments.trim()
      ? part.arguments
      : "{}";
  return [
    {
      kind: "tool",
      id: typeof part.id === "string" ? part.id : newId("tool"),
      name: typeof part.name === "string" ? part.name : "tool",
      status: "running",
      argsText,
      args,
      text: argsText,
    },
  ];
}

export function blocksFromMessageContent(
  content: string | Array<Record<string, unknown>> | undefined,
  options: { stopReason?: string; errorMessage?: string } = {},
): AssistantBlock[] {
  const errorBlock = assistantErrorBlock(options.errorMessage);
  if (typeof content === "string") {
    const blocks: AssistantBlock[] = content
      ? [{ kind: "text", id: newId("text"), text: content }]
      : [];
    return errorBlock ? [...blocks, errorBlock] : blocks;
  }
  if (!isRecordArray(content)) return errorBlock ? [errorBlock] : [];
  const firstToolCallIndex = content.findIndex((part) => part.type === "toolCall");
  const textBeforeToolIsThinking = options.stopReason === "toolUse" && firstToolCallIndex > -1;
  const blocks = content.flatMap((part, index) =>
    blockFromContentPart(part, {
      textAsThinking: textBeforeToolIsThinking && index < firstToolCallIndex,
    }),
  );
  const ordered = firstToolCallIndex > -1 ? blocks : reasoningBeforeText(blocks);
  // Coalesce adjacent same-kind text/thinking exactly like the live snapshot
  // path (blocksFromTurnSnapshots) does. A settled message can carry two
  // adjacent {type:"text"} parts whose boundary falls mid-content (mid-table,
  // mid-code-fence); without this merge the replay/reload path builds one block
  // per part and the GFM parser sees two raw fragments, so a table that rendered
  // correctly live mangles after navigate-away/crash-recovery. The error block
  // is not text-like, so it is never merged into prose.
  return mergeAdjacentTextLike(errorBlock ? [...ordered, errorBlock] : ordered);
}

function assistantErrorBlock(message: string | undefined): AssistantBlock | null {
  const text = message?.trim();
  return text ? { kind: "event", id: newId("error"), text } : null;
}

function reasoningBeforeText(blocks: AssistantBlock[]): AssistantBlock[] {
  const thinking = blocks.filter((block) => block.kind === "thinking");
  const text = blocks.filter((block) => block.kind === "text");
  const other = blocks.filter((block) => block.kind !== "thinking" && block.kind !== "text");
  return [...thinking, ...text, ...other];
}

export const messageTextFromBlocks = (blocks: AssistantBlock[]): string =>
  blocks
    .filter((block): block is TextBlock => block.kind === "text")
    .map((block) => block.text)
    .join("\n");

// ---------------------------------------------------------------------------
// Snapshot-driven streaming render
//
// Pi emits a turn as MULTIPLE assistant messages (one per LLM call) that we
// merge into one bubble. Every `message_update` carries the full accumulated
// content of the *current* call (event.message.content). We accumulate one
// content snapshot per call and rebuild blocks from those snapshots each frame
// — never from raw token deltas. Block ids are derived deterministically from
// (callOrdinal, contentIndex, kind) so React keys stay stable across frames and
// nothing remounts/flickers mid-stream.
//
// Grouping contract (what the user expects):
//   activity group  = reasoning + tool calls in chronological order.
//   content bubbles = assistant text, including narration between tool rounds.
//                     Text is a real boundary: it closes the previous activity
//                     preview and lets a later tool/reasoning burst start a new one.
// ---------------------------------------------------------------------------

// One entry of a pi assistant message's `content`. Pi's settled union is
// TextContent | ThinkingContent | ToolCall; at snapshot time a ToolCall's
// `arguments` may still be a partial JSON string, and the controller proxy may
// attach reasoning to a text part (or emit a "reasoning" part) before pi
// normalizes it to ThinkingContent — so we widen exactly those two spots.
type PiContentPart =
  | (TextContent & { reasoning_content?: string })
  | ThinkingContent
  | (Omit<ToolCall, "arguments"> & { arguments?: string | Record<string, unknown> })
  | { type: "reasoning"; reasoning?: string; thinking?: string; text?: string };

function partToBlocks(part: PiContentPart, callOrdinal: number, index: number): AssistantBlock[] {
  const idBase = `${callOrdinal}:${index}`;
  if (part.type === "toolCall") {
    const args = toolArgs(part);
    const argsText = args
      ? JSON.stringify(args, null, 2)
      : typeof part.arguments === "string" && part.arguments.trim()
        ? part.arguments
        : "{}";
    return [
      {
        kind: "tool",
        id: part.id || `${idBase}:tool`,
        name: part.name || "tool",
        status: "running",
        argsText,
        args,
        text: argsText,
      },
    ];
  }
  if (part.type === "thinking") {
    const text = part.thinking ?? "";
    return text ? [{ kind: "thinking", id: `${idBase}:thinking`, text }] : [];
  }
  if (part.type === "reasoning") {
    const text = part.reasoning || part.thinking || "";
    return text ? [{ kind: "thinking", id: `${idBase}:thinking`, text }] : [];
  }
  if (part.type === "text") {
    const reasoning = part.reasoning_content ?? "";
    const text = part.text ?? "";
    const blocks: AssistantBlock[] = [];
    if (reasoning) blocks.push({ kind: "thinking", id: `${idBase}:rthinking`, text: reasoning });
    if (text) blocks.push({ kind: "text", id: `${idBase}:text`, text });
    return blocks;
  }
  return [];
}

function mergeAdjacentTextLike(blocks: AssistantBlock[]): AssistantBlock[] {
  const out: AssistantBlock[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (
      last &&
      (last.kind === "text" || last.kind === "thinking") &&
      last.kind === block.kind &&
      (block.kind === "text" || block.kind === "thinking")
    ) {
      // Snapshots carry each call's full accumulated text with whitespace
      // intact, so adjacent same-kind fragments concatenate directly — no
      // boundary guessing (that only existed to paper over dropped whitespace).
      out[out.length - 1] = { ...last, text: last.text + block.text };
    } else {
      out.push(block);
    }
  }
  return out;
}

/**
 * Build the bubble's blocks from the per-call content snapshots of a turn.
 * `calls[i]` is the full accumulated `content` array of the i-th LLM call.
 * Parts arrive duck-typed (live runtime + replayed log), so the input stays
 * loose and `asRecordPart` narrows each one to a typed `PiContentPart`.
 */
export function blocksFromTurnSnapshots(calls: unknown[][]): AssistantBlock[] {
  const out: AssistantBlock[] = [];
  calls.forEach((content, callOrdinal) => {
    if (!Array.isArray(content)) return;
    const parts = content.map(asRecordPart);
    out.push(...parts.flatMap((part, index) => partToBlocks(part, callOrdinal, index)));
  });
  // Merge across the whole turn, not just within a call: a markdown table (or
  // any prose) that spans two LLM calls must coalesce into one text block so
  // the GFM parser sees the full table instead of two raw fragments. Adjacent
  // same-kind merging keeps a text→tool→text sequence split at tool boundaries.
  return mergeAdjacentTextLike(out);
}

const asRecordPart = (value: unknown): PiContentPart =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as PiContentPart)
    : { type: "text", text: "" };

// ---------------------------------------------------------------------------
// Tool-state preservation across a snapshot rebuild
//
// Rebuilding a bubble's blocks from a fresh content snapshot recreates each
// tool block in its "running" shape. Tool *results* (status done/error,
// resultText) and the most complete argument text arrive on separate events, so
// they must be carried over from the previous blocks by stable tool id. Shared
// by the snapshot reducer and the final-message reconcile.
// ---------------------------------------------------------------------------

export function usefulToolArgsText(value: string | undefined): string {
  const text = value ?? "";
  return text.trim() === "{}" ? "" : text;
}

function mergedToolArgsText(
  existingArgsText: string | undefined,
  incomingArgsText: string | undefined,
): string | undefined {
  const existing = usefulToolArgsText(existingArgsText);
  const incoming = usefulToolArgsText(incomingArgsText);
  if (!existing) return incoming || undefined;
  if (!incoming) return existing;
  if (incoming.startsWith(existing) || incoming.length >= existing.length) return incoming;
  if (existing.startsWith(incoming)) return existing;
  return incoming;
}

export function mergeExistingToolState(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const existingTools = new Map(
    existingBlocks
      .filter((block) => block.kind === "tool")
      .map((block) => [block.id, block] as const),
  );
  return incomingBlocks.map((block) => {
    if (block.kind !== "tool") return block;
    const existing = existingTools.get(block.id);
    if (!existing || existing.kind !== "tool") return block;
    const argsText = mergedToolArgsText(existing.argsText, block.argsText);
    return {
      ...block,
      args: block.args ?? existing.args,
      argsText,
      resultText: existing.resultText ?? block.resultText,
      // The snapshot rebuild reconstructs blocks from the model's own parts,
      // which never carry execution output — details would be dropped on the
      // next streaming frame without this.
      details: existing.details ?? block.details,
      status: existing.status,
      text: argsText || block.text || existing.text,
    };
  });
}
