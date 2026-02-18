// CRITICAL
"use client";

import { useMemo } from "react";
import { thinkingParser } from "../message-renderer";
import { isToolCallOnlyText, isToolPartType } from "@/app/chat/hooks/chat/use-chat-message-mapping/helpers";
import type { ChatMessage } from "@/lib/types";
import type { ToolPart } from "./constants";

export const deriveMessageContent = ({
  role,
  parts,
}: {
  role: ChatMessage["role"];
  parts: ChatMessage["parts"];
}): {
  textContent: string;
  thinkingContent: string;
  toolParts: ToolPart[];
} => {
  const isUser = role === "user";

  let rawTextContent = "";
  let reasoningFromParts = "";
  const toolParts: ToolPart[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text && !isToolCallOnlyText(text)) rawTextContent += text;
      continue;
    }
    if (part.type === "reasoning") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text) reasoningFromParts += (reasoningFromParts ? "\n" : "") + text;
      continue;
    }
    const type = (part as { type?: unknown }).type;
    const isDynamicTool = type === "dynamic-tool";
    const isStaticTool = isToolPartType(type) && !isDynamicTool;
    if (!isDynamicTool && !isStaticTool) continue;
    if (!("toolCallId" in (part as object))) continue;

    if (isDynamicTool) {
      toolParts.push({
        ...(part as ToolPart),
        toolName: "toolName" in (part as object) ? String((part as { toolName?: unknown }).toolName) : "tool",
      });
    } else {
      const toolType = String(type);
      const rawName = toolType === "tool-call" || toolType === "tool_call" ? "tool" : toolType.replace(/^tool-/, "");
      const toolName = rawName.includes("__") ? rawName.split("__").slice(1).join("__") : rawName;
      toolParts.push({
        ...(part as ToolPart),
        toolName,
      });
    }
  }

  if (isUser) {
    return { textContent: rawTextContent, thinkingContent: reasoningFromParts, toolParts };
  }

  const lower = rawTextContent.toLowerCase();
  const hasThinkTags =
    lower.includes("<think") ||
    lower.includes("</think") ||
    lower.includes("<thinking") ||
    lower.includes("</thinking");
  const parsedThinking = hasThinkTags ? thinkingParser.parse(rawTextContent) : null;
  const textContent = hasThinkTags ? parsedThinking?.mainContent || "" : rawTextContent;
  const thinkingFromTags = hasThinkTags ? parsedThinking?.thinkingContent || "" : "";
  const thinkingContent = reasoningFromParts || thinkingFromTags;

  return { textContent, thinkingContent, toolParts };
};

export function useMessageDerived({
  role,
  parts,
}: {
  role: ChatMessage["role"];
  parts: ChatMessage["parts"];
}): {
  textContent: string;
  thinkingContent: string;
  toolParts: ToolPart[];
} {
  return useMemo(() => deriveMessageContent({ role, parts }), [parts, role]);
}
