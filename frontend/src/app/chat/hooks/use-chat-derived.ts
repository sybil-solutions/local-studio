// CRITICAL
"use client";

import { useMemo, useCallback } from "react";
import type { ActivityGroup, ActivityItem, ThinkingState } from "../types";
import type { ToolResult, ChatMessage, ChatMessagePart } from "@/lib/types";
import { thinkingParser } from "@/lib/services/message-parsing";

interface UseChatDerivedOptions {
  messages: ChatMessage[];
  isLoading: boolean;
  executingTools: Set<string>;
  toolResultsMap: Map<string, ToolResult>;
}

export function useChatDerived({
  messages,
  isLoading,
  executingTools,
  toolResultsMap,
}: UseChatDerivedOptions) {
  // Extract thinking/reasoning content from a single assistant message
  const extractThinking = useCallback((message: ChatMessage) => {
    // 1. Extract reasoning parts
    const reasoningParts = message.parts.filter(
      (part): part is { type: "reasoning"; text: string } => part.type === "reasoning",
    );
    const reasoningFromParts = reasoningParts
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
    const combined = [reasoningFromParts, thinkTagContent].filter(Boolean).join("\n\n");

    return {
      content: combined,
      isComplete: parsed.isThinkingComplete,
    };
  }, []);

  const isToolPart = (
    part: ChatMessagePart,
  ): part is ChatMessagePart & { toolCallId: string; input?: unknown } => {
    if (typeof part.type !== "string") return false;
    if (part.type === "dynamic-tool") return "toolCallId" in part;
    return part.type.startsWith("tool-") && "toolCallId" in part;
  };

  // Build activity groups by run (one user prompt) with chronologically interleaved items
  const activityGroups = useMemo<ActivityGroup[]>(() => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) return [];

    const getRunKey = (message: ChatMessage): string | null => {
      const metadata = message.metadata as Record<string, unknown> | undefined;
      if (metadata && typeof metadata["runId"] === "string") {
        return metadata["runId"] as string;
      }
      return null;
    };

    const lastAssistantId = assistantMessages[assistantMessages.length - 1]?.id;
    let lastAssistantKey: string | null = null;
    let currentRunKey: string | null = null;

    // First pass: resolve the run key for the last assistant message
    for (const msg of messages) {
      if (msg.role === "user") {
        currentRunKey = getRunKey(msg) ?? msg.id;
        continue;
      }
      if (msg.role !== "assistant") continue;
      const key = getRunKey(msg) ?? currentRunKey ?? msg.id;
      if (msg.id === lastAssistantId) {
        lastAssistantKey = key;
      }
    }

    const buildItemsForMessage = (msg: ChatMessage, isLatestMessage: boolean): ActivityItem[] => {
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
            isActive: isLatestMessage && isLoading && partIndex === msg.parts.length - 1,
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
          isActive: isLatestMessage && isLoading,
        });
      }

      return items;
    };

    const groups: ActivityGroup[] = [];
    const groupsByKey = new Map<string, ActivityGroup>();
    currentRunKey = null;

    for (const msg of messages) {
      if (msg.role === "user") {
        currentRunKey = getRunKey(msg) ?? msg.id;
        continue;
      }
      if (msg.role !== "assistant") continue;

      const key = getRunKey(msg) ?? currentRunKey ?? msg.id;
      const isLatestMessage = msg.id === lastAssistantId;
      const items = buildItemsForMessage(msg, isLatestMessage);
      if (items.length === 0) continue;

      let group = groupsByKey.get(key);
      if (!group) {
        group = {
          id: `activity-group-${key}`,
          messageId: msg.id,
          title: "",
          isLatest: false,
          items: [],
        };
        groupsByKey.set(key, group);
        groups.push(group);
      }
      group.items.push(...items);
    }

    groups.forEach((group, index) => {
      const isLatest = group.id === (lastAssistantKey ? `activity-group-${lastAssistantKey}` : "");
      group.isLatest = isLatest;
      group.title = isLatest ? `Latest (Turn ${index + 1})` : `Turn ${index + 1}`;
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
  };
}
