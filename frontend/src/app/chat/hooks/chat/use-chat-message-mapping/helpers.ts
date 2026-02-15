// CRITICAL
"use client";

import { safeJsonStringify } from "@/lib/safe-json";
import { createUuid } from "@/lib/uuid";
import type { ChatMessage, ChatMessageMetadata, ChatMessagePart, StoredMessage, StoredToolCall } from "@/lib/types";
import { tryParseNestedJsonString } from "../../../utils";

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stripToolCallOnlyText(text: string): string {
  let remaining = text;
  let foundToolText = false;

  const xmlPatterns = [
    /<use_mcp_tool[\s\S]*?<\/use_mcp[\s_]*tool>/gi,
    /<tool_call>[\s\S]*?<\/tool_call>/gi,
    /\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*(?:\{[\s\S]*?\}|\[[\s\S]*?\]|".*?")\s*\}/gi,
  ];

  for (const pattern of xmlPatterns) {
    const next = remaining.replace(pattern, "");
    if (next !== remaining) {
      foundToolText = true;
    }
    remaining = next;
  }

  remaining = remaining.trim();
  return foundToolText && !remaining ? "" : remaining;
}

function isToolDebugText(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  if (!normalized.startsWith("json parse error")) return false;
  if (!normalized.includes("session_id:") || !normalized.includes("run_id:")) return false;
  if (!normalized.includes("in model response")) return false;
  return true;
}

export function isToolCallOnlyText(text: string): boolean {
  if (isToolDebugText(text)) return true;
  const stripped = stripToolCallOnlyText(text);
  return stripped.length === 0 && text.trim().length > 0;
}

export function isToolPartType(partType: unknown): partType is "dynamic-tool" | string {
  return (
    partType === "dynamic-tool" ||
    partType === "toolCall" ||
    partType === "tool-call" ||
    partType === "tool_call" ||
    (typeof partType === "string" && partType.startsWith("tool-"))
  );
}

export function mapStoredToolCallsImpl(toolCalls?: StoredToolCall[]): ChatMessagePart[] {
  if (!toolCalls?.length) return [];
  return toolCalls.map((tc) => {
    const name = tc.function?.name || "tool";
    const args = tc.function?.arguments;
    const input = typeof args === "string" ? (tryParseNestedJsonString(args) ?? args) : args;
    const result = tc.result as { content?: unknown; isError?: boolean } | string | undefined;
    const hasResult = result != null;
    const isError = typeof result === "object" && result?.isError === true;
    const content = typeof result === "object" ? (result?.content ?? result) : result;

    return {
      type: tc.dynamic ? "dynamic-tool" : `tool-${name}`,
      toolName: tc.dynamic ? name : undefined,
      toolCallId: tc.id,
      state: hasResult ? (isError ? "output-error" : "output-available") : "input-available",
      input,
      output: isError ? undefined : content,
      errorText: isError ? (typeof content === "string" ? content : safeJsonStringify(content, "")) : undefined,
      providerExecuted: tc.providerExecuted,
    };
  });
}

export function mapStoredMessagesImpl(storedMessages: StoredMessage[]): ChatMessage[] {
  return storedMessages.map((message) => {
    const storedParts = message.parts as ChatMessagePart[] | undefined;
    const hasStoredParts = Array.isArray(storedParts) && storedParts.length > 0;
    const parts: ChatMessagePart[] = hasStoredParts ? [...storedParts] : [];

    if (!hasStoredParts && message.content) {
      parts.push({ type: "text", text: message.content });
    }

    if (!hasStoredParts) {
      const toolParts = mapStoredToolCallsImpl(message.tool_calls);
      for (const toolPart of toolParts) {
        parts.push(toolPart);
      }
    }

    const inputTokens = message.prompt_tokens ?? undefined;
    const outputTokens = message.completion_tokens ?? undefined;
    const totalTokens =
      message.total_tokens ??
      (inputTokens != null || outputTokens != null ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);

    const metadata = message.metadata as ChatMessageMetadata | undefined;

    return {
      id: message.id,
      role: message.role,
      parts,
      metadata:
        metadata ??
        ({
          model: message.model,
          usage:
            inputTokens != null || outputTokens != null || totalTokens != null
              ? {
                  inputTokens,
                  outputTokens,
                  totalTokens,
                }
              : undefined,
        } satisfies ChatMessageMetadata),
      model: message.model,
      tool_calls: message.tool_calls,
      content: message.content,
      created_at: (message as { created_at?: string }).created_at,
    } satisfies ChatMessage;
  });
}

export function isToolPart(part: ChatMessagePart): part is Extract<ChatMessagePart, { toolCallId: string }> {
  // Check for toolCallId property which only exists on tool parts
  return "toolCallId" in part && typeof part.toolCallId === "string" && part.toolCallId.length > 0;
}

