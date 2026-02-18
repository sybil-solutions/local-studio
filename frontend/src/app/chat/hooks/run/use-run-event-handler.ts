// CRITICAL
"use client";

import { useCallback } from "react";
import type { ChatRunStreamEvent } from "@/lib/api";
import { useAppStore } from "@/store";
import { normalizePlanSteps } from "../../_components/agent/agent-types";
import type { RunMeta, UseRunEventHandlerArgs } from "./use-run-event-handler/types";

export function useRunEventHandler(args: UseRunEventHandlerArgs) {
  const {
    currentSessionId,
    currentSessionTitle,
    activeRunIdRef,
    lastEventTimeRef,
    runCompletedRef,
    lastUserInputRef,
    lastAssistantContentRef,
    setStreamStalled,
    setIsLoading,
    setStreamError,
    setAgentPlan,
    generateTitle,
    extractToolResultText,
    recordToolResult,
    updateExecutingTools,
    mapAgentMessageToChatMessage,
    upsertMessage,
    loadAgentFiles,
    readAgentFile,
    moveAgentFileVersions,
  } = args;

  return useCallback(
    (event: ChatRunStreamEvent) => {
      // Track last event time for stall detection.
      lastEventTimeRef.current = Date.now();
      setStreamStalled(false);

      const { event: eventType, data } = event;
      const runId = typeof data["run_id"] === "string" ? data["run_id"] : undefined;
      const turnIndex = typeof data["turn_index"] === "number" ? data["turn_index"] : undefined;
      const eventSessionId =
        typeof data["session_id"] === "string" ? data["session_id"] : undefined;
      const runMeta = runId || typeof turnIndex === "number" ? { runId, turnIndex } : undefined;

      if (!activeRunIdRef.current && runId) return;
      if (runId && activeRunIdRef.current && runId !== activeRunIdRef.current) return;
      if (!activeRunIdRef.current && !currentSessionId) return;
      if (eventSessionId && currentSessionId && eventSessionId !== currentSessionId) return;

      switch (eventType) {
        case "run_start": {
          setStreamError(null);
          useAppStore.getState().setLastRunDurationSeconds(null);
          if (typeof data["run_id"] === "string") {
            activeRunIdRef.current = data["run_id"];
          }
          return;
        }
        case "message_start":
        case "message_update":
        case "message_end": {
          const rawMessage = data["message"];
          if (!rawMessage || typeof rawMessage !== "object") return;
          const messageId = typeof data["message_id"] === "string" ? data["message_id"] : undefined;
          const mapped = mapAgentMessageToChatMessage(
            rawMessage as Record<string, unknown>,
            messageId,
            runMeta,
          );
          if (mapped) {
            upsertMessage(mapped);
          }
          return;
        }
        case "turn_end": {
          const rawMessage = data["message"];
          const messageId = typeof data["message_id"] === "string" ? data["message_id"] : undefined;
          if (rawMessage && typeof rawMessage === "object") {
            const mapped = mapAgentMessageToChatMessage(
              rawMessage as Record<string, unknown>,
              messageId,
              runMeta,
            );
            if (mapped) {
              upsertMessage(mapped);
              const assistantText = mapped.parts
                .filter((part) => part.type === "text")
                .map((part) => (part as { text: string }).text)
                .join("");
              const reasoningText = mapped.parts
                .filter((part) => part.type === "reasoning")
                .map((part) => (part as { text: string }).text)
                .join("");
              const contentForTitle = assistantText || reasoningText;
              if (contentForTitle) {
                lastAssistantContentRef.current = contentForTitle;
              }
            }
          }
          const toolResults = Array.isArray(data["toolResults"]) ? data["toolResults"] : [];
          for (const result of toolResults) {
            if (!result || typeof result !== "object") continue;
            const record = result as Record<string, unknown>;
            const toolCallId = typeof record["toolCallId"] === "string" ? record["toolCallId"] : "";
            if (!toolCallId) continue;
            const resultText = extractToolResultText(record["content"]);
            const isError = record["isError"] === true;
            recordToolResult(toolCallId, resultText, isError);
          }
          return;
        }
        case "tool_execution_start": {
          const toolCallId = typeof data["toolCallId"] === "string" ? data["toolCallId"] : "";
          if (!toolCallId) return;
          updateExecutingTools((prev) => new Set(prev).add(toolCallId));
          return;
        }
        case "tool_execution_end": {
          const toolCallId = typeof data["toolCallId"] === "string" ? data["toolCallId"] : "";
          if (!toolCallId) return;
          updateExecutingTools((prev) => {
            const next = new Set(prev);
            next.delete(toolCallId);
            return next;
          });
          const resultText = extractToolResultText(data["result"]);
          const isError = data["isError"] === true;
          recordToolResult(toolCallId, resultText, isError);
          return;
        }
        case "plan_updated": {
          const plan = data["plan"];
          if (!plan || typeof plan !== "object") return;
          const planRecord = plan as Record<string, unknown>;
          const steps = normalizePlanSteps(planRecord["steps"] ?? planRecord["tasks"]);
          if (steps.length === 0) return;
          setAgentPlan({
            steps,
            createdAt:
              typeof planRecord["createdAt"] === "number" ? planRecord["createdAt"] : Date.now(),
            updatedAt:
              typeof planRecord["updatedAt"] === "number" ? planRecord["updatedAt"] : Date.now(),
          });
          return;
        }
        case "agent_files_listed": {
          if (!eventSessionId) return;
          if (currentSessionId && eventSessionId !== currentSessionId) return;
          void loadAgentFiles({ sessionId: eventSessionId });
          return;
        }
        case "agent_file_written": {
          if (!eventSessionId) return;
          if (currentSessionId && eventSessionId !== currentSessionId) return;
          void loadAgentFiles({ sessionId: eventSessionId });
          const path = typeof data["path"] === "string" ? data["path"] : "";
          if (path) {
            void readAgentFile(path, eventSessionId).catch(() => {});
          }
          return;
        }
        case "agent_file_deleted":
        case "agent_directory_created": {
          if (!eventSessionId) return;
          if (currentSessionId && eventSessionId !== currentSessionId) return;
          void loadAgentFiles({ sessionId: eventSessionId });
          return;
        }
        case "agent_file_moved": {
          if (!eventSessionId) return;
          if (currentSessionId && eventSessionId !== currentSessionId) return;
          void loadAgentFiles({ sessionId: eventSessionId });
          const from = typeof data["from"] === "string" ? data["from"] : "";
          const to = typeof data["to"] === "string" ? data["to"] : "";
          if (from && to) {
            moveAgentFileVersions(from, to);
          }
          return;
        }
        case "run_end": {
          const runId = typeof data["run_id"] === "string" ? data["run_id"] : activeRunIdRef.current;
          activeRunIdRef.current = null;
          runCompletedRef.current = true;
          setIsLoading(false);

          // Always clear executing tools on run end — prevents stuck amber spinners.
          updateExecutingTools(() => new Set());

          // Persist the last run duration for UI (mobile wants "how long the agent loop took").
          const start = useAppStore.getState().streamingStartTime;
          if (typeof start === "number" && start > 0) {
            const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
            useAppStore.getState().setLastRunDurationSeconds(seconds);
            if (runId) {
              useAppStore.getState().setRunDurationForRunId(runId, seconds);
            }
          }

          if (data["status"] && data["status"] !== "completed") {
            setStreamError(typeof data["error"] === "string" ? data["error"] : "Run failed");
          }
          const titleSessionId = currentSessionId || eventSessionId;
          if (
            titleSessionId &&
            (currentSessionTitle === "New Chat" || currentSessionTitle === "Chat") &&
            lastUserInputRef.current
          ) {
            void generateTitle(
              titleSessionId,
              lastUserInputRef.current,
              lastAssistantContentRef.current || "",
            );
          }
          return;
        }
        default:
          return;
      }
    },
    [
      activeRunIdRef,
      currentSessionId,
      currentSessionTitle,
      extractToolResultText,
      generateTitle,
      lastAssistantContentRef,
      lastEventTimeRef,
      lastUserInputRef,
      loadAgentFiles,
      mapAgentMessageToChatMessage,
      moveAgentFileVersions,
      recordToolResult,
      readAgentFile,
      runCompletedRef,
      setAgentPlan,
      setIsLoading,
      setStreamError,
      setStreamStalled,
      updateExecutingTools,
      upsertMessage,
    ],
  );
}
