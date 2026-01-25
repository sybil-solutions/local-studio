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

  // Build activity groups from assistant messages (newest first)
  const activityGroups = useMemo<ActivityGroup[]>(() => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) return [];

    const lastAssistantId = assistantMessages[assistantMessages.length - 1]?.id;
    const groups: ActivityGroup[] = [];

    assistantMessages.forEach((msg, index) => {
      const thinking = extractThinking(msg);
      const toolItems: ActivityItem[] = [];

      msg.parts.forEach((part) => {
        if (!isToolPart(part)) return;

        const toolCallId = String(part.toolCallId);
        const result = toolResultsMap.get(toolCallId);
        const isExecuting = executingTools.has(toolCallId);

        const rawToolName =
          part.type === "dynamic-tool"
            ? "toolName" in part
              ? String(part.toolName)
              : "tool"
            : part.type.replace(/^tool-/, "");
        const toolName = rawToolName.includes("__")
          ? rawToolName.split("__").slice(1).join("__")
          : rawToolName;

        toolItems.push({
          id: `activity-${msg.id}-${toolCallId}`,
          type: "tool-call",
          timestamp: Date.now(),
          toolName,
          toolCallId,
          state: isExecuting
            ? "running"
            : result
              ? result.isError
                ? "error"
                : "complete"
              : "pending",
          input: "input" in part ? part.input : undefined,
          output: result?.content,
        });
      });

      const isLatest = msg.id === lastAssistantId;
      const hasThinking = Boolean(thinking.content);
      const hasTools = toolItems.length > 0;

      if (!hasThinking && !hasTools) {
        return;
      }

      groups.push({
        id: `activity-group-${msg.id}`,
        messageId: msg.id,
        title: isLatest ? `Latest (Turn ${index + 1})` : `Turn ${index + 1}`,
        isLatest,
        thinkingContent: hasThinking ? thinking.content : undefined,
        thinkingActive: isLatest && isLoading && hasThinking,
        toolItems,
      });
    });

    return groups.reverse();
  }, [messages, extractThinking, executingTools, toolResultsMap, isLoading]);

  const hasToolActivity =
    activityGroups.some((group) => group.toolItems.length > 0) || executingTools.size > 0;

  const thinkingState = useMemo<ThinkingState>(() => {
    const latestGroup = activityGroups[0];
    if (!latestGroup) return { content: "", isComplete: true };

    return {
      content: latestGroup.thinkingContent || "",
      isComplete: !isLoading,
    };
  }, [activityGroups, isLoading]);

  const thinkingActive = Boolean(activityGroups[0]?.thinkingActive);

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