export function mergeToolParts(previous: ChatMessagePart[], next: ChatMessagePart[]): ChatMessagePart[] {
  if (previous.length === 0) return next;
  const previousById = new Map<string, Extract<ChatMessagePart, { toolCallId: string }>>();
  for (const part of previous) {
    if (isToolPart(part)) {
      previousById.set(part.toolCallId, part);
    }
  }
  return next.map((part) => {
    if (!isToolPart(part)) return part;
    const prior = previousById.get(part.toolCallId);
    if (!prior) return part;
    const merged = {
      ...prior,
      ...part,
      input: part.input ?? (prior as { input?: unknown }).input,
      output: part.output ?? (prior as { output?: unknown }).output,
      errorText: part.errorText ?? (prior as { errorText?: string }).errorText,
      state: part.state ?? (prior as { state?: string }).state,
      toolName: part.toolName ?? (prior as { toolName?: string }).toolName,
      providerExecuted: part.providerExecuted ?? (prior as { providerExecuted?: boolean }).providerExecuted,
    } satisfies Extract<ChatMessagePart, { toolCallId: string }>;
    return merged;
  });
}

function mapAgentContentToParts(content: unknown): ChatMessagePart[] {
  if (typeof content === "string") {
    if (!content.trim()) {
      return [];
    }
    if (isToolCallOnlyText(content)) {
      return [];
    }
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) return [];
  const parts: ChatMessagePart[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const type = asText(record["type"]) ?? "";
    if (type === "text") {
      const text = typeof record["text"] === "string" ? record["text"] : "";
      if (text && !isToolCallOnlyText(text)) {
        parts.push({ type: "text", text });
      }
      continue;
    }
    if (type === "thinking") {
      const thinking = typeof record["thinking"] === "string" ? record["thinking"] : "";
      if (thinking) parts.push({ type: "reasoning", text: thinking });
      continue;
    }
    if (isToolPartType(type) || typeof record["toolCallId"] === "string" || typeof record["id"] === "string") {
      const toolCallId = asText(record["id"]) || asText(record["toolCallId"]) || asText(record["tool_call_id"]) || "";
      if (!toolCallId) continue;

      const functionPayload = record["function"] as Record<string, unknown> | undefined;
      const toolNameFromType =
        type === "tool-call" || type === "tool_call" ? "tool" : type.replace(/^tool-/, "");
      const toolName =
        asText(record["toolName"]) || asText(record["name"]) || asText(functionPayload?.["name"]) || toolNameFromType;
      const input = "input" in record ? record["input"] : record["arguments"] ?? {};
      const state = asText(record["state"]) ?? "input-available";

      parts.push({
        type: "dynamic-tool",
        toolCallId,
        toolName,
        input,
        state,
      });
    }
  }
  return parts;
}

function mapUserContentToParts(content: unknown): ChatMessagePart[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts: ChatMessagePart[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record["type"] === "text") {
      const text = typeof record["text"] === "string" ? record["text"] : "";
      if (text) parts.push({ type: "text", text });
    } else if (record["type"] === "image") {
      parts.push({ type: "text", text: "[Image]" });
    }
  }
  return parts;
}

function buildMetadataFromAgent(message: Record<string, unknown>): ChatMessageMetadata | undefined {
  const model = typeof message["model"] === "string" ? message["model"] : undefined;
  const usage = message["usage"] as Record<string, unknown> | undefined;
  const input = typeof usage?.["input"] === "number" ? usage["input"] : undefined;
  const output = typeof usage?.["output"] === "number" ? usage["output"] : undefined;
  const total = typeof usage?.["totalTokens"] === "number" ? usage["totalTokens"] : undefined;
  if (model || input != null || output != null || total != null) {
    return {
      model,
      usage: input != null || output != null || total != null ? { inputTokens: input, outputTokens: output, totalTokens: total } : undefined,
    };
  }
  return undefined;
}

export function mapAgentMessageToChatMessageImpl(
  rawMessage: Record<string, unknown>,
  messageId?: string,
  runMeta?: { runId?: string; turnIndex?: number },
): ChatMessage | null {
  const role = rawMessage["role"];
  if (role !== "user" && role !== "assistant") return null;
  const id = messageId ?? (typeof rawMessage["id"] === "string" ? rawMessage["id"] : createUuid());
  const content = rawMessage["content"];
  const parts = role === "assistant" ? mapAgentContentToParts(content) : mapUserContentToParts(content);
  const baseMetadata =
    role === "assistant" ? buildMetadataFromAgent(rawMessage) : (rawMessage["metadata"] as ChatMessageMetadata | undefined);
  const mergedMetadata =
    runMeta?.runId || typeof runMeta?.turnIndex === "number"
      ? {
          ...(baseMetadata ?? {}),
          ...(runMeta?.runId ? { runId: runMeta.runId } : {}),
          ...(typeof runMeta?.turnIndex === "number" ? { turnIndex: runMeta.turnIndex } : {}),
        }
      : baseMetadata;
  return {
    id,
    role,
    parts,
    metadata: mergedMetadata,
  };
}
