// CRITICAL
"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useAppStore } from "@/store";

export interface UseStreamErrorToastArgs {
  streamError: string | null;
  currentSessionId: string | null;
  selectedModel: string;
  executingTools: Set<string>;
  lastEventTimeRef: MutableRefObject<number>;
  activeRunIdRef: MutableRefObject<string | null>;
}

export function useStreamErrorToast({
  streamError,
  currentSessionId,
  selectedModel,
  executingTools,
  lastEventTimeRef,
  activeRunIdRef,
}: UseStreamErrorToastArgs) {
  const pushToast = useAppStore((s) => s.pushToast);
  const elapsedSeconds = useAppStore((s) => s.elapsedSeconds);
  const lastPushedStreamErrorKeyRef = useRef<string>("");

  useEffect(() => {
    if (!streamError) return;
    const runId = activeRunIdRef.current ?? "unknown-run";
    const sessionId = currentSessionId ?? "unknown-session";
    const model = selectedModel || "unknown-model";
    const dedupeKey = `stream-error:${sessionId}:${runId}:${streamError}`;

    if (lastPushedStreamErrorKeyRef.current === dedupeKey) return;
    lastPushedStreamErrorKeyRef.current = dedupeKey;

    const detail = [
      `session_id: ${sessionId}`,
      `run_id: ${runId}`,
      `model: ${model}`,
      `elapsed_s: ${elapsedSeconds}`,
      `executing_tools: ${Array.from(executingTools).join(", ") || "(none)"}`,
      `last_event_ms_ago: ${
        lastEventTimeRef.current > 0 ? String(Date.now() - lastEventTimeRef.current) : "(unknown)"
      }`,
    ].join("\n");

    pushToast({
      kind: "error",
      title: "Stream error",
      message: streamError,
      detail,
      dedupeKey,
    });
  }, [
    activeRunIdRef,
    currentSessionId,
    elapsedSeconds,
    executingTools,
    lastEventTimeRef,
    pushToast,
    selectedModel,
    streamError,
  ]);
}

