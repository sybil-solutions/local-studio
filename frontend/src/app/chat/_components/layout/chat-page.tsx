// CRITICAL
"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, type ChatRunStreamEvent } from "@/lib/api";
import { safeJsonStringify } from "@/lib/safe-json";
import { createUuid } from "@/lib/uuid";
import { extractArtifacts } from "../artifacts/artifact-renderer";
import { ArtifactModal } from "../artifacts/artifact-modal";
import { ArtifactPreviewPanel } from "../artifacts/artifact-preview-panel";
import { ToolBelt } from "../input/tool-belt";
import { ChatConversation } from "./chat-conversation";
import { ChatTopControls } from "./chat-top-controls";
import { ChatActionButtons } from "./chat-action-buttons";
import { ChatToolbeltDock } from "./chat-toolbelt-dock";
import { ChatModals } from "./chat-modals";
import * as Hooks from "../../hooks";
import type {
  Artifact,
  ChatMessage,
  ChatMessageMetadata,
  ChatMessagePart,
  ChatSessionDetail,
  StoredMessage,
  StoredToolCall,
  ToolResult,
} from "@/lib/types";
import { useContextManagement, type CompactionEvent } from "@/lib/services/context-management";
import { useMessageParsing } from "@/lib/services/message-parsing";
import { useAppStore } from "@/store";
import type { Attachment } from "../../types";
import { stripThinkingForModelContext, tryParseNestedJsonString } from "../../utils";

import { AgentPlanDrawer } from "../agent/agent-plan-drawer";
import { AgentFilesPanel } from "../agent/agent-files-panel";
import { normalizePlanSteps } from "../agent/agent-types";
import { UnifiedSidebar, type SidebarTab } from "./unified-sidebar";
import { ActivityPanel, ContextPanel } from "./chat-side-panel";
import { buildAgentModeSystemPrompt } from "../../utils/agent-system-prompt";

type UploadedAttachment = {
  name: string;
  path: string;
  size: number;
  type: Attachment["type"];
  encoding: "utf8" | "base64";
};

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/csv",
  "application/markdown",
]);

const TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".yaml",
  ".yml",
  ".log",
];

const sanitizeAttachmentName = (value: string): string => {
  const cleaned = value.replace(/[\\/]/g, "_").replace(/[^\w.\-]+/g, "_");
  const normalized = cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "attachment";
};

const isTextAttachment = (attachment: Attachment): boolean => {
  const file = attachment.file;
  if (!file) return false;
  const type = file.type.toLowerCase();
  if (type.startsWith("text/")) return true;
  if (TEXT_MIME_TYPES.has(type)) return true;
  const name = attachment.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
};

const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",") ? result.split(",")[1] ?? "" : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
};

const readAttachmentContent = async (
  attachment: Attachment,
): Promise<{ content: string; encoding: "utf8" | "base64" }> => {
  if (attachment.type === "image" || attachment.type === "audio") {
    if (attachment.base64) {
      return { content: attachment.base64, encoding: "base64" };
    }
    if (!attachment.file) {
      throw new Error("Attachment file missing");
    }
    const base64 = await readFileAsBase64(attachment.file);
    return { content: base64, encoding: "base64" };
  }

  if (!attachment.file) {
    throw new Error("Attachment file missing");
  }

  if (isTextAttachment(attachment)) {
    const content = await attachment.file.text();
    return { content, encoding: "utf8" };
  }

  const base64 = await readFileAsBase64(attachment.file);
  return { content: base64, encoding: "base64" };
};

const buildAttachmentsBlock = (attachments: UploadedAttachment[]): string => {
  if (attachments.length === 0) return "";
  const lines: string[] = [];
  lines.push("<attachments>");
  lines.push("The user uploaded files into the agent filesystem for this run.");
  lines.push("Use read_file/list_files to access them.");
  for (const attachment of attachments) {
    lines.push(`- name: ${attachment.name}`);
    lines.push(`  path: ${attachment.path}`);
    lines.push(`  type: ${attachment.type}`);
    lines.push(`  size: ${attachment.size} bytes`);
    if (attachment.encoding === "base64") {
      lines.push("  encoding: base64 (decode before interpreting)");
    }
  }
  lines.push("</attachments>");
  return lines.join("\n");
};

const buildRunSystemPrompt = (basePrompt: string, attachmentsBlock?: string): string | undefined => {
  const trimmed = basePrompt.trim();
  const blocks = [trimmed, attachmentsBlock?.trim()].filter((block) => block && block.length > 0) as string[];
  if (blocks.length === 0) return undefined;
  return blocks.join("\n\n");
};

