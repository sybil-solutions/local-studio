// CRITICAL
"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { api } from "@/lib/api";
import { safeJsonStringify } from "@/lib/safe-json";
import { extractArtifacts } from "../artifacts/artifact-renderer";
import { ArtifactModal } from "../artifacts/artifact-modal";
import { ArtifactPreviewPanel } from "../artifacts/artifact-preview-panel";
import { ToolBelt } from "../input/tool-belt";
import { ChatConversation } from "./chat-conversation";
import { ChatTopControls } from "./chat-top-controls";
import { ChatActionButtons } from "./chat-action-buttons";
import { ChatToolbeltDock } from "./chat-toolbelt-dock";
import { ChatModals } from "./chat-modals";
import { useChatSessions } from "../../hooks/use-chat-sessions";
import { useChatTools } from "../../hooks/use-chat-tools";
import { useChatUsage } from "../../hooks/use-chat-usage";
import { useChatDerived } from "../../hooks/use-chat-derived";
import { useChatTransport } from "../../hooks/use-chat-transport";
import type { UIMessage } from "@ai-sdk/react";
import type { Artifact, StoredMessage, StoredToolCall } from "@/lib/types";
import { useContextManagement, type CompactionEvent } from "@/lib/services/context-management";
import { useMessageParsing } from "@/lib/services/message-parsing";
import { useAppStore } from "@/store";
import type { Attachment } from "../../types";
import { stripThinkingForModelContext, tryParseNestedJsonString } from "../../utils";
import { useAgentTools } from "../../hooks/use-agent-tools";
import { useAgentFiles } from "../../hooks/use-agent-files";
import { useAgentState } from "../../hooks/use-agent-state";
import { AgentPlanDrawer } from "../agent/agent-plan-drawer";
import { AgentFilesPanel } from "../agent/agent-files-panel";
import { UnifiedSidebar, type SidebarTab } from "./unified-sidebar";
import { ActivityPanel, ContextPanel } from "./chat-side-panel";
import { buildAgentModeSystemPrompt } from "../../utils/agent-system-prompt";

