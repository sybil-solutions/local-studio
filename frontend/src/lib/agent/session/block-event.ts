import {
  asRecord,
  compactionTextFromEvent,
  extractToolText,
  newId,
} from "@/lib/agent/session/helpers";
import type { AssistantBlock, ToolBlock } from "./types";

export type MakeBlockId = (prefix: string) => string;

// ----- block mutation primitives -----

export function appendDelta(
  blocks: AssistantBlock[],
  kind: "text" | "thinking",
  delta: string,
  makeId: MakeBlockId = newId,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    if (last.text.startsWith(delta)) return blocks;
    const append = delta.startsWith(last.text) ? delta.slice(last.text.length) : delta;
    if (!append) return blocks;
    return [...blocks.slice(0, -1), { ...last, text: last.text + append }];
  }
  return [...blocks, { kind, id: makeId(kind), text: delta }];
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

export function appendEventBlock(
  blocks: AssistantBlock[],
  text: string,
  makeId: MakeBlockId = newId,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.kind === "event" && last.text === text) return blocks;
  return [...blocks, { kind: "event", id: makeId("event"), text }];
}

// ----- streaming tool-call extraction helpers -----

export type StreamingToolCallSnapshot = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
};

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
  const args = asRecord(part?.arguments) ?? undefined;
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
    return upsertTool(
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
  if (ame?.type === "text_delta" && typeof ame.delta === "string") {
    return appendDelta(blocks, "text", ame.delta, makeId);
  }
  if (ame?.type === "thinking_delta" && typeof ame.delta === "string") {
    return appendDelta(blocks, "thinking", ame.delta, makeId);
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
  return upsertTool(
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
  return upsertTool(
    blocks,
    snapshot.id,
    (existing) => ({
      ...existing,
      name: snapshot.name || existing.name,
      args: snapshot.args ?? existing.args,
      argsText: delta
        ? (existing.argsText ?? "") + delta
        : existing.argsText || stringifyToolArgs(snapshot.args),
    }),
    () =>
      toolBlock(snapshot.id, snapshot.name, {
        argsText: delta || stringifyToolArgs(snapshot.args) || "",
        args: snapshot.args,
      }),
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
  const argsText = JSON.stringify(toolCall.arguments ?? {}, null, 2);
  const argsObj =
    toolCall.arguments && typeof toolCall.arguments === "object"
      ? (toolCall.arguments as Record<string, unknown>)
      : undefined;
  return upsertTool(
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
  const resultText = extractToolText(event.partialResult || event.result);
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
      text: existing.argsText || existing.text || resultText,
    }),
    () => toolBlock(id, "tool", { status: status ?? "running", resultText, text: resultText }),
  );
}

function toolBlock(
  id: string,
  name: string,
  patch: Partial<Omit<ToolBlock, "kind" | "id" | "name">> = {},
): ToolBlock {
  return { kind: "tool", id, name, status: "running", text: "", ...patch };
}
