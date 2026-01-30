// CRITICAL
"use client";

import { useCallback, useEffect, useRef } from "react";
import { getApiKey } from "@/lib/api-key";
import api from "@/lib/api";
import type { AgentPlan } from "@/app/chat/_components/agent/agent-types";
import { normalizePlanSteps } from "@/app/chat/_components/agent/agent-types";
import type { AgentState, ChatSession, StoredMessage } from "@/lib/types";
import { useAppStore } from "@/store";

interface SSEPayload<T = unknown> {
  data: T;
  timestamp: string;
}

const normalizePlan = (value: unknown): AgentPlan | null => {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<AgentPlan> & { tasks?: unknown };
  const steps = normalizePlanSteps(plan.steps ?? plan.tasks);
  if (steps.length === 0) return null;
  return {
    steps,
    createdAt: typeof plan.createdAt === "number" ? plan.createdAt : Date.now(),
    updatedAt: typeof plan.updatedAt === "number" ? plan.updatedAt : Date.now(),
  };
};

const dispatchCustomEvent = (name: string, detail: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

export function useControllerEvents(
  apiBaseUrl: string =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.VLLM_STUDIO_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "/api/proxy",
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

  const upsertSession = useCallback(
    (session: ChatSession | null | undefined) => {
      if (!session || typeof session !== "object" || !session.id) return;
      updateSessions((prev) => {
        const filtered = prev.filter((item) => item.id !== session.id);
        return [session, ...filtered];
      });
      if (currentSessionId === session.id) {
        setCurrentSessionTitle(session.title || "Chat");
        const agentState = session.agent_state as AgentState | null | undefined;
        const plan = normalizePlan(agentState?.plan)
          ?? (agentState?.tasks ? normalizePlan({ steps: agentState.tasks }) : null)
          ?? normalizePlan(agentState);
        setAgentPlan(plan);
      }
    },
    [currentSessionId, setAgentPlan, setCurrentSessionTitle, updateSessions],
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
              if (currentSessionId === sessionId) {
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
            if (sessionId && currentSessionId === sessionId && message) {
              dispatchCustomEvent("vllm:chat-event", { type: eventType, data });
            }
            break;
          }
          case "chat_usage_updated": {
            const usage = data["usage"] as Record<string, number> | undefined;
            const sessionId = String(data["session_id"] ?? "");
            if (usage && sessionId && currentSessionId === sessionId) {
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
            if (sessionId && currentSessionId === sessionId) {
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
            if (sessionId && currentSessionId === sessionId) {
              refreshAgentFiles(sessionId);
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
      currentSessionId,
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

    const eventTypes = [
      "status",
      "gpu",
      "metrics",
      "launch_progress",
      "download_progress",
      "download_state",
      "temporal_status",
      "chat_session_created",
      "chat_session_updated",
      "chat_session_deleted",
      "chat_session_forked",
      "chat_session_compacted",
      "chat_message_upserted",
      "chat_usage_updated",
      "agent_files_listed",
      "agent_file_read",
      "agent_file_written",
      "agent_file_deleted",
      "agent_directory_created",
      "agent_file_moved",
      "recipe_created",
      "recipe_updated",
      "recipe_deleted",
      "mcp_server_created",
      "mcp_server_updated",
      "mcp_server_deleted",
      "mcp_server_enabled",
      "mcp_server_disabled",
      "mcp_tool_called",
      "runtime_vllm_upgraded",
    ];

    for (const type of eventTypes) {
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
