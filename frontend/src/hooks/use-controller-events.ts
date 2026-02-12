// CRITICAL
"use client";

import { useCallback, useEffect, useRef } from "react";
import { getApiKey } from "@/lib/api-key";
import api from "@/lib/api";
import { resolveControllerEventsBaseUrl } from "@/lib/backend-config";
import type { AgentState, ChatSession, StoredMessage } from "@/lib/types";
import { useAppStore } from "@/store";
import { CONTROLLER_EVENT_TYPES } from "./use-controller-events/event-types";
import { dispatchCustomEvent, normalizePlan } from "./use-controller-events/helpers";

interface SSEPayload<T = unknown> {
  data: T;
  timestamp: string;
}

export function useControllerEvents(
  apiBaseUrl: string = resolveControllerEventsBaseUrl(),
) {
  const updateSessions = useAppStore((state) => state.updateSessions);
  const setCurrentSessionId = useAppStore((state) => state.setCurrentSessionId);
  const setCurrentSessionTitle = useAppStore((state) => state.setCurrentSessionTitle);
  const setSessionUsage = useAppStore((state) => state.setSessionUsage);
  const setAgentPlan = useAppStore((state) => state.setAgentPlan);
  const setAgentFiles = useAppStore((state) => state.setAgentFiles);
  const setAgentFilesLoading = useAppStore((state) => state.setAgentFilesLoading);
  const currentSessionId = useAppStore((state) => state.currentSessionId);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const upsertSession = useCallback(
    (session: ChatSession | null | undefined) => {
      if (!session || typeof session !== "object" || !session.id) return;
      updateSessions((prev) => {
        const filtered = prev.filter((item) => item.id !== session.id);
        return [session, ...filtered];
      });
      if (currentSessionIdRef.current === session.id) {
        setCurrentSessionTitle(session.title || "Chat");
        const agentState = session.agent_state as AgentState | null | undefined;
        const plan = normalizePlan(agentState?.plan)
          ?? (agentState?.tasks ? normalizePlan({ steps: agentState.tasks }) : null)
          ?? normalizePlan(agentState);
        setAgentPlan(plan);
      }
    },
    [setAgentPlan, setCurrentSessionTitle, updateSessions],
  );

  const refreshAgentFiles = useCallback(
    (sessionId: string) => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(async () => {
        setAgentFilesLoading(true);
        try {
          const data = await api.getAgentFiles(sessionId, { recursive: true });
          const files = Array.isArray(data.files) ? data.files : [];
          setAgentFiles(files);
        } catch {
          setAgentFiles([]);
        } finally {
          setAgentFilesLoading(false);
          refreshTimerRef.current = null;
        }
      }, 150);
    },
    [setAgentFiles, setAgentFilesLoading],
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as SSEPayload<Record<string, unknown>>;
        const eventType = (event as { type?: string }).type || "message";
        const data = payload.data ?? {};
        const currentId = currentSessionIdRef.current;

        switch (eventType) {
          case "chat_session_created":
          case "chat_session_updated":
          case "chat_session_forked":
          case "chat_session_compacted": {
            const session = (data["session"] ?? null) as ChatSession | null;
            upsertSession(session);
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "chat_session_deleted": {
            const sessionId = String(data["session_id"] ?? "");
            if (sessionId) {
              updateSessions((prev) => prev.filter((item) => item.id !== sessionId));
              if (currentId === sessionId) {
                setCurrentSessionId(null);
                setCurrentSessionTitle("New Chat");
                setAgentPlan(null);
                setAgentFiles([]);
              }
            }
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "chat_message_upserted": {
            const session = (data["session"] ?? null) as ChatSession | null;
            const message = data["message"] as StoredMessage | undefined;
            const sessionId = String(data["session_id"] ?? "");
            if (session) {
              upsertSession(session);
            }
            if (sessionId && currentId === sessionId && message) {
              dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            }
            break;
          }
          case "chat_usage_updated": {
            const usage = data["usage"] as Record<string, number> | undefined;
            const sessionId = String(data["session_id"] ?? "");
            if (usage && sessionId && currentId === sessionId) {
              setSessionUsage({
                prompt_tokens: Number(usage["prompt_tokens"] ?? 0),
                completion_tokens: Number(usage["completion_tokens"] ?? 0),
                total_tokens: Number(usage["total_tokens"] ?? 0),
                estimated_cost: typeof usage["estimated_cost_usd"] === "number" ? usage["estimated_cost_usd"] : null,
              });
            }
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "agent_files_listed": {
            const sessionId = String(data["session_id"] ?? "");
            if (sessionId && currentId === sessionId) {
              const files = Array.isArray(data["files"]) ? data["files"] : [];
              setAgentFiles(files);
            }
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "agent_file_read": {
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "agent_file_written":
          case "agent_file_deleted":
          case "agent_directory_created":
          case "agent_file_moved": {
            const sessionId = String(data["session_id"] ?? "");
            if (sessionId && currentId === sessionId) {
              refreshAgentFiles(sessionId);
            }
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "agent_plan_updated": {
            const sessionId = String(data["session_id"] ?? "");
            const plan = normalizePlan(data["plan"]);
            if (sessionId && currentId === sessionId) {
              setAgentPlan(plan);
            }
            dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            break;
          }
          case "recipe_created":
          case "recipe_updated":
          case "recipe_deleted": {
            dispatchCustomEvent("vllm:recipe-event", { type: eventType, data });
            break;
          }
          case "mcp_server_created":
          case "mcp_server_updated":
          case "mcp_server_deleted":
          case "mcp_server_enabled":
          case "mcp_server_disabled":
          case "mcp_tool_called": {
            dispatchCustomEvent("vllm:mcp-event", { type: eventType, data });
            break;
          }
          case "runtime_vllm_upgraded": {
            dispatchCustomEvent("vllm:runtime-event", { type: eventType, data });
            break;
          }
          case "status":
          case "gpu":
          case "metrics":
          case "launch_progress":
          case "download_progress":
          case "download_state":
          case "temporal_status": {
            dispatchCustomEvent("vllm:controller-event", { type: eventType, data });
            break;
          }
          default:
            break;
        }
      } catch (err) {
        console.error("[Controller SSE] Failed to parse event:", err);
      }
    },
    [
      refreshAgentFiles,
      setAgentFiles,
      setAgentPlan,
      setCurrentSessionId,
      setCurrentSessionTitle,
      setSessionUsage,
      updateSessions,
      upsertSession,
    ],
  );

  const apiKey = getApiKey();
  const sseUrl = apiKey ? `${apiBaseUrl}/events?api_key=${encodeURIComponent(apiKey)}` : `${apiBaseUrl}/events`;

  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    for (const type of CONTROLLER_EVENT_TYPES) {
      es.addEventListener(type, (event) => handleMessage(event as MessageEvent));
    }

    es.onmessage = (event) => handleMessage(event as MessageEvent);

    return () => {
      es.close();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [handleMessage, sseUrl]);
}
