// CRITICAL
"use client";

import { useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import api, { type ChatRunStreamEvent } from "@/lib/api";
import type { ToolResult } from "@/lib/types";

export interface ChatRunStreamPayload {
  content: string;
  message_id: string;
  model?: string;
  provider?: string;
  system?: string;
  mcp_enabled?: boolean;
  agent_mode?: boolean;
  agent_files?: boolean;
  deep_research?: boolean;
  thinking_level?: string;
}

export interface UseChatRunStreamArgs {
  activeRunIdRef: MutableRefObject<string | null>;
  runAbortControllerRef: MutableRefObject<AbortController | null>;
  runCompletedRef: MutableRefObject<boolean>;
  lastEventTimeRef: MutableRefObject<number>;
  sessionIdRef: MutableRefObject<string | null>;
  setIsLoading: (value: boolean) => void;
  setStreamError: (value: string | null) => void;
  setStreamStalled: (value: boolean) => void;
  setExecutingTools: (value: Set<string>) => void;
  setToolResultsMap: (value: Map<string, ToolResult>) => void;
  handleRunEvent: (event: ChatRunStreamEvent) => void;
}

export function useChatRunStream({
  activeRunIdRef,
  runAbortControllerRef,
  runCompletedRef,
  lastEventTimeRef,
  sessionIdRef,
  setIsLoading,
  setStreamError,
  setStreamStalled,
  setExecutingTools,
  setToolResultsMap,
  handleRunEvent,
}: UseChatRunStreamArgs) {
  useEffect(() => {
    return () => {
      runAbortControllerRef.current?.abort();
      const runId = activeRunIdRef.current;
      const sessionId = sessionIdRef.current;
      if (runId && sessionId) {
        void api.abortChatRun(sessionId, runId).catch(() => {});
      }
      activeRunIdRef.current = null;
    };
  }, []);

  const startRunStream = useCallback(
    async (sessionId: string, payload: ChatRunStreamPayload) => {
      if (runAbortControllerRef.current) {
        runAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      runAbortControllerRef.current = abortController;
      runCompletedRef.current = false;
      lastEventTimeRef.current = Date.now();
      setIsLoading(true);
      setStreamError(null);
      setStreamStalled(false);
      setExecutingTools(new Set());
      setToolResultsMap(new Map<string, ToolResult>());

      try {
        const { runId, stream } = await api.streamChatRun(sessionId, payload, {
          signal: abortController.signal,
        });
        if (runId) {
          activeRunIdRef.current = runId;
        }
        for await (const event of stream) {
          handleRunEvent(event);
        }
      } catch (err) {
        if (!abortController.signal.aborted && !runCompletedRef.current) {
          const message = err instanceof Error ? err.message : String(err);
          setStreamError(message);
        }
      } finally {
        runAbortControllerRef.current = null;
        setIsLoading(false);
      }
    },
    [
      activeRunIdRef,
      handleRunEvent,
      lastEventTimeRef,
      runAbortControllerRef,
      runCompletedRef,
      setExecutingTools,
      setIsLoading,
      setStreamError,
      setStreamStalled,
      setToolResultsMap,
    ],
  );

  return { startRunStream };
}
