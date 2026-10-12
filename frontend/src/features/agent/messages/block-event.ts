import {
  asRecord,
  compactionTextFromEvent,
  extractToolText,
  newId,
} from "@/features/agent/messages/helpers";
import { traceAgentReasoning } from "@/features/agent/trace-reasoning";
import type { AssistantBlock, ToolBlock } from "@/features/agent/messages/types";

export type MakeBlockId = (prefix: string) => string;

export function appendDelta(
  blocks: AssistantBlock[],
  kind: "text" | "thinking",
  delta: string,
  makeId: MakeBlockId = newId,
): AssistantBlock[] {
  const idx = trailingBlockIndex(blocks, kind);
  const next =
    idx === -1
      ? [...blocks, { kind, id: makeId(kind), text: delta }]
      : appendToTextLikeBlock(blocks, idx, delta);
  return normalizeReasoningBeforeVisibleText(next);
}

function trailingBlockIndex(blocks: AssistantBlock[], kind: "text" | "thinking"): number {
  const index = blocks.length - 1;
  return blocks[index]?.kind === kind ? index : -1;
}

function appendToTextLikeBlock(
  blocks: AssistantBlock[],
  index: number,
  delta: string,
): AssistantBlock[] {
  const block = blocks[index];
  if (!block || (block.kind !== "text" && block.kind !== "thinking")) return blocks;
  if (!delta) return blocks;
  // pi emits text/thinking deltas as pure INCREMENTAL tokens (verified against
  // pi-agent-core's agent loop: every text_delta carries only the new token).
  // Both callers — reduceSessionEvent's fall-through (live and canonical fold)
  // and the tool bridge — forward those incremental deltas, so the correct,
  // lossless rule is to append verbatim.
  //
  // We deliberately do NOT try to detect a "cumulative snapshot" or "replay
  // restart" by string-prefix matching. That guess is mathematically ambiguous
  // for short/repeated/whitespace tokens: a row-leading "| " or a "| --- |"
  // separator is a prefix of the already-accumulated table, so the old
  // `block.text.startsWith(delta)` dedup silently dropped real cell separators
  // and collapsed markdown tables onto one line (and `delta.startsWith(block.text)`
  // mis-sliced short deltas). Snapshot/replace semantics are owned upstream — by
  // reduceAssistantSnapshotEvent on the live path and by the settled message_end
  // that overwrites the block — never inferred here per delta.
  const next = blocks.slice();
  next[index] = { ...block, text: block.text + delta };
  return next;
}

function normalizeReasoningBeforeVisibleText(blocks: AssistantBlock[]): AssistantBlock[] {
  const firstToolIndex = blocks.findIndex((block) => block.kind === "tool");
  const prefix = firstToolIndex === -1 ? blocks : blocks.slice(0, firstToolIndex);
  const suffix = firstToolIndex === -1 ? [] : blocks.slice(firstToolIndex);
  const thinking = mergeTextLikeBlocks(prefix.filter((block) => block.kind === "thinking"));
  const text = mergeTextLikeBlocks(prefix.filter((block) => block.kind === "text"));
  const other = prefix.filter((block) => block.kind !== "thinking" && block.kind !== "text");
  return [...thinking, ...text, ...other, ...suffix];
}

function mergeTextLikeBlocks(blocks: AssistantBlock[]): AssistantBlock[] {
  const [first, ...rest] = blocks;
  if (!first || (first.kind !== "text" && first.kind !== "thinking")) return blocks;
  return [
    rest.reduce(
      (merged, block) =>
        block.kind === first.kind ? { ...merged, text: merged.text + block.text } : merged,
      first,
    ),
  ];
}

export function upsertTool(
  blocks: AssistantBlock[],
  toolCallId: string,
  patch: (tool: ToolBlock) => ToolBlock,
  fallback: () => ToolBlock,
): AssistantBlock[] {
  const idx = blocks.findIndex((b) => b.kind === "tool" && b.id === toolCallId);
  if (idx === -1) return [...blocks, fallback()];
  const next = blocks.slice();
  next[idx] = patch(next[idx] as ToolBlock);
  return next;
}

function upsertToolForActivity(
  blocks: AssistantBlock[],
  toolCallId: string,
  patch: (tool: ToolBlock) => ToolBlock,
  fallback: () => ToolBlock,
): AssistantBlock[] {
  const hasTool = blocks.some((block) => block.kind === "tool" && block.id === toolCallId);
  return upsertTool(
    hasTool ? blocks : convertTrailingTextToThinking(blocks),
    toolCallId,
    patch,
    fallback,
  );
}

