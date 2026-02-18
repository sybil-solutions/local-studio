// CRITICAL
"use client";

import { useMemo } from "react";
import { useAppStore } from "@/store";
import type { ChatMessage, ToolResult } from "@/lib/types";

export interface UseThinkingSnippetArgs {
  isLoading: boolean;
  streamStalled: boolean;
  executingTools: Set<string>;
  toolResultsMap: Map<string, ToolResult>;
  thinkingStateContent: string;
  messages: ChatMessage[];
}

export function useThinkingSnippet({
  isLoading,
  streamStalled,
  executingTools,
  toolResultsMap,
  thinkingStateContent,
  messages,
}: UseThinkingSnippetArgs) {
  // Subscribe to elapsedSeconds here (not in the parent controller)
  // so that the 1-second timer ticks don't re-render the entire page tree.
  const elapsedSeconds = useAppStore((state) => state.elapsedSeconds);

  return useMemo(() => {
    const MAX_SNIPPET_CHARS = 120;
    if (!isLoading) return "";

    if (streamStalled && executingTools.size === 0) {
      const seconds = Math.max(0, elapsedSeconds);
      const mm = Math.floor(seconds / 60);
      const ss = (seconds % 60).toString().padStart(2, "0");
      return `Still working... (quiet for ${mm}:${ss})`;
    }

    const raw = thinkingStateContent.trim();
    if (raw) {
      const line = raw.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? raw;
      const trimmed = line.trim();
      return trimmed.length > MAX_SNIPPET_CHARS
        ? `${trimmed.slice(0, MAX_SNIPPET_CHARS).trim()}...`
        : trimmed;
    }

    if (executingTools.size > 0) {
      const toolIds = Array.from(executingTools);

      const resolveToolName = (toolCallId: string) => {
        const result = toolResultsMap.get(toolCallId);
        if (result?.name && result.name.trim()) return result.name.trim();

        // Fallback to the most recent tool part name for this tool call id.
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const msg = messages[i];
          if (msg.role !== "assistant") continue;
          for (const part of msg.parts ?? []) {
            if (!part || typeof part !== "object") continue;
            const toolPart = part as { toolCallId?: unknown; toolName?: unknown };
            if (toolPart.toolCallId !== toolCallId) continue;
            if (typeof toolPart.toolName === "string" && toolPart.toolName.trim()) {
              return toolPart.toolName.trim();
            }
          }
        }
        return toolCallId;
      };

      const counts = new Map<string, number>();
      const orderedNames: string[] = [];
      for (const toolCallId of toolIds) {
        const name = resolveToolName(toolCallId);
        const next = (counts.get(name) ?? 0) + 1;
        counts.set(name, next);
        if (next === 1) orderedNames.push(name);
      }

      const labels = orderedNames.map((name) => {
        const count = counts.get(name) ?? 1;
        return count > 1 ? `${name} x${count}` : name;
      });

      const tools = labels.slice(0, 2).join(", ");
      const extra = labels.length > 2 ? ` +${labels.length - 2} more` : "";
      const line = `Running ${tools}${extra}`.replace(/\s+/g, " ").trim();
      return line.length > MAX_SNIPPET_CHARS ? `${line.slice(0, MAX_SNIPPET_CHARS).trim()}...` : line;
    }

    // Fallback: show a live snippet from the assistant's currently-streaming text.
    const lastAssistant = [...messages].reverse().find((msg) => msg.role === "assistant");
    if (lastAssistant) {
      const text = lastAssistant.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
      const trimmedText = (text || lastAssistant.content || "").trim();
      if (trimmedText) {
        const lines = trimmedText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        const line = (lines[lines.length - 1] ?? trimmedText).replace(/\s+/g, " ").trim();
        return line.length > MAX_SNIPPET_CHARS ? `${line.slice(0, MAX_SNIPPET_CHARS).trim()}...` : line;
      }
    }

    return "Working...";
  }, [
    elapsedSeconds,
    executingTools,
    isLoading,
    messages,
    streamStalled,
    thinkingStateContent,
    toolResultsMap,
  ]);
}

