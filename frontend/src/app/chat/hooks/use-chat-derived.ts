// CRITICAL
"use client";

import { useMemo, useCallback } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { ActivityGroup, ActivityItem, ThinkingState } from "../types";
import type { ToolResult } from "@/lib/types";
import { thinkingParser } from "@/lib/services/message-parsing";

interface UseChatDerivedOptions {
  messages: UIMessage[];
  isLoading: boolean;
  executingTools: Set<string>;
  toolResultsMap: Map<string, ToolResult>;
  systemPrompt?: string;
}

export function useChatDerived({
  messages,
  isLoading,
  executingTools,
  toolResultsMap,
  systemPrompt,
}: UseChatDerivedOptions) {
  // Extract thinking/reasoning content from a single assistant message
  const extractThinking = useCallback((message: UIMessage) => {
    // 1. Extract AI SDK reasoning parts
    const reasoningParts = message.parts.filter(
      (part): part is { type: "reasoning"; text: string } => part.type === "reasoning",
    );
    const aiSdkReasoning = reasoningParts
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n");

    // 2. Extract <think>/<thinking> tags from text content
    const textContent = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    const parsed = thinkingParser.parse(textContent);
    const thinkTagContent = parsed.thinkingContent || "";

    // 3. Combine both sources
    const combined = [aiSdkReasoning, thinkTagContent].filter(Boolean).join("\n\n");

    return {
      content: combined,
      isComplete: parsed.isThinkingComplete,
    };
  }, []);

  const isToolPart = (
    part: UIMessage["parts"][number],
  ): part is UIMessage["parts"][number] & { toolCallId: string; input?: unknown } => {
    if (typeof part.type !== "string") return false;
    if (part.type === "dynamic-tool") return "toolCallId" in part;
    return part.type.startsWith("tool-") && "toolCallId" in part;
  };

  const requestContext = useMemo(() => {
    const trimmedSystem = systemPrompt?.trim() || "";
    return {
      systemPrompt: trimmedSystem || undefined,
    };
  }, [systemPrompt]);

  // Build activity groups from assistant messages with chronologically interleaved items
  const activityGroups = useMemo<ActivityGroup[]>(() => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) return [];

    const lastAssistantId = assistantMessages[assistantMessages.length - 1]?.id;
    const groups: ActivityGroup[] = [];

    assistantMessages.forEach((msg, index) => {
      const isLatest = msg.id === lastAssistantId;
      const items: ActivityItem[] = [];

      // Process parts in chronological order to interleave thinking and tool calls
      msg.parts.forEach((part, partIndex) => {
        // Handle reasoning/thinking parts
        if (part.type === "reasoning" && "text" in part && part.text) {
          items.push({
            id: `activity-${msg.id}-thinking-${partIndex}`,
            type: "thinking",
            timestamp: Date.now() - (msg.parts.length - partIndex) * 10,
            content: part.text,
            isActive: isLatest && isLoading && partIndex === msg.parts.length - 1,
          });
          return;
        }

        // Handle tool parts
        if (!isToolPart(part)) return;

        const toolCallId = String(part.toolCallId);
        const result = toolResultsMap.get(toolCallId);
        const isExecuting = executingTools.has(toolCallId);

        const partState = "state" in part ? (part as { state?: string }).state : undefined;
        const partHasOutput = "output" in part && (part as { output?: unknown }).output != null;

        const rawToolName =
          part.type === "dynamic-tool"
            ? "toolName" in part
              ? String(part.toolName)
              : "tool"
            : part.type.replace(/^tool-/, "");
        const toolName = rawToolName.includes("__")
          ? rawToolName.split("__").slice(1).join("__")
          : rawToolName;

        // Determine state
        let itemState: "pending" | "running" | "complete" | "error" = "pending";
        const pendingStates = new Set([
          "input-streaming",
          "input-available",
          "approval-requested",
          "approval-responded",
        ]);
        const errorStates = new Set(["output-error", "output-denied"]);

        if (isExecuting) {
          itemState = "running";
        } else if (result) {
          itemState = result.isError ? "error" : "complete";
        } else if (partState && errorStates.has(partState)) {
          itemState = "error";
        } else if (partState === "output-available" || partState === "result" || partHasOutput) {
          itemState = "complete";
        } else if (partState && pendingStates.has(partState)) {
          itemState = "running";
        }

        items.push({
          id: `activity-${msg.id}-${toolCallId}`,
          type: "tool-call",
          timestamp: Date.now() - (msg.parts.length - partIndex) * 10,
          toolName,
          toolCallId,
          state: itemState,
          input: "input" in part ? part.input : undefined,
          output: result?.content ?? (partHasOutput ? (part as { output: unknown }).output : undefined),
        });
      });

      // Also extract thinking from text content (think tags) as a fallback
      const textThinking = extractThinking(msg);
      if (textThinking.content && !items.some(i => i.type === "thinking")) {
        items.unshift({
          id: `activity-${msg.id}-thinking-text`,
          type: "thinking",
          timestamp: Date.now() - 1000,
          content: textThinking.content,
          isActive: isLatest && isLoading,
        });
      }

      if (items.length === 0) return;

      groups.push({
        id: `activity-group-${msg.id}`,
        messageId: msg.id,
        title: isLatest ? `Latest (Turn ${index + 1})` : `Turn ${index + 1}`,
        isLatest,
        items,
      });
    });

    return groups.reverse();
  }, [messages, extractThinking, executingTools, toolResultsMap, isLoading]);

  const hasToolActivity =
    activityGroups.some((group) => group.items.some(i => i.type === "tool-call")) || executingTools.size > 0;

  const thinkingState = useMemo<ThinkingState>(() => {
    const latestGroup = activityGroups[0];
    if (!latestGroup) return { content: "", isComplete: true };

    // Find the latest thinking item
    const thinkingItems = latestGroup.items.filter(i => i.type === "thinking");
    const latestThinking = thinkingItems[thinkingItems.length - 1];

    return {
      content: latestThinking?.content || "",
      isComplete: !isLoading,
    };
  }, [activityGroups, isLoading]);

  const thinkingActive = Boolean(activityGroups[0]?.items.some(i => i.type === "thinking" && i.isActive));

  const hasSidePanelContent =
    activityGroups.length > 0 || hasToolActivity || thinkingState.content.length > 0;

  // Last assistant message for actions
  const lastAssistantMessage = useMemo(() => {
    return [...messages].reverse().find((m) => m.role === "assistant") || null;
  }, [messages]);

  return {
    thinkingState,
    thinkingActive,
    activityGroups,
    hasToolActivity,
    hasSidePanelContent,
    lastAssistantMessage,
    requestContext,
  };
}