function convertTrailingTextToThinking(blocks: AssistantBlock[]): AssistantBlock[] {
  let start = blocks.length;
  while (start > 0 && blocks[start - 1]?.kind === "text") {
    start -= 1;
  }
  if (start === blocks.length) return blocks;

  const next = blocks.slice();
  for (let index = start; index < next.length; index += 1) {
    const block = next[index];
    if (block?.kind === "text") {
      next[index] = { kind: "thinking", id: block.id, text: block.text };
    }
  }
  return normalizeReasoningBeforeVisibleText(next);
}

// When a turn ends, no tool can still be executing. Any block left "running"
// either completed without us seeing its tool_execution_end (e.g. the live
// stream was cut) or belonged to an LLM call that errored before the tool ran.
// Settle them so the UI never shows a perpetual "running" badge after the turn.
export function finalizeRunningToolBlocks(
  blocks: AssistantBlock[],
  status: "done" | "error" = "done",
): AssistantBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.kind === "tool" && block.status === "running") {
      changed = true;
      return { ...block, status };
    }
    return block;
  });
  return changed ? next : blocks;
}

export function appendEventBlock(
  blocks: AssistantBlock[],
  text: string,
  makeId: MakeBlockId = newId,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === "event" && last.text === text) return blocks;
  return [...blocks, { kind: "event", id: makeId("event"), text }];
}

export type StreamingToolCallSnapshot = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
};

function parseToolArgs(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

function contentPartAt(
  messageLike: unknown,
  contentIndex: unknown,
): Record<string, unknown> | null {
  const message = asRecord(messageLike);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;
  if (typeof contentIndex === "number") return asRecord(content[contentIndex]);
  for (let idx = content.length - 1; idx >= 0; idx -= 1) {
    const part = asRecord(content[idx]);
    if (part?.type === "toolCall") return part;
  }
  return null;
}

function deltaKindFromMessageUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
): "text" | "thinking" | null {
  if (!assistantMessageEvent || typeof assistantMessageEvent.delta !== "string") return null;
  if (
    assistantMessageEvent.type === "thinking_delta" ||
    assistantMessageEvent.type === "reasoning_delta" ||
    assistantMessageEvent.type === "reasoning_text_delta"
  ) {
    return "thinking";
  }
  if (assistantMessageEvent.type !== "text_delta") return null;
  return "text";
}

export function toolCallSnapshotFromUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
  message?: unknown,
): StreamingToolCallSnapshot | null {
  if (!assistantMessageEvent) return null;
  const explicit = asRecord(assistantMessageEvent.toolCall);
  const part =
    explicit ??
    contentPartAt(assistantMessageEvent.partial, assistantMessageEvent.contentIndex) ??
    contentPartAt(message, assistantMessageEvent.contentIndex);
  const idValue = part?.id ?? assistantMessageEvent.toolCallId;
  const id = typeof idValue === "string" && idValue.trim() ? idValue.trim() : "";
  if (!id) return null;
  const nameValue = part?.name ?? assistantMessageEvent.toolName;
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : "tool";
  const args = parseToolArgs(part?.arguments);
  return { id, name, args };
}

export function toolCallDeltaFromUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
): string {
  const value = assistantMessageEvent?.delta ?? assistantMessageEvent?.argumentsDelta;
  return typeof value === "string" ? value : "";
}

export function stringifyToolArgs(args: Record<string, unknown> | undefined): string | undefined {
  return args && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;
}

export function assistantPiEventAffectsBlocks(event: Record<string, unknown>): boolean {
  if (compactionTextFromEvent(event)) return true;
  return (
    event.type === "message_update" ||
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  );
}

export function applyAssistantPiEventToBlocks(
  blocks: AssistantBlock[],
  event: Record<string, unknown>,
  makeId: MakeBlockId = newId,
): AssistantBlock[] | null {
  const compactionText = compactionTextFromEvent(event);
  if (compactionText) return appendEventBlock(blocks, compactionText, makeId);
  if (event.type === "message_update") return applyMessageUpdateToBlocks(blocks, event, makeId);
  if (event.type === "tool_execution_start") {
    const id = String(event.toolCallId || makeId("tool"));
    const name = String(event.toolName || "tool");
    return upsertToolForActivity(
      blocks,
      id,
      (existing) => existing,
      () => toolBlock(id, name),
    );
  }
  if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
    return applyToolExecutionToBlocks(blocks, event);
  }
  return null;
}