export function ChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionFromUrl = searchParams.get("session");
  const newChatFromUrl = searchParams.get("new") === "1";

  // Local UI state (sourced from Zustand)
  const input = useAppStore((state) => state.input);
  const setInput = useAppStore((state) => state.setInput);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const systemPrompt = useAppStore((state) => state.systemPrompt);
  const setSystemPrompt = useAppStore((state) => state.setSystemPrompt);
  const setToolPanelOpen = useAppStore((state) => state.setToolPanelOpen);
  const setActivePanel = useAppStore((state) => state.setActivePanel);
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

  // Agent mode
  const agentMode = useAppStore((state) => state.agentMode);
  const setAgentMode = useAppStore((state) => state.setAgentMode);

  const {
    agentToolDefs,
    executeAgentTool,
    isAgentTool,
    agentPlan,
    clearPlan,
  } = useAgentTools();

  const { agentFiles, loadAgentFiles, clearAgentFiles } = useAgentFiles();

  const { hydrateAgentState, persistAgentState, buildAgentState } = useAgentState();

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
  } = useChatSessions();

  // Tools hook
  const {
    mcpServers,
    mcpTools,
    loadMCPServers,
    loadMCPTools,
    getToolDefinitions,
    executeTool,
    executingTools,
    toolResultsMap,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
  } = useChatTools({ mcpEnabled });

  // Ref to avoid contextStats recalculating when getToolDefinitions changes
  const getToolDefinitionsRef = useRef(getToolDefinitions);
  useEffect(() => {
    getToolDefinitionsRef.current = getToolDefinitions;
  }, [getToolDefinitions]);

  // Usage hook
  const { refreshUsage } = useChatUsage();

  // Transport hook for persistence
  const { persistMessage, createSessionWithMessage, generateTitle, sessionIdRef } =
    useChatTransport({
      currentSessionId,
      setCurrentSessionId,
      setCurrentSessionTitle,
      selectedModel,
    });

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
  // Agent continuation loop: track auto-sends to prevent infinite loops
  const agentContinuationRef = useRef<number>(0);
  const agentContinuationMaxRef = useRef<number>(50);
  const agentStateSignatureRef = useRef<string | null>(null);
  const [compactionHistory, setCompactionHistory] = useState<CompactionEvent[]>([]);
  const [compacting, setCompacting] = useState(false);
  const [compactionError, setCompactionError] = useState<string | null>(null);
  const lastCompactionSignatureRef = useRef<string | null>(null);

  const mapStoredToolCalls = useCallback((toolCalls?: StoredToolCall[]) => {
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
        const storedParts = message.parts as UIMessage["parts"] | undefined;
        const hasStoredParts = Array.isArray(storedParts) && storedParts.length > 0;
        const parts: UIMessage["parts"] = hasStoredParts ? [...storedParts] : [];

        if (!hasStoredParts && message.content) {
          parts.push({ type: "text", text: message.content });
        }

        if (!hasStoredParts) {
          const toolParts = mapStoredToolCalls(message.tool_calls);
          for (const toolPart of toolParts) {
            parts.push(toolPart as UIMessage["parts"][number]);
          }
        }

        const inputTokens = message.prompt_tokens ?? undefined;
        const outputTokens = message.completion_tokens ?? undefined;
        const totalTokens =
          message.total_tokens ??
          (inputTokens != null || outputTokens != null
            ? (inputTokens ?? 0) + (outputTokens ?? 0)
            : undefined);

        const metadata = message.metadata as UIMessage["metadata"] | undefined;

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
        } satisfies UIMessage;
      });
    },
    [mapStoredToolCalls],
  );

  const resolveToolDefinitions = useCallback(async () => {
    console.log(
      "[resolveToolDefinitions] agentMode:",
      agentMode,
      "agentToolDefs:",
      agentToolDefs.length,
    );
    const mcpDefs: typeof mcpTools = [];
    if (mcpEnabled) {
      if (mcpTools.length > 0) {
        mcpDefs.push(...(getToolDefinitions?.(mcpTools) ?? []));
      }
    }
    // Inject synthetic agent tools when agent mode is on
    if (agentMode) {
      const allTools = [...mcpDefs, ...agentToolDefs];
      console.log(
        "[resolveToolDefinitions] Returning agent tools:",
        allTools.map((t) => t.name),
      );
      return allTools;
    }
    return mcpDefs;
  }, [mcpEnabled, mcpTools, getToolDefinitions, agentMode, agentToolDefs]);

  const toolsRef = useRef<
    Array<{ name: string; server?: string; description?: string; inputSchema?: unknown }>
  >([]);

  // Keep tools ref updated whenever agent mode or MCP tools change
  useEffect(() => {
    const updateTools = async () => {
      const tools = await resolveToolDefinitions();
      toolsRef.current = tools;
      console.log(
        "[Tools] Updated:",
        tools.map((t) => t.name),
        "agentMode:",
        agentMode,
      );
    };
    void updateTools();
  }, [resolveToolDefinitions, agentMode]);

  // Transport body is resolved fresh on every request
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: async () => {
          // Ensure tools are resolved before sending
        if (toolsRef.current.length === 0) {
          const tools = await resolveToolDefinitions();
          toolsRef.current = tools;
        }
        const state = useAppStore.getState();
        const baseSystem = state.systemPrompt?.trim() || "";
        const system = state.agentMode
          ? (() => {
              const agentBlock = buildAgentModeSystemPrompt(state.agentPlan);
              return baseSystem ? `${baseSystem}\n\n${agentBlock}` : agentBlock;
            })()
          : baseSystem || undefined;
        const model = state.selectedModel || undefined;
        console.log(
          "[Transport] Sending with tools:",
          toolsRef.current.map((t) => t.name),
        );
        return {
          system,
          model,
          tools: toolsRef.current,
          toolChoice: toolsRef.current.length > 0 ? "auto" : undefined,
        };
      },
      }),
    [resolveToolDefinitions],
  );

  // AI SDK useChat - the source of truth for messages
  const { messages, sendMessage, stop, status, error, setMessages, addToolOutput } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      console.log("[onToolCall] Full toolCall object:", JSON.stringify(toolCall, null, 2));
      const toolCallId = toolCall.toolCallId;
      const toolName = toolCall.toolName;
      // AI SDK v6+ uses toolCall.input for the tool arguments
      const tcAny = toolCall as unknown as Record<string, unknown>;
      const rawArgs = tcAny.input ?? tcAny.args ?? tcAny.arguments;
      let args: Record<string, unknown> = {};
      if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
        args = rawArgs as Record<string, unknown>;
      } else if (typeof rawArgs === "string") {
        try {
          const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            args = parsed;
          }
        } catch {
          args = {};
        }
      } else if (Array.isArray(rawArgs)) {
        // Some models might send an array directly (unlikely but handle it)
        args = { tasks: rawArgs };
      }

      // If args is empty but rawArgs has content, try harder to parse it
      if (Object.keys(args).length === 0 && rawArgs) {
        console.log("[onToolCall] args is empty, attempting deeper parse of rawArgs");
        if (typeof rawArgs === "object") {
          // Maybe the entire toolCall.input is the args
          args = rawArgs as Record<string, unknown>;
        }
      }

      console.log("[onToolCall] Tool:", toolName, "rawArgs type:", typeof rawArgs, "rawArgs:", rawArgs, "args:", JSON.stringify(args, null, 2));

      if (isAgentTool(toolName)) {
        try {
          const sessionId = sessionIdRef.current ?? currentSessionId;
          const output = await executeAgentTool(toolName, args, { sessionId });
          if (output == null) return;
          // Don't await - causes deadlock with sendAutomaticallyWhen
          addToolOutput({
            tool: toolName as never,
            toolCallId,
            output: output as never,
          });
        } catch (err) {
          // Don't await - causes deadlock with sendAutomaticallyWhen
          addToolOutput({
            tool: toolName as never,
            toolCallId,
            state: "output-error",
            errorText: err instanceof Error ? err.message : "Agent tool execution failed",
          });
        }
        return;
      }

      // MCP tools - execute locally
      const result = await executeTool({ toolCallId, toolName, args });
      // Don't await - causes deadlock with sendAutomaticallyWhen
      if (result.isError) {
        addToolOutput({
          tool: toolName as never,
          toolCallId,
          state: "output-error",
          errorText: result.content || "Tool execution failed",
        });
      } else {
        addToolOutput({
          tool: toolName as never,
          toolCallId,
          output: result.content as never,
        });
      }
    },
    onFinish: async ({ message }) => {
      setStreamingStartTime(null);
      setElapsedSeconds(0);

      const activeSessionId = sessionIdRef.current ?? currentSessionId;

      // Persist assistant message
      if (activeSessionId && message.role === "assistant") {
        await persistMessage(activeSessionId, message);

        // Generate title if this is the first exchange
        if (
          (currentSessionTitle === "New Chat" || currentSessionTitle === "Chat") &&
          lastUserInputRef.current
        ) {
          const textContent = message.parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("");
          await generateTitle(activeSessionId, lastUserInputRef.current, textContent);
        }
      }
    },
    onError: (err) => {
      console.error("Chat error:", err);
      setStreamingStartTime(null);
      setElapsedSeconds(0);
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (!currentSessionId) return;
    const agentState = buildAgentState(agentPlan);
    const signature = safeJsonStringify(agentState, "");
    if (signature === agentStateSignatureRef.current) return;
    agentStateSignatureRef.current = signature;
    void persistAgentState(currentSessionId, agentState);
  }, [currentSessionId, agentPlan, buildAgentState, persistAgentState]);

  // Derived state from messages
  const { thinkingActive, activityGroups } = useChatDerived({
    messages,
    isLoading,
    executingTools,
    toolResultsMap,
  });

  const activityCount = useMemo(() => {
    return activityGroups.reduce(
      (sum, group) => sum + group.toolItems.length + (group.thinkingContent ? 1 : 0),
      0,
    );
  }, [activityGroups]);

  const selectedModelMeta = useMemo(
    () => availableModels.find((model) => model.id === selectedModel),
    [availableModels, selectedModel],
  );

  const maxContext = selectedModel ? (selectedModelMeta?.maxModelLen ?? 32768) : undefined;

  const contextMessages = useMemo(() => {
    return messages
      .map((message) => {
        const textContent = message.parts
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("");

        const cleanedText = stripThinkingForModelContext(textContent);

        const toolContent = message.parts
          .filter(
            (
              part,
            ): part is UIMessage["parts"][number] & {
              input?: unknown;
              output?: unknown;
              errorText?: string;
            } => {
              if (typeof part.type !== "string") return false;
              return part.type === "dynamic-tool" || part.type.startsWith("tool-");
            },
          )
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

        const combined = [cleanedText, toolContent].filter(Boolean).join("\n");

        return {
          role: message.role,
          content: combined,
        };
      })
      .filter((message) => message.content.trim().length > 0);
  }, [messages]);

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
        compactedMessages.map((message) => {
          const textContent = message.parts
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text)
            .join("");
          const cleanedText = stripThinkingForModelContext(textContent);
          const toolContent = message.parts
            .filter(
              (
                part,
              ): part is UIMessage["parts"][number] & {
                input?: unknown;
                output?: unknown;
                errorText?: string;
              } => {
                if (typeof part.type !== "string") return false;
                return part.type === "dynamic-tool" || part.type.startsWith("tool-");
              },
            )
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

          return {
            role: message.role,
            content: [cleanedText, toolContent].filter(Boolean).join("\n"),
          };
        }),
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

  // Reset agent continuation counter on session change or agent mode toggle
  useEffect(() => {
    agentContinuationRef.current = 0;
    agentStateSignatureRef.current = null;
  }, [currentSessionId, agentMode]);

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

  const showEmptyState = messages.length === 0 && !isLoading && !error;

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

  useEffect(() => {
    messagesLengthRef.current = messages.length;
  }, [messages.length]);

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

  // Handle URL session/new params
  useEffect(() => {
    if (newChatFromUrl) {
      startNewSession();
      setMessages([]);
      clearPlan();
      clearAgentFiles();
      return;
    }
    if (sessionFromUrl) {
      void (async () => {
        const session = await loadSession(sessionFromUrl);
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
    }
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
  ]);

  // Load MCP servers/tools when enabled
  useEffect(() => {
    if (mcpEnabled) {
      loadMCPServers();
      loadMCPTools();
    }
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
        const mappedModels = rawModels
          .flatMap((model) => {
            if (!model || typeof model !== "object") return [];
            const record = model as {
              id?: string;
              model?: string;
              name?: string;
              max_model_len?: number;
            };
            const id = record.id ?? record.model ?? record.name;
            if (!id) return [];
            return [
              {
                id,
                name: id,
                maxModelLen: record.max_model_len ?? undefined,
              },
            ];
          })
          .sort((a, b) => a.id.localeCompare(b.id));

        setAvailableModels(mappedModels);

        const lastModel = localStorage.getItem("vllm-studio-last-model");
        const fallbackModel = mappedModels[0]?.id || "";
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

  const sendUserMessage = useCallback(
    async (text: string, attachments?: Attachment[], options?: { clearInput?: boolean; internal?: boolean }) => {
      if (!selectedModel) return;
      if (!text.trim() && (!attachments || attachments.length === 0)) return;
      if (isLoading) return;

      // Only open side panel on desktop (but not for internal/continuation messages)
      if (!options?.internal && window.innerWidth >= 768) {
        setToolPanelOpen(true);
        setActivePanel("activity");
      }
      setStreamingStartTime(Date.now());

      if (options?.clearInput) {
        setInput("");
      }

      // Store for title generation (only for user-visible messages)
      if (!options?.internal) {
        lastUserInputRef.current = text;
      }

      // Reset agent continuation counter on manual user send (not internal)
      if (!options?.internal) {
        agentContinuationRef.current = 0;
      }

      // Build message parts including attachments
      const parts: UIMessage["parts"] = [];
      if (text.trim()) {
        parts.push({ type: "text", text });
      }

      // Add image attachments as file parts
      if (attachments) {
        for (const att of attachments) {
          if (att.type === "image" && att.base64) {
            // Note: AI SDK supports image parts, add as experimental_attachments in sendMessage
            parts.push({
              type: "text",
              text: `[Image: ${att.name}]`,
            });
          } else if (att.type === "file" && att.file) {
            // For files, add file name reference
            parts.push({
              type: "text",
              text: `[File: ${att.name}]`,
            });
          }
        }
      }

      const messageId = `user-${Date.now()}`;
      const userMessage: UIMessage = {
        id: messageId,
        role: "user",
        parts,
        metadata: options?.internal ? { internal: true } : undefined,
      };

      // Create session if needed, then persist user message
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = await createSessionWithMessage(userMessage);
      } else {
        await persistMessage(sessionId, userMessage);
      }

      // Send the message via AI SDK — transport body provides system, model, tools
      sendMessage({ parts, metadata: userMessage.metadata });
    },
    [
      isLoading,
      sendMessage,
      currentSessionId,
      createSessionWithMessage,
      persistMessage,
      setToolPanelOpen,
      setActivePanel,
      setStreamingStartTime,
      setInput,
    ],
  );

  // Agent continuation: auto-send when model stops and plan has incomplete steps
  const agentContinuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (agentContinuationTimerRef.current) {
      clearTimeout(agentContinuationTimerRef.current);
      agentContinuationTimerRef.current = null;
    }

    // Basic guards
    if (!agentMode || isLoading || messages.length === 0) return;
    if (!agentPlan || agentPlan.steps.length === 0) return;

    // All done?
    const incomplete = agentPlan.steps.filter((s) => s.status !== "done");
    if (incomplete.length === 0) return;

    // Safety limit
    if (agentContinuationRef.current >= 50) {
      console.warn("[Agent] Hit continuation limit");
      return;
    }

    // Only continue after assistant turn
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== "assistant") return;

    // Schedule continuation - send internal message (not visible in chat)
    agentContinuationTimerRef.current = setTimeout(() => {
      agentContinuationRef.current += 1;
      const done = agentPlan.steps.filter((s) => s.status === "done").length;
      const next = incomplete[0];
      // Use a minimal internal prompt - the system prompt has all the context
      const prompt = next?.title ? `Proceed with: ${next.title}` : "Continue";
      console.info("[Agent] Continuing step:", `${done + 1}/${agentPlan.steps.length}`, next?.title);
      void sendUserMessage(prompt, undefined, { internal: true });
    }, 1000);

    return () => {
      if (agentContinuationTimerRef.current) {
        clearTimeout(agentContinuationTimerRef.current);
      }
    };
  }, [agentMode, agentPlan, isLoading, messages, sendUserMessage]);

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
  const handleStop = useCallback(() => {
    stop();
    setStreamingStartTime(null);
    setElapsedSeconds(0);
  }, [setElapsedSeconds, setStreamingStartTime, stop]);

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
        filesContent={<AgentFilesPanel files={agentFiles} plan={agentPlan} />}
      >
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-x-hidden">
          <div className="flex-1 flex flex-col overflow-hidden relative min-w-0 bg-[hsl(30,5%,10.5%)]">
            <ChatConversation
              messages={messages}
              isLoading={isLoading}
              error={error?.message}
              artifactsEnabled={artifactsEnabled}
              artifactsByMessage={artifactsByMessage}
              selectedModel={selectedModel}
              contextUsageLabel={contextUsageLabel}
              onFork={handleForkMessage}
              onReprompt={handleReprompt}
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
              onOpenActivity={() => {
                setSidebarOpen(true);
                setSidebarTab("activity");
              }}
              onOpenContext={() => {
                setSidebarOpen(true);
                setSidebarTab("context");
              }}
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