export function ChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionFromUrl = searchParams.get("session");
  const newChatFromUrl = searchParams.get("new") === "1";

  const LAST_SESSION_STORAGE_KEY = "vllm-studio-last-session-id";
  const getLastSessionId = (): string | null => {
    if (typeof window === "undefined") return null;
    try {
      const value = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
      return value && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  };

  const setLastSessionId = (sessionId: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, sessionId);
    } catch {
      // ignore
    }
  };

  // Local UI state (sourced from Zustand)
  const input = useAppStore((state) => state.input);
  const setInput = useAppStore((state) => state.setInput);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const systemPrompt = useAppStore((state) => state.systemPrompt);
  const setSystemPrompt = useAppStore((state) => state.setSystemPrompt);
  const mcpEnabled = useAppStore((state) => state.mcpEnabled);
  const setMcpEnabled = useAppStore((state) => state.setMcpEnabled);
  const artifactsEnabled = useAppStore((state) => state.artifactsEnabled);
  const setArtifactsEnabled = useAppStore((state) => state.setArtifactsEnabled);
  const activeArtifactId = useAppStore((state) => state.activeArtifactId);
  const setActiveArtifactId = useAppStore((state) => state.setActiveArtifactId);
  const deepResearch = useAppStore((state) => state.deepResearch);
  const setDeepResearch = useAppStore((state) => state.setDeepResearch);
  const elapsedSeconds = useAppStore((state) => state.elapsedSeconds);
  const setElapsedSeconds = useAppStore((state) => state.setElapsedSeconds);
  const streamingStartTime = useAppStore((state) => state.streamingStartTime);
  const setStreamingStartTime = useAppStore((state) => state.setStreamingStartTime);
  const queuedContext = useAppStore((state) => state.queuedContext);
  const setQueuedContext = useAppStore((state) => state.setQueuedContext);
  const userScrolledUp = useAppStore((state) => state.userScrolledUp);
  const setUserScrolledUp = useAppStore((state) => state.setUserScrolledUp);

  // Modal state (Zustand)
  const settingsOpen = useAppStore((state) => state.chatSettingsOpen);
  const setSettingsOpen = useAppStore((state) => state.setChatSettingsOpen);
  const mcpSettingsOpen = useAppStore((state) => state.mcpSettingsOpen);
  const setMcpSettingsOpen = useAppStore((state) => state.setMcpSettingsOpen);
  const usageOpen = useAppStore((state) => state.usageDetailsOpen);
  const setUsageOpen = useAppStore((state) => state.setUsageDetailsOpen);
  const exportOpen = useAppStore((state) => state.exportOpen);
  const setExportOpen = useAppStore((state) => state.setExportOpen);
  const availableModels = useAppStore((state) => state.availableModels);
  const setAvailableModels = useAppStore((state) => state.setAvailableModels);
  const sessionUsage = useAppStore((state) => state.sessionUsage);
  const setExecutingTools = useAppStore((state) => state.setExecutingTools);
  const updateExecutingTools = useAppStore((state) => state.updateExecutingTools);
  const setToolResultsMap = useAppStore((state) => state.setToolResultsMap);
  const updateToolResultsMap = useAppStore((state) => state.updateToolResultsMap);

  // Agent mode
  const agentMode = useAppStore((state) => state.agentMode);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const agentPlan = useAppStore((state) => state.agentPlan);
  const setAgentPlan = useAppStore((state) => state.setAgentPlan);

  const {
    agentFiles,
    loadAgentFiles,
    clearAgentFiles,
    selectedAgentFilePath,
    selectedAgentFileContent,
    selectedAgentFileLoading,
    selectAgentFile,
    clearSelectedFile,
  } = Hooks.useAgentFiles();

  // Sidebar width from store
  const sidebarWidth = useAppStore((state) => state.sidebarWidth);
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth);

  const { hydrateAgentState, persistAgentState, buildAgentState } = Hooks.useAgentState();

  const effectiveSystemPrompt = useMemo(() => {
    const base = systemPrompt.trim();
    if (!agentMode) return base;
    const agentBlock = buildAgentModeSystemPrompt(agentPlan);
    return base ? `${base}\n\n${agentBlock}` : agentBlock;
  }, [systemPrompt, agentMode, agentPlan]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesLengthRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const runCompletedRef = useRef(false);

  // Sessions hook
  const {
    currentSessionId,
    currentSessionTitle,
    loadSessions,
    loadSession,
    startNewSession,
    createSession,
    setCurrentSessionId,
    setCurrentSessionTitle,
  } = Hooks.useChatSessions();

  // Tools hook
  const {
    mcpServers,
    mcpTools,
    loadMCPServers,
    loadMCPTools,
    getToolDefinitions,
    executingTools,
    toolResultsMap,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
  } = Hooks.useChatTools({ mcpEnabled });

  // Ref to avoid contextStats recalculating when getToolDefinitions changes
  const getToolDefinitionsRef = useRef(getToolDefinitions);
  useEffect(() => {
    getToolDefinitionsRef.current = getToolDefinitions;
  }, [getToolDefinitions]);

  // Usage hook
  const { refreshUsage } = Hooks.useChatUsage();

  const sessionIdRef = useRef<string | null>(currentSessionId);
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

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

  const {
    calculateStats,
    formatTokenCount,
    calculateMessageTokens,
    estimateTokens,
    config: contextConfig,
  } = useContextManagement();
  const { parseThinking } = useMessageParsing();
  const updateSessions = useAppStore((state) => state.updateSessions);

  // Track the last user input for title generation
  const lastUserInputRef = useRef<string>("");
  const lastAssistantContentRef = useRef<string>("");
  const [compactionHistory, setCompactionHistory] = useState<CompactionEvent[]>([]);
  const [compacting, setCompacting] = useState(false);
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const lastCompactionSignatureRef = useRef<string | null>(null);

  const mapStoredToolCalls = useCallback((toolCalls?: StoredToolCall[]): ChatMessagePart[] => {
    if (!toolCalls?.length) return [];
    return toolCalls.map((tc) => {
      const name = tc.function?.name || "tool";
      const args = tc.function?.arguments;
      const input = typeof args === "string" ? (tryParseNestedJsonString(args) ?? args) : args;
      const result = tc.result as { content?: unknown; isError?: boolean } | string | undefined;
      const hasResult = result != null;
      const isError = typeof result === "object" && result?.isError === true;
      const content = typeof result === "object" ? (result?.content ?? result) : result;

      return {
        type: tc.dynamic ? "dynamic-tool" : `tool-${name}`,
        toolName: tc.dynamic ? name : undefined,
        toolCallId: tc.id,
        state: hasResult ? (isError ? "output-error" : "output-available") : "input-available",
        input,
        output: isError ? undefined : content,
        errorText: isError
          ? typeof content === "string"
            ? content
            : safeJsonStringify(content, "")
          : undefined,
        providerExecuted: tc.providerExecuted,
      };
    });
  }, []);

  const mapStoredMessages = useCallback(
    (storedMessages: StoredMessage[]) => {
      return storedMessages.map((message) => {
        const storedParts = message.parts as ChatMessagePart[] | undefined;
        const hasStoredParts = Array.isArray(storedParts) && storedParts.length > 0;
        const parts: ChatMessagePart[] = hasStoredParts ? [...storedParts] : [];

        if (!hasStoredParts && message.content) {
          parts.push({ type: "text", text: message.content });
        }

        if (!hasStoredParts) {
          const toolParts = mapStoredToolCalls(message.tool_calls);
          for (const toolPart of toolParts) {
            parts.push(toolPart);
          }
        }

        const inputTokens = message.prompt_tokens ?? undefined;
        const outputTokens = message.completion_tokens ?? undefined;
        const totalTokens =
          message.total_tokens ??
          (inputTokens != null || outputTokens != null
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined);

        const metadata = message.metadata as ChatMessageMetadata | undefined;

        return {
          id: message.id,
          role: message.role,
          parts,
          metadata: metadata ?? {
            model: message.model,
            usage:
              inputTokens != null || outputTokens != null || totalTokens != null
                ? {
                    inputTokens,
                    outputTokens,
                    totalTokens,
                  }
                : undefined,
          },
          model: message.model,
          tool_calls: message.tool_calls,
          content: message.content,
          created_at: (message as { created_at?: string }).created_at,
        } satisfies ChatMessage;
      });
    },
    [mapStoredToolCalls],
  );

  const isToolPart = useCallback(
    (part: ChatMessagePart): part is Extract<ChatMessagePart, { toolCallId: string }> =>
      part.type === "dynamic-tool" ||
      (typeof part.type === "string" && part.type.startsWith("tool-")),
    [],
  );

  const mergeToolParts = useCallback(
    (previous: ChatMessagePart[], next: ChatMessagePart[]) => {
      if (previous.length === 0) return next;
      const previousById = new Map<string, Extract<ChatMessagePart, { toolCallId: string }>>();
      for (const part of previous) {
        if (isToolPart(part)) {
          previousById.set(part.toolCallId, part);
        }
      }
      return next.map((part) => {
        if (!isToolPart(part)) return part;
        const prior = previousById.get(part.toolCallId);
        if (!prior) return part;
        const merged = {
          ...prior,
          ...part,
          input: part.input ?? (prior as { input?: unknown }).input,
          output: part.output ?? (prior as { output?: unknown }).output,
          errorText: part.errorText ?? (prior as { errorText?: string }).errorText,
          state: part.state ?? (prior as { state?: string }).state,
          toolName: part.toolName ?? (prior as { toolName?: string }).toolName,
          providerExecuted:
            part.providerExecuted ?? (prior as { providerExecuted?: boolean }).providerExecuted,
        } satisfies Extract<ChatMessagePart, { toolCallId: string }>;
        return merged;
      });
    },
    [isToolPart],
  );

  const mapAgentContentToParts = useCallback((content: unknown): ChatMessagePart[] => {
    if (typeof content === "string") {
      return content.trim() ? [{ type: "text", text: content }] : [];
    }
    if (!Array.isArray(content)) return [];
    const parts: ChatMessagePart[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      const type = record["type"];
      if (type === "text") {
        const text = typeof record["text"] === "string" ? record["text"] : "";
        if (text) parts.push({ type: "text", text });
        continue;
      }
      if (type === "thinking") {
        const thinking = typeof record["thinking"] === "string" ? record["thinking"] : "";
        if (thinking) parts.push({ type: "reasoning", text: thinking });
        continue;
      }
      if (type === "toolCall") {
        const toolCallId = typeof record["id"] === "string" ? record["id"] : "";
        if (!toolCallId) continue;
        parts.push({
          type: "dynamic-tool",
          toolCallId,
          toolName: typeof record["name"] === "string" ? record["name"] : "tool",
          input: record["arguments"] ?? {},
          state: "input-available",
        });
      }
    }
    return parts;
  }, []);

  const mapUserContentToParts = useCallback((content: unknown): ChatMessagePart[] => {
    if (typeof content === "string") {
      return content.trim() ? [{ type: "text", text: content }] : [];
    }
    if (!Array.isArray(content)) return [];
    const parts: ChatMessagePart[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      if (record["type"] === "text") {
        const text = typeof record["text"] === "string" ? record["text"] : "";
        if (text) parts.push({ type: "text", text });
      } else if (record["type"] === "image") {
        parts.push({ type: "text", text: "[Image]" });
      }
    }
    return parts;
  }, []);

  const buildMetadataFromAgent = useCallback((message: Record<string, unknown>): ChatMessageMetadata | undefined => {
    const model = typeof message["model"] === "string" ? message["model"] : undefined;
    const usage = message["usage"] as Record<string, unknown> | undefined;
    const input = typeof usage?.["input"] === "number" ? usage["input"] : undefined;
    const output = typeof usage?.["output"] === "number" ? usage["output"] : undefined;
    const total = typeof usage?.["totalTokens"] === "number" ? usage["totalTokens"] : undefined;
    if (model || input != null || output != null || total != null) {
      return {
        model,
        usage:
          input != null || output != null || total != null
            ? { inputTokens: input, outputTokens: output, totalTokens: total }
            : undefined,
      };
    }
    return undefined;
  }, []);

  const mapAgentMessageToChatMessage = useCallback(
    (rawMessage: Record<string, unknown>, messageId?: string): ChatMessage | null => {
      const role = rawMessage["role"];
      if (role !== "user" && role !== "assistant") return null;
      const id = messageId
        ?? (typeof rawMessage["id"] === "string" ? rawMessage["id"] : createUuid());
      const content = rawMessage["content"];
      const parts = role === "assistant"
        ? mapAgentContentToParts(content)
        : mapUserContentToParts(content);
      const metadata =
        role === "assistant"
          ? buildMetadataFromAgent(rawMessage)
          : (rawMessage["metadata"] as ChatMessageMetadata | undefined);
      return {
        id,
        role,
        parts,
        metadata,
      };
    },
    [buildMetadataFromAgent, mapAgentContentToParts, mapUserContentToParts],
  );

  const upsertMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prev) => {
        const index = prev.findIndex((entry) => entry.id === message.id);
        if (index === -1) {
          return [...prev, message];
        }
        const existing = prev[index];
        const mergedParts = mergeToolParts(existing.parts, message.parts);
        const mergedMetadata = message.metadata
          ? { ...(existing.metadata ?? {}), ...message.metadata }
          : existing.metadata;
        const updated: ChatMessage = {
          ...existing,
          ...message,
          parts: mergedParts,
          metadata: mergedMetadata,
          tool_calls: message.tool_calls ?? existing.tool_calls,
          content: message.content ?? existing.content,
        };
        return [...prev.slice(0, index), updated, ...prev.slice(index + 1)];
      });
    },
    [mergeToolParts],
  );

  const extractToolResultText = useCallback((result: unknown): string => {
    if (result == null) return "";
    if (typeof result === "string") return result;
    if (Array.isArray(result)) {
      return result
        .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>)["type"] === "text")
        .map((item) => String((item as Record<string, unknown>)["text"] ?? ""))
        .join("\n");
    }
    if (typeof result === "object") {
      const record = result as Record<string, unknown>;
      if (Array.isArray(record["content"])) {
        return extractToolResultText(record["content"]);
      }
      if (typeof record["text"] === "string") {
        return record["text"];
      }
      return safeJsonStringify(record, "");
    }
    return String(result);
  }, []);

  const applyToolResultToMessages = useCallback(
    (toolCallId: string, resultText: string, isError: boolean) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.role !== "assistant") return msg;
          let updated = false;
          const parts = msg.parts.map((part) => {
            if (!isToolPart(part) || part.toolCallId !== toolCallId) return part;
            updated = true;
            return {
              ...part,
              state: isError ? "output-error" : "output-available",
              output: isError ? undefined : resultText,
              errorText: isError ? resultText : undefined,
            } as ChatMessagePart;
          });
          return updated ? { ...msg, parts } : msg;
        }),
      );
    },
    [isToolPart],
  );

  const recordToolResult = useCallback(
    (toolCallId: string, resultText: string, isError: boolean) => {
      updateToolResultsMap((prev) => {
        const next = new Map(prev);
        const payload: ToolResult = {
          tool_call_id: toolCallId,
          content: resultText,
          isError,
        };
        next.set(toolCallId, payload);
        return next;
      });
      applyToolResultToMessages(toolCallId, resultText, isError);
    },
    [applyToolResultToMessages, updateToolResultsMap],
  );

  const generateTitle = useCallback(
    async (sessionId: string, userContent: string, assistantContent: string) => {
      try {
        const res = await fetch("/api/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            user: userContent,
            assistant: assistantContent,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.title && data.title !== "New Chat") {
            await api.updateChatSession(sessionId, { title: data.title });
            setCurrentSessionTitle(data.title);
            updateSessions((sessions) =>
              sessions.map((session) =>
                session.id === sessionId ? { ...session, title: data.title } : session,
              ),
            );
            return data.title;
          }
        }
      } catch (err) {
        console.error("Failed to generate title:", err);
      }
      return null;
    },
    [selectedModel, setCurrentSessionTitle, updateSessions],
  );

  const handleRunEvent = useCallback(
    (event: ChatRunStreamEvent) => {
      const { event: eventType, data } = event;

      switch (eventType) {
        case "run_start": {
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
          const mapped = mapAgentMessageToChatMessage(rawMessage as Record<string, unknown>, messageId);
          if (mapped) {
            upsertMessage(mapped);
          }
          return;
        }
        case "turn_end": {
          const rawMessage = data["message"];
          const messageId = typeof data["message_id"] === "string" ? data["message_id"] : undefined;
          if (rawMessage && typeof rawMessage === "object") {
            const mapped = mapAgentMessageToChatMessage(rawMessage as Record<string, unknown>, messageId);
            if (mapped) {
              upsertMessage(mapped);
              const assistantText = mapped.parts
                .filter((part) => part.type === "text")
                .map((part) => (part as { text: string }).text)
                .join("");
              if (assistantText) {
                lastAssistantContentRef.current = assistantText;
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
            createdAt: typeof planRecord["createdAt"] === "number" ? planRecord["createdAt"] : Date.now(),
            updatedAt: typeof planRecord["updatedAt"] === "number" ? planRecord["updatedAt"] : Date.now(),
          });
          return;
        }
        case "agent_files_listed": {
          if (typeof data["session_id"] === "string" && data["session_id"] === currentSessionId) {
            void loadAgentFiles({ sessionId: currentSessionId });
          }
          return;
        }
        case "agent_file_written":
        case "agent_file_deleted":
        case "agent_directory_created":
        case "agent_file_moved": {
          if (typeof data["session_id"] === "string" && data["session_id"] === currentSessionId) {
            void loadAgentFiles({ sessionId: currentSessionId });
          }
          return;
        }
        case "run_end": {
          activeRunIdRef.current = null;
          runCompletedRef.current = true;
          setIsLoading(false);
          if (data["status"] && data["status"] !== "completed") {
            setStreamError(typeof data["error"] === "string" ? data["error"] : "Run failed");
          }
          if (
            currentSessionId &&
            (currentSessionTitle === "New Chat" || currentSessionTitle === "Chat") &&
            lastUserInputRef.current &&
            lastAssistantContentRef.current
          ) {
            void generateTitle(
              currentSessionId,
              lastUserInputRef.current,
              lastAssistantContentRef.current,
            );
          }
          return;
        }
        default:
          return;
      }
    },
    [
      currentSessionId,
      currentSessionTitle,
      extractToolResultText,
      generateTitle,
      loadAgentFiles,
      mapAgentMessageToChatMessage,
      recordToolResult,
      setAgentPlan,
      setIsLoading,
      setStreamError,
      updateExecutingTools,
      upsertMessage,
    ],
  );

  const clearPlan = useCallback(() => {
    setAgentPlan(null);
    if (currentSessionId) {
      void persistAgentState(currentSessionId, buildAgentState(null));
    }
  }, [buildAgentState, currentSessionId, persistAgentState, setAgentPlan]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ type?: string; data?: Record<string, unknown> }>;
      const type = custom.detail?.type;
      const data = custom.detail?.data ?? {};
      if (!type || !data) return;

      switch (type) {
        case "chat_message_upserted": {
          const sessionId = String(data["session_id"] ?? "");
          if (!currentSessionId || sessionId !== currentSessionId) return;
          const message = data["message"] as StoredMessage | undefined;
          if (!message) return;
          const mapped = mapStoredMessages([message])[0];
          if (!mapped) return;
          const current = messagesRef.current;
          const index = current.findIndex((entry) => entry.id === mapped.id);
          const next =
            index >= 0
              ? [...current.slice(0, index), mapped, ...current.slice(index + 1)]
              : [...current, mapped];
          setMessages(next);
          break;
        }
        case "chat_session_deleted": {
          const sessionId = String(data["session_id"] ?? "");
          if (currentSessionId && sessionId === currentSessionId) {
            setMessages([]);
            startNewSession();
          }
          break;
        }
        case "chat_session_updated": {
          const sessionId = String(data["session_id"] ?? "");
          if (currentSessionId && sessionId === currentSessionId) {
            const session = data["session"] as Record<string, unknown> | undefined;
            if (session) {
              hydrateAgentState(session as unknown as ChatSessionDetail);
            }
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("vllm:chat-event", handler as EventListener);
    return () => {
      window.removeEventListener("vllm:chat-event", handler as EventListener);
    };
  }, [currentSessionId, hydrateAgentState, mapStoredMessages, setMessages, startNewSession]);

  // Derived state from messages
  const { thinkingActive, activityGroups } = Hooks.useChatDerived({
    messages,
    isLoading,
    executingTools,
    toolResultsMap,
  });

  const activityCount = useMemo(() => {
    return activityGroups.reduce((sum, group) => sum + group.items.length, 0);
  }, [activityGroups]);

  const selectedModelMeta = useMemo(
    () => availableModels.find((model) => model.id === selectedModel),
    [availableModels, selectedModel],
  );

  const maxContext = selectedModel ? (selectedModelMeta?.maxModelLen ?? 32768) : undefined;

  const buildContextContent = useCallback(
    (message: ChatMessage): string => {
      const textContent = message.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");

      const cleanedText = stripThinkingForModelContext(textContent);

      const toolContent = message.parts
        .filter((part) => isToolPart(part))
        .map((part) => {
          const input =
            "input" in part && part.input != null ? safeJsonStringify(part.input, "") : "";
          const output =
            "output" in part && part.output != null ? safeJsonStringify(part.output, "") : "";
          const errorText = "errorText" in part && part.errorText ? part.errorText : "";
          return [input, output, errorText].filter(Boolean).join("\n");
        })
        .filter((value) => value.length > 0)
        .join("\n");

      return [cleanedText, toolContent].filter(Boolean).join("\n");
    },
    [isToolPart],
  );

  const contextMessages = useMemo(() => {
    return messages
      .map((message) => ({
        role: message.role,
        content: buildContextContent(message),
      }))
      .filter((message) => message.content.trim().length > 0);
  }, [buildContextContent, messages]);

  const contextStats = useMemo(() => {
    if (!maxContext) return null;
    // Use ref to avoid recalculating when getToolDefinitions changes
    const tools = getToolDefinitionsRef.current?.() ?? [];
    return calculateStats(contextMessages, maxContext, effectiveSystemPrompt, tools);
  }, [contextMessages, maxContext, effectiveSystemPrompt, calculateStats]);

  const contextUsageLabel = useMemo(() => {
    if (!contextStats) return null;
    return `${formatTokenCount(contextStats.currentTokens)} / ${formatTokenCount(
      contextStats.maxContext,
    )}`;
  }, [contextStats, formatTokenCount]);

  const contextBreakdown = useMemo(() => {
    if (!contextStats) return null;
    let userTokens = 0;
    let assistantTokens = 0;
    let thinkingTokens = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolCalls = 0;

    messages.forEach((message) => {
      const textContent = message.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");

      const cleaned = stripThinkingForModelContext(textContent);
      const tokens = estimateTokens(cleaned);

      if (message.role === "user") {
        userMessages += 1;
        userTokens += tokens;
      } else {
        assistantMessages += 1;
        assistantTokens += tokens;
      }

      const thinking = parseThinking(textContent).thinkingContent;
      if (thinking) {
        thinkingTokens += estimateTokens(thinking);
      }

      toolCalls += message.parts.filter((part) => {
        if (part.type === "dynamic-tool") return true;
        return typeof part.type === "string" && part.type.startsWith("tool-");
      }).length;
    });

    return {
      messages: messages.length,
      userMessages,
      assistantMessages,
      toolCalls,
      userTokens,
      assistantTokens,
      thinkingTokens,
    };
  }, [contextStats, estimateTokens, messages, parseThinking]);

  const { sessionArtifacts, artifactsByMessage } = useMemo(() => {
    if (!artifactsEnabled || messages.length === 0) {
      return { sessionArtifacts: [], artifactsByMessage: new Map<string, Artifact[]>() };
    }

    const artifacts: Artifact[] = [];
    const byMessage = new Map<string, Artifact[]>();
    const versionsByGroup = new Map<string, number>();
    messages.forEach((msg) => {
      if (msg.role !== "assistant") return;

      const textContent = msg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");

      if (!textContent) return;

      const { artifacts: extracted } = extractArtifacts(textContent, {
        includeImplicit: true,
        maxImplicit: 1,
      });
      extracted.forEach((artifact, index) => {
        const titleKey = (artifact.title || artifact.type).trim().toLowerCase();
        const groupKey = `${artifact.type}:${titleKey}`;
        const nextVersion = (versionsByGroup.get(groupKey) ?? 0) + 1;
        versionsByGroup.set(groupKey, nextVersion);

        const enriched = {
          ...artifact,
          id: `${msg.id}-${index}`,
          groupId: groupKey,
          version: nextVersion,
          message_id: msg.id,
          session_id: currentSessionId || undefined,
        };
        artifacts.push(enriched);
        const existing = byMessage.get(msg.id) ?? [];
        existing.push(enriched);
        byMessage.set(msg.id, existing);
      });
    });

    return { sessionArtifacts: artifacts, artifactsByMessage: byMessage };
  }, [messages, artifactsEnabled, currentSessionId]);

  const activeArtifact = useMemo(
    () => sessionArtifacts.find((artifact) => artifact.id === activeArtifactId) ?? null,
    [activeArtifactId, sessionArtifacts],
  );

  useEffect(() => {
    if (activeArtifactId && !activeArtifact) {
      setActiveArtifactId(null);
    }
  }, [activeArtifact, activeArtifactId, setActiveArtifactId]);

  const requestCompaction = useCallback(
    async (title: string) => {
      if (!currentSessionId) {
        throw new Error("No active session for compaction");
      }
      return api.compactChatSession(currentSessionId, {
        model: selectedModel || undefined,
        system: effectiveSystemPrompt?.trim() || undefined,
        title,
      });
    },
    [currentSessionId, selectedModel, effectiveSystemPrompt],
  );

  const runAutoCompaction = useCallback(async () => {
    if (!contextStats || !maxContext) return;
    if (!contextConfig.autoCompact) return;
    if (compacting || isLoading) return;
    if (contextStats.utilization < contextConfig.compactionThreshold) return;
    if (!selectedModel || messages.length < 2) return;
    if (!currentSessionId) return;

    const signature = `${currentSessionId || "new"}-${messages.length}-${contextStats.currentTokens}`;
    if (lastCompactionSignatureRef.current === signature) return;
    lastCompactionSignatureRef.current = signature;

    setCompacting(true);
    setCompactionError(null);

    try {
      const compactedTitle =
        currentSessionTitle && !["New Chat", "Chat"].includes(currentSessionTitle)
          ? `${currentSessionTitle} (Compacted)`
          : "Compacted Chat";

      const beforeTokens = calculateMessageTokens(contextMessages);
      const result = await requestCompaction(compactedTitle);

      if (!result?.summary) {
        throw new Error("Empty compaction summary");
      }

      const compactedSession = result.session;
      const storedMessages = compactedSession.messages ?? [];
      if (storedMessages.length === 0) {
        throw new Error("Compaction returned empty session");
      }

      const compactedMessages = mapStoredMessages(storedMessages);

      updateSessions((sessions) => {
        if (sessions.some((existing) => existing.id === compactedSession.id)) {
          return sessions.map((existing) =>
            existing.id === compactedSession.id ? compactedSession : existing,
          );
        }
        return [compactedSession, ...sessions];
      });

      setCurrentSessionId(compactedSession.id);
      setCurrentSessionTitle(compactedSession.title || compactedTitle);
      sessionIdRef.current = compactedSession.id;
      setMessages(compactedMessages);
      hydrateAgentState(compactedSession);
      void loadAgentFiles({ sessionId: compactedSession.id });

        const afterTokens = calculateMessageTokens(
          compactedMessages.map((message) => ({
            role: message.role,
            content: buildContextContent(message),
          })),
        );

      setCompactionHistory((prev) => [
        ...prev,
        {
          id: `compact-${Date.now()}`,
          timestamp: new Date(),
          beforeTokens,
          afterTokens,
          messagesRemoved: Math.max(0, messages.length - compactedMessages.length),
          messagesKept: compactedMessages.length,
          maxContext,
          utilizationBefore: beforeTokens / maxContext,
          utilizationAfter: afterTokens / maxContext,
          strategy: "summarize",
          summary: result.summary,
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Compaction failed";
      console.error(message);
      setCompactionError(message);
    } finally {
      setCompacting(false);
    }
  }, [
    buildContextContent,
    calculateMessageTokens,
    compacting,
    contextConfig.autoCompact,
    contextConfig.compactionThreshold,
    contextMessages,
    contextStats,
    currentSessionId,
    currentSessionTitle,
    isLoading,
    maxContext,
    mapStoredMessages,
    messages,
    requestCompaction,
    selectedModel,
    setCurrentSessionId,
    setCurrentSessionTitle,
    setMessages,
    updateSessions,
    hydrateAgentState,
    loadAgentFiles,
  ]);

  useEffect(() => {
    lastCompactionSignatureRef.current = null;
    setCompactionError(null);
    setCompactionHistory([]);
  }, [currentSessionId]);

  // Auto-compaction effect - only check when streaming stops (not during)
  const compactionAttemptedRef = useRef(false);
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    // Track loading state transitions
    if (isLoading) {
      wasLoadingRef.current = true;
      return;
    }

    // Only check compaction when streaming just finished
    if (!wasLoadingRef.current) return;
    wasLoadingRef.current = false;

    // Skip if already attempted
    if (compactionAttemptedRef.current) return;
    if (!contextStats || !maxContext) return;
    if (!contextConfig.autoCompact) return;
    if (compacting) return;
    if (contextStats.utilization < contextConfig.compactionThreshold) return;
    if (!selectedModel || messages.length < 2) return;
    if (!currentSessionId) return;

    const signature = `${currentSessionId}-${messages.length}-${contextStats.currentTokens}`;
    if (lastCompactionSignatureRef.current === signature) return;

    lastCompactionSignatureRef.current = signature;
    compactionAttemptedRef.current = true;

    void runAutoCompaction();

    return () => {
      compactionAttemptedRef.current = false;
    };
  }, [
    isLoading,
    messages.length,
    contextStats,
    currentSessionId,
    compacting,
    maxContext,
    contextConfig.autoCompact,
    contextConfig.compactionThreshold,
    selectedModel,
    runAutoCompaction,
  ]);

  const showEmptyState = messages.length === 0 && !isLoading && !streamError;

  // Scroll handling
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setUserScrolledUp(distanceFromBottom >= 160);
  }, [setUserScrolledUp]);

  // Auto-scroll to bottom
  // Throttled scroll - only react to message count changes, not content updates
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    // Only scroll when message count changes (new message added) or loading state changes
    if (messages.length === prevMessageCountRef.current && isLoading) return;
    prevMessageCountRef.current = messages.length;

    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({
        behavior: isLoading ? "auto" : "smooth",
      });
    }
  }, [isLoading, messages.length, userScrolledUp]);

  // Elapsed time timer - combined start time and interval logic
  useEffect(() => {
    if (isLoading) {
      // Set start time if not set
      if (streamingStartTime == null) {
        setStreamingStartTime(Date.now());
        return;
      }
      // Start interval to update elapsed seconds
      const intervalId = setInterval(
        () => setElapsedSeconds(Math.floor((Date.now() - streamingStartTime) / 1000)),
        1000,
      );
      return () => clearInterval(intervalId);
    }
    // Not loading - reset after delay
    const timeoutId = setTimeout(() => {
      setStreamingStartTime(null);
      setElapsedSeconds(0);
    }, 3000);
    return () => clearTimeout(timeoutId);
  }, [isLoading, setElapsedSeconds, setStreamingStartTime, streamingStartTime]);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Remember the active session (URL-based navigation will update this too)
  useEffect(() => {
    if (currentSessionId) {
      setLastSessionId(currentSessionId);
    }
  }, [currentSessionId]);

  useEffect(() => {
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    setExecutingTools(new Set());
    setToolResultsMap(new Map());
  }, [currentSessionId, setExecutingTools, setToolResultsMap]);

  useEffect(() => {
    if (!currentSessionId) {
      clearPlan();
      clearAgentFiles();
    }
  }, [currentSessionId, clearPlan, clearAgentFiles]);

  // Handle PWA resume - reload session when app becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Reload current session to restore messages after PWA was backgrounded
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void (async () => {
            try {
              const session = await loadSession(sessionId);
              if (session) {
                const storedMessages = session.messages ?? [];
                // Only restore if we lost messages (PWA was killed)
                if (messagesLengthRef.current === 0 && storedMessages.length > 0) {
                  setMessages(mapStoredMessages(storedMessages));
                }
                hydrateAgentState(session);
                void loadAgentFiles({ sessionId: session.id });
              }
            } catch (err) {
              console.error("Failed to restore session on resume:", err);
            }
          })();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    loadSession,
    mapStoredMessages,
    sessionIdRef,
    setMessages,
    hydrateAgentState,
    loadAgentFiles,
  ]);

  // Handle URL session/new params and restore last session if needed
  useEffect(() => {
    if (newChatFromUrl) {
      startNewSession();
      setMessages([]);
      clearPlan();
      clearAgentFiles();
      return;
    }

    const targetSessionId = sessionFromUrl || getLastSessionId();
    if (!targetSessionId) return;

    // Avoid re-loading the same session repeatedly
    if (targetSessionId === currentSessionId) return;

    // If the URL is missing session but we have a remembered one, reflect it in the URL
    if (!sessionFromUrl) {
      router.replace(`/chat?session=${encodeURIComponent(targetSessionId)}`);
    }

    void (async () => {
      const session = await loadSession(targetSessionId);
      if (session) {
        if (session.model && session.model !== selectedModel) {
          setSelectedModel(session.model);
        }
        const storedMessages = session.messages ?? [];
        setMessages(mapStoredMessages(storedMessages));
        hydrateAgentState(session);
        void loadAgentFiles({ sessionId: session.id });
      }
    })();
  }, [
    newChatFromUrl,
    sessionFromUrl,
    startNewSession,
    loadSession,
    setMessages,
    mapStoredMessages,
    selectedModel,
    setSelectedModel,
    clearPlan,
    clearAgentFiles,
    hydrateAgentState,
    loadAgentFiles,
    currentSessionId,
    router,
  ]);

  // Load MCP servers/tools when enabled
  useEffect(() => {
    if (!mcpEnabled) return;
    void loadMCPServers().then(() => {
      void loadMCPTools();
    });
  }, [mcpEnabled, loadMCPServers, loadMCPTools]);

  // Load agent files when agent mode is enabled
  useEffect(() => {
    if (!agentMode || !currentSessionId) return;
    void loadAgentFiles({ sessionId: currentSessionId });
  }, [agentMode, currentSessionId, loadAgentFiles]);

  // Load available models from OpenAI-compatible endpoint on mount (runs once)
  const modelsLoadedRef = useRef(false);
  useEffect(() => {
    if (modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;

    const loadModels = async () => {
      try {
        const data = await api.getOpenAIModels();
        const dataModels = (data as { data?: unknown[] }).data;
        const modelsField = (data as { models?: unknown[] }).models;
        const rawModels = Array.isArray(data)
          ? data
          : Array.isArray(dataModels)
            ? dataModels
            : Array.isArray(modelsField)
              ? modelsField
              : [];
        // Common model context lengths as fallback
        const KNOWN_CONTEXT_LENGTHS: Record<string, number> = {
          // OpenAI models
          "gpt-4": 8192,
          "gpt-4-32k": 32768,
          "gpt-4-turbo": 128000,
          "gpt-4o": 128000,
          "gpt-4o-mini": 128000,
          "gpt-3.5-turbo": 4096,
          // Anthropic models
          "claude-3-opus": 200000,
          "claude-3-sonnet": 200000,
          "claude-3-haiku": 200000,
          "claude-3-5-sonnet": 200000,
          // Google models
          "gemini-pro": 32768,
          "gemini-1.5-pro": 1048576,
          "gemini-1.5-flash": 1048576,
          // Common vLLM/SGLang model patterns
          qwen: 32768,
          qwen2: 131072,
          llama: 8192,
          "llama-2": 4096,
          "llama-3": 8192,
          "llama-3.1": 131072,
          mistral: 32768,
          mixtral: 32768,
          phi: 2048,
          "phi-3": 131072,
          yi: 32768,
          glm: 32768,
          "glm-4": 131072,
          deepseek: 65536,
          "command-r": 128000,
          "command-r-plus": 128000,
        };

        const getContextLength = (id: string, apiMaxLen?: number): number => {
          if (apiMaxLen && apiMaxLen > 0) return apiMaxLen;

          // Check against known patterns
          const lowerId = id.toLowerCase();
          for (const [pattern, length] of Object.entries(KNOWN_CONTEXT_LENGTHS)) {
            if (lowerId.includes(pattern.toLowerCase())) {
              return length;
            }
          }

          // Default fallback
          return 32768;
        };

        const mappedModels = rawModels
          .flatMap((model) => {
            if (!model || typeof model !== "object") return [];
            const record = model as {
              id?: string;
              model?: string;
              name?: string;
              max_model_len?: number;
              active?: boolean;
            };
            const id = record.id ?? record.model ?? record.name;
            if (!id) return [];
            return [
              {
                id,
                name: id,
                maxModelLen: getContextLength(id, record.max_model_len),
                active: record.active === true,
              },
            ];
          })
          .sort((a, b) => a.id.localeCompare(b.id));

        setAvailableModels(mappedModels);

        const lastModel = localStorage.getItem("vllm-studio-last-model");
        const activeModel = mappedModels.find((model) => model.active)?.id;
        const fallbackModel = activeModel ?? mappedModels[0]?.id ?? "";
        const currentModel = selectedModel;

        if (mappedModels.length === 0) {
          if (lastModel && !currentModel) {
            setSelectedModel(lastModel);
          }
          return;
        }

        let next = currentModel;
        if (next && mappedModels.some((model) => model.id === next)) {
          // keep selected model
        } else if (lastModel && mappedModels.some((model) => model.id === lastModel)) {
          next = lastModel;
        } else {
          next = fallbackModel;
        }

        if (next && next !== currentModel) {
          setSelectedModel(next);
        }
      } catch (err) {
        console.error("Failed to load models:", err);
      }
    };
    loadModels();
  }, [setAvailableModels, setSelectedModel, selectedModel]);

  // Load MCP servers when settings modal opens
  useEffect(() => {
    if (mcpSettingsOpen) {
      loadMCPServers();
    }
  }, [mcpSettingsOpen, loadMCPServers]);

  // Refresh usage when modal opens
  useEffect(() => {
    if (usageOpen && currentSessionId) {
      refreshUsage(currentSessionId);
    }
  }, [usageOpen, currentSessionId, refreshUsage]);

  // Export functions
  const handleExportJson = useCallback(() => {
    const data = {
      title: currentSessionTitle,
      sessionId: currentSessionId,
      model: selectedModel,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
      })),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${currentSessionId || "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentSessionId, currentSessionTitle, selectedModel, messages]);

  const handleExportMarkdown = useCallback(() => {
    let md = `# ${currentSessionTitle}\n\n`;
    md += `Model: ${selectedModel}\n`;
    md += `Exported: ${new Date().toLocaleString()}\n\n---\n\n`;

    for (const msg of messages) {
      const role = msg.role === "user" ? "**User**" : "**Assistant**";
      md += `${role}:\n\n`;
      for (const part of msg.parts) {
        if (part.type === "text") {
          md += `${(part as { text: string }).text}\n\n`;
        } else if (part.type.startsWith("tool-") && "toolCallId" in part) {
          md += `> Tool: ${part.type.replace(/^tool-/, "")}\n\n`;
        }
      }
      md += "---\n\n";
    }

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${currentSessionId || "export"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentSessionId, currentSessionTitle, selectedModel, messages]);

  const startRunStream = useCallback(
    async (
      sessionId: string,
      payload: {
        content: string;
        message_id: string;
        model?: string;
        system?: string;
        mcp_enabled?: boolean;
        agent_mode?: boolean;
        agent_files?: boolean;
        deep_research?: boolean;
        thinking_level?: string;
      },
    ) => {
      if (runAbortControllerRef.current) {
        runAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      runAbortControllerRef.current = abortController;
      runCompletedRef.current = false;
      setIsLoading(true);
      setStreamError(null);
      setExecutingTools(new Set());
      setToolResultsMap(new Map());

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
    [handleRunEvent, setExecutingTools, setToolResultsMap],
  );

  const uploadAttachments = useCallback(
    async (
      sessionId: string,
      attachments: Attachment[],
    ): Promise<{
      uploaded: UploadedAttachment[];
      failures: Array<{ name: string; error: string }>;
    }> => {
      if (attachments.length === 0) {
        return { uploaded: [], failures: [] };
      }

      const datePrefix = new Date().toISOString().slice(0, 10);
      const baseDir = `uploads/${datePrefix}`;

      const results = await Promise.all(
        attachments.map(async (attachment, index) => {
          try {
            const safeName = sanitizeAttachmentName(
              attachment.name || `attachment-${index + 1}`,
            );
            const { content, encoding } = await readAttachmentContent(attachment);
            const fileName = `${createUuid()}-${safeName}${
              encoding === "base64" ? ".base64" : ""
            }`;
            const path = `${baseDir}/${fileName}`;
            await api.writeAgentFile(sessionId, path, { content });
            return {
              ok: true as const,
              entry: {
                name: attachment.name || safeName,
                path,
                size: attachment.size,
                type: attachment.type,
                encoding,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              name: attachment.name || `attachment-${index + 1}`,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      const uploaded = results.flatMap((result) => (result.ok ? [result.entry] : []));
      const failures = results.flatMap((result) =>
        result.ok ? [] : [{ name: result.name, error: result.error }],
      );

      if (uploaded.length > 0) {
        void loadAgentFiles({ sessionId });
      }

      return { uploaded, failures };
    },
    [loadAgentFiles],
  );

  const sendUserMessage = useCallback(
    async (
      text: string,
      attachments?: Attachment[],
      options?: { clearInput?: boolean },
    ) => {
      if (!selectedModel) return;
      if (!text.trim() && (!attachments || attachments.length === 0)) return;
      if (isLoading) return;
      setStreamingStartTime(Date.now());
      setStreamError(null);

      if (options?.clearInput) {
        setInput("");
      }

      lastUserInputRef.current = text;

      const parts: ChatMessagePart[] = [];
      if (text.trim()) {
        parts.push({ type: "text", text });
      }

      if (attachments) {
        for (const att of attachments) {
          if (att.type === "image" && att.base64) {
            parts.push({ type: "text", text: `[Image: ${att.name}]` });
          } else if (att.type === "file" && att.file) {
            parts.push({ type: "text", text: `[File: ${att.name}]` });
          }
        }
      }

      const messageId = createUuid();
      const userMessage: ChatMessage = {
        id: messageId,
        role: "user",
        parts,
      };

      setMessages((prev) => [...prev, userMessage]);
      const removeLocalMessage = () => {
        setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      };

      let sessionId = currentSessionId;
      if (!sessionId) {
        const session = await createSession("New Chat", selectedModel);
        if (!session) return;
        sessionId = session.id;
        setLastSessionId(sessionId);
        router.replace(`/chat?session=${encodeURIComponent(sessionId)}`);
      }

      let attachmentsBlock: string | undefined;
      let agentFilesEnabled = false;
      if (attachments && attachments.length > 0) {
        const { uploaded, failures } = await uploadAttachments(sessionId, attachments);
        if (uploaded.length > 0) {
          attachmentsBlock = buildAttachmentsBlock(uploaded);
          agentFilesEnabled = true;
        }
        if (failures.length > 0) {
          const names = failures.map((failure) => failure.name).join(", ");
          setStreamError(`Failed to upload ${failures.length} attachment(s): ${names}`);
          if (uploaded.length === 0) {
            removeLocalMessage();
            return;
          }
        }
      }

      const runSystemPrompt = attachmentsBlock
        ? buildRunSystemPrompt(systemPrompt, attachmentsBlock)
        : systemPrompt.trim() || undefined;

      await startRunStream(sessionId, {
        content: text,
        message_id: messageId,
        model: selectedModel,
        system: runSystemPrompt,
        mcp_enabled: mcpEnabled,
        agent_mode: agentMode,
        agent_files: agentFilesEnabled,
        deep_research: deepResearch.enabled,
      });
    },
    [
      agentMode,
      createSession,
      currentSessionId,
      deepResearch.enabled,
      isLoading,
      mcpEnabled,
      router,
      selectedModel,
      setInput,
      setStreamingStartTime,
      startRunStream,
      systemPrompt,
      uploadAttachments,
    ],
  );

  // Handle send with persistence and attachments
  const handleSend = useCallback(
    async (attachments?: Attachment[]) => {
      await sendUserMessage(input, attachments, { clearInput: true });
    },
    [input, sendUserMessage],
  );

  const handleReprompt = useCallback(
    async (messageId: string) => {
      if (isLoading) return;
      const messageIndex = messages.findIndex((msg) => msg.id === messageId);
      if (messageIndex <= 0) return;

      const previousUser = [...messages.slice(0, messageIndex)]
        .reverse()
        .find((msg) => msg.role === "user");

      if (!previousUser) return;

      const userText = previousUser.parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");

      if (!userText.trim()) return;

      await sendUserMessage(userText);
    },
    [messages, isLoading, sendUserMessage],
  );

  const handleForkMessage = useCallback(
    async (messageId: string) => {
      if (!currentSessionId) return;
      try {
        const { session } = await api.forkChatSession(currentSessionId, {
          message_id: messageId,
          model: selectedModel || undefined,
          title: "New Chat",
        });
        updateSessions((sessions) => {
          if (sessions.some((existing) => existing.id === session.id)) {
            return sessions.map((existing) => (existing.id === session.id ? session : existing));
          }
          return [session, ...sessions];
        });
        router.push(`/chat?session=${session.id}`);
      } catch (err) {
        console.error("Failed to fork session:", err);
      }
    },
    [currentSessionId, selectedModel, router, updateSessions],
  );

  // Handle stop
  const handleStop = useCallback(async () => {
    runAbortControllerRef.current?.abort();
    const runId = activeRunIdRef.current;
    if (runId && currentSessionId) {
      try {
        await api.abortChatRun(currentSessionId, runId);
      } catch (err) {
        console.warn("Failed to abort run:", err);
      }
    }
    activeRunIdRef.current = null;
    setStreamingStartTime(null);
    setElapsedSeconds(0);
    setIsLoading(false);
  }, [currentSessionId, setElapsedSeconds, setStreamingStartTime]);

  // Handle model change and persist to localStorage
  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      localStorage.setItem("vllm-studio-last-model", modelId);
    },
    [setSelectedModel],
  );

  const toolBelt = (
    <ToolBelt
      value={input}
      onChange={setInput}
      onSubmit={handleSend}
      onStop={handleStop}
      disabled={false}
      isLoading={isLoading}
      placeholder={selectedModel ? "Message..." : "Select a model"}
      selectedModel={selectedModel}
      availableModels={availableModels}
      onModelChange={handleModelChange}
      mcpEnabled={mcpEnabled}
      onMcpToggle={() => {
        console.log("[ChatPage] MCP toggle:", !mcpEnabled);
        setMcpEnabled(!mcpEnabled);
      }}
      artifactsEnabled={artifactsEnabled}
      onArtifactsToggle={() => {
        setArtifactsEnabled(!artifactsEnabled);
      }}
      deepResearchEnabled={deepResearch.enabled}
      onDeepResearchToggle={() => {
        const nextEnabled = !deepResearch.enabled;
        setDeepResearch({ ...deepResearch, enabled: nextEnabled });
        if (nextEnabled && !mcpEnabled) setMcpEnabled(true);
      }}
      elapsedSeconds={elapsedSeconds}
      queuedContext={queuedContext}
      onQueuedContextChange={setQueuedContext}
      onOpenMcpSettings={() => setMcpSettingsOpen(true)}
      onOpenChatSettings={() => setSettingsOpen(true)}
      hasSystemPrompt={systemPrompt.trim().length > 0}
      agentMode={agentMode}
      onAgentModeToggle={() => {
        const next = !agentMode;
        setAgentMode(next);
        if (next && !mcpEnabled) setMcpEnabled(true);
      }}
      planDrawer={agentPlan ? <AgentPlanDrawer plan={agentPlan} onClear={clearPlan} /> : null}
    />
  );

  // (plan processing removed — activity panel shows thinking + tool calls directly)

  // Sidebar state
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("activity");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const autoOpenedActivityRef = useRef(false);

  useEffect(() => {
    autoOpenedActivityRef.current = false;
  }, [currentSessionId]);

  // Auto-open activity panel only on first activity (not every change)
  const hadActivityRef = useRef(false);
  const hasActivity = thinkingActive || executingTools.size > 0 || activityGroups.length > 0;
  useEffect(() => {
    // Only trigger on transition from no-activity to has-activity
    if (!hasActivity) {
      hadActivityRef.current = false;
      return;
    }
    if (hadActivityRef.current) return;
    if (autoOpenedActivityRef.current) return;
    if (sidebarOpen) return;

    hadActivityRef.current = true;
    setSidebarOpen(true);
    setSidebarTab("activity");
    autoOpenedActivityRef.current = true;
  }, [hasActivity, sidebarOpen]);

  const openActivityPanel = useCallback(() => {
    setSidebarOpen(true);
    setSidebarTab("activity");
  }, [setSidebarOpen, setSidebarTab]);

  const openContextPanel = useCallback(() => {
    setSidebarOpen(true);
    setSidebarTab("context");
  }, [setSidebarOpen, setSidebarTab]);

  return (
    <div className="relative h-full flex overflow-hidden w-full max-w-full bg-[#0a0a0a]">
      <UnifiedSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        activeTab={sidebarTab}
        onSetActiveTab={setSidebarTab}
        agentMode={agentMode}
        onToggleAgentMode={() => {
          const next = !agentMode;
          setAgentMode(next);
          // Auto-enable MCP when turning agent mode on
          if (next && !mcpEnabled) setMcpEnabled(true);
        }}
        hasArtifacts={sessionArtifacts.length > 0}
        activityContent={
          <div className="h-full flex flex-col">
            <ActivityPanel
              activityGroups={activityGroups}
              agentPlan={agentPlan}
              isLoading={isLoading}
            />
          </div>
        }
        contextContent={
          <div className="p-4 overflow-y-auto h-full">
            <ContextPanel
              stats={contextStats}
              breakdown={contextBreakdown}
              compactionHistory={compactionHistory}
              compacting={compacting}
              compactionError={compactionError}
              formatTokenCount={formatTokenCount}
            />
          </div>
        }
        artifactsContent={<ArtifactPreviewPanel artifacts={sessionArtifacts} />}
        filesContent={
          <AgentFilesPanel
            files={agentFiles}
            plan={agentPlan}
            selectedFilePath={selectedAgentFilePath}
            selectedFileContent={selectedAgentFileContent}
            selectedFileLoading={selectedAgentFileLoading}
            onSelectFile={(path) => selectAgentFile(path, sessionFromUrl || currentSessionId)}
            hasSession={!!(sessionFromUrl || currentSessionId)}
          />
        }
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      >
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-x-hidden">
          <div className="flex-1 flex flex-col overflow-hidden relative min-w-0 bg-[hsl(30,5%,10.5%)]">
            <ChatConversation
              messages={messages}
              isLoading={isLoading}
              error={streamError ?? undefined}
              artifactsEnabled={artifactsEnabled}
              artifactsByMessage={artifactsByMessage}
              selectedModel={selectedModel}
              contextUsageLabel={contextUsageLabel}
              onFork={handleForkMessage}
              onReprompt={handleReprompt}
              onOpenContext={openContextPanel}
              showEmptyState={showEmptyState}
              toolBelt={toolBelt}
              onScroll={handleScroll}
              messagesContainerRef={messagesContainerRef}
              messagesEndRef={messagesEndRef}
            />

            <ChatTopControls
              onOpenSidebar={() => {
                window.dispatchEvent(
                  new CustomEvent("vllm:toggle-sidebar", { detail: { open: true } }),
                );
              }}
              onOpenSettings={() => setSettingsOpen(true)}
            />

            <ChatActionButtons
              activityCount={activityCount}
              onOpenActivity={openActivityPanel}
              onOpenContext={openContextPanel}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenMcpSettings={() => setMcpSettingsOpen(true)}
              onOpenUsage={() => setUsageOpen(true)}
              onOpenExport={() => setExportOpen(true)}
            />

            <ChatToolbeltDock toolBelt={toolBelt} showEmptyState={showEmptyState} />
          </div>
        </div>
      </UnifiedSidebar>

      <ChatModals
        settingsOpen={settingsOpen}
        onCloseSettings={() => setSettingsOpen(false)}
        mcpSettingsOpen={mcpSettingsOpen}
        onCloseMcpSettings={() => setMcpSettingsOpen(false)}
        usageOpen={usageOpen}
        onCloseUsage={() => setUsageOpen(false)}
        exportOpen={exportOpen}
        onCloseExport={() => setExportOpen(false)}
        systemPrompt={systemPrompt}
        onSystemPromptChange={setSystemPrompt}
        selectedModel={selectedModel}
        onSelectedModelChange={setSelectedModel}
        availableModels={availableModels}
        deepResearch={deepResearch}
        onDeepResearchChange={setDeepResearch}
        mcpServers={mcpServers}
        onAddServer={addMcpServer}
        onUpdateServer={updateMcpServer}
        onRemoveServer={removeMcpServer}
        onRefreshServers={loadMCPServers}
        sessionUsage={sessionUsage}
        messages={messages}
        onExportJson={handleExportJson}
        onExportMarkdown={handleExportMarkdown}
      />
      <ArtifactModal artifact={activeArtifact} onClose={() => setActiveArtifactId(null)} />
    </div>
  );
}