function applyMessageUpdateToBlocks(
  blocks: AssistantBlock[],
  event: Record<string, unknown>,
  makeId: MakeBlockId,
): AssistantBlock[] | null {
  const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
  const deltaKind = deltaKindFromMessageUpdate(ame);
  if (deltaKind && typeof ame?.delta === "string") {
    traceAgentReasoning("block-event.delta", {
      deltaKind,
      eventType: event.type,
      assistantMessageEventType: ame.type,
      contentIndex: ame.contentIndex,
      delta: ame.delta,
    });
    return appendDelta(blocks, deltaKind, ame.delta, makeId);
  }
  if (ame?.type === "toolcall_start") return applyToolCallStart(blocks, ame, event);
  if (ame?.type === "toolcall_delta") return applyToolCallDelta(blocks, ame, event);
  if (ame?.type === "toolcall_end") return applyToolCallEnd(blocks, ame, makeId);
  return null;
}

function applyToolCallStart(
  blocks: AssistantBlock[],
  ame: Record<string, unknown>,
  event: Record<string, unknown>,
): AssistantBlock[] | null {
  const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
  if (!snapshot) return null;
  return upsertToolForActivity(
    blocks,
    snapshot.id,
    (existing) => ({
      ...existing,
      name: snapshot.name,
      args: snapshot.args ?? existing.args,
    }),
    () =>
      toolBlock(snapshot.id, snapshot.name, {
        argsText: stringifyToolArgs(snapshot.args) ?? "",
        args: snapshot.args,
      }),
  );
}

function applyToolCallDelta(
  blocks: AssistantBlock[],
  ame: Record<string, unknown>,
  event: Record<string, unknown>,
): AssistantBlock[] | null {
  const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
  const delta = toolCallDeltaFromUpdate(ame);
  if (!snapshot || (!delta && !snapshot.args)) return null;
  return upsertToolForActivity(
    blocks,
    snapshot.id,
    (existing) => {
      const existingArgsText = existing.argsText?.trim() === "{}" ? "" : (existing.argsText ?? "");
      const argsText = delta
        ? existingArgsText + delta
        : existing.argsText || stringifyToolArgs(snapshot.args);
      return {
        ...existing,
        name: snapshot.name || existing.name,
        args: snapshot.args ?? existing.args,
        argsText,
      };
    },
    () => {
      const argsText = delta || stringifyToolArgs(snapshot.args) || "";
      return toolBlock(snapshot.id, snapshot.name, {
        argsText,
        args: snapshot.args,
      });
    },
  );
}

function applyToolCallEnd(
  blocks: AssistantBlock[],
  ame: Record<string, unknown>,
  makeId: MakeBlockId,
): AssistantBlock[] | null {
  const toolCall = ame.toolCall as { id?: string; name?: string; arguments?: unknown } | undefined;
  if (!toolCall) return null;
  const id = toolCall.id || makeId("tool");
  const name = toolCall.name || "tool";
  const argsObj = parseToolArgs(toolCall.arguments);
  const argsText = argsObj
    ? JSON.stringify(argsObj, null, 2)
    : typeof toolCall.arguments === "string" && toolCall.arguments.trim()
      ? toolCall.arguments
      : "{}";
  return upsertToolForActivity(
    blocks,
    id,
    (existing) => ({
      ...existing,
      name,
      argsText,
      args: argsObj ?? existing.args,
      text: existing.text || argsText,
    }),
    () => toolBlock(id, name, { status: "running", argsText, args: argsObj, text: argsText }),
  );
}

function applyToolExecutionToBlocks(
  blocks: AssistantBlock[],
  event: Record<string, unknown>,
): AssistantBlock[] | null {
  const id = String(event.toolCallId || "");
  if (!id) return null;
  const payload = event.partialResult || event.result;
  const resultText = extractToolText(payload);
  // A tool's structured payload rides alongside its text; tool_execution_update
  // carries it too, so a long-running tool can report progress before it ends.
  const details = asRecord(asRecord(payload)?.details) ?? undefined;
  const status =
    event.type === "tool_execution_end"
      ? ((event.isError ? "error" : "done") as ToolBlock["status"])
      : undefined;
  return upsertTool(
    blocks,
    id,
    (existing) => ({
      ...existing,
      status: status ?? existing.status,
      resultText: resultText || existing.resultText,
      details: details ?? existing.details,
      text: existing.argsText || existing.text || resultText,
    }),
    () =>
      toolBlock(id, "tool", {
        status: status ?? "running",
        resultText,
        ...(details ? { details } : {}),
        text: resultText,
      }),
  );
}

function toolBlock(
  id: string,
  name: string,
  patch: Partial<Omit<ToolBlock, "kind" | "id" | "name">> = {},
): ToolBlock {
  return { kind: "tool", id, name, status: "running", text: "", ...patch };
}
