"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, ReactNode } from "react";
import {
  AlertTriangle,
  FileText,
  Loader2,
  PencilLine,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import {
  AttachIcon,
  ChevronDownIcon,
  CloseIcon,
  FileIcon,
  GitBranchIcon,
  GlobeIcon,
  SendIcon,
  StopIcon,
} from "@/components/icons";
import { safeJson } from "@/lib/agent/safe-json";
import { isAgentEndEvent } from "@/lib/agent/pi-events";
import {
  activateComposerPlugin,
  activeComposerPlugins,
  byQuery,
  detectComposerMention,
  consumeComposerMention,
  selectedContextPrompt,
  type ComposerMention,
  type ComposerPluginRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import {
  appendDelta,
  appendEventBlock,
  asRecord,
  compactionTextFromEvent,
  drainQueueAfterAgentEnd,
  extractToolText,
  makeFreshTab as makeFreshTabImpl,
  mergeCanonicalAndRuntimeEvents,
  messageText,
  newId,
  nowLabel,
  parseAgentTurnSsePayload,
  piSessionIdFromEvent,
  reconcileQueueWithPiEvent,
  replayCursorAfterRuntimeHydration,
  replaySessionEvents,
  runtimeStatusAcceptsControl,
  runtimeStatusLooksActive,
  sessionTitleFromPrompt,
  statusAfterControlPhase,
  stringifyToolArgs,
  toolCallDeltaFromUpdate,
  toolCallSnapshotFromUpdate,
  upsertTool,
  usageFromEvent,
  visibleQueuedMessages,
  visibleUserTextFromPi,
  formatTokenCount,
} from "@/lib/agent/session";
import type {
  AgentTurnSsePayload,
  AssistantBlock,
  ChatMessage,
  ChatPaneHandle,
  EventBlock,
  QueuedMessage,
  RuntimeLoggedEvent,
  SessionTab,
  TextBlock,
  ThinkingBlock,
  TokenStats,
  ToolBlock,
} from "@/lib/agent/session";
import { AssistantMarkdown } from "./assistant-markdown";
import {
  attachmentDedupKey,
  attachmentPrompt,
  createAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  formatFileSize,
  isImageAttachment,
  type ChatAttachment,
} from "./chat-attachments";

// Re-export the session module's public surface so existing imports from
// "./chat-pane" keep working during the incremental migration.
export type {
  AgentTurnSsePayload,
  AssistantBlock,
  ChatMessage,
  ChatPaneHandle,
  EventBlock,
  QueuedMessage,
  SessionTab,
  TextBlock,
  ThinkingBlock,
  TokenStats,
  ToolBlock,
};
export {
  drainQueueAfterAgentEnd,
  mergeCanonicalAndRuntimeEvents,
  parseAgentTurnSsePayload,
  reconcileQueueWithPiEvent,
  replayCursorAfterRuntimeHydration,
  replaySessionEvents,
  runtimeStatusAcceptsControl,
  runtimeStatusLooksActive,
  sessionTitleFromPrompt,
  statusAfterControlPhase,
  visibleQueuedMessages,
  visibleUserTextFromPi,
};
export const makeFreshTab = makeFreshTabImpl;

type Props = {
  paneId: string;
  // The unique runtime session id used as the PiRpcSession key on the server.
  runtimeSessionId: string;
  modelId: string;
  modelName: string | null;
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  projectName: string | null;
  projectSelector?: ReactNode;
  modelSelector?: ReactNode;
  gitBranch?: string | null;
  gitSummary?: {
    isRepo: boolean;
    additions: number;
    deletions: number;
    statusCount: number;
  } | null;
  onInitGit?: () => void;
  browserToolEnabled: boolean;
  onToggleBrowserTool: () => void;
  isFocused: boolean;
  onFocus: () => void;
  // Notify parent that we picked up a fresh pi session id (so the sidebar can
  // refresh its summary list).
  onPiSessionIdChange?: (sessionId: string) => void;
  // The pane's tab state lives in the parent so layout / persistence can see
  // and rehydrate it.
  tabs: SessionTab[];
  activeTabId: string;
  onTabsChange: (tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[])) => void;
  onClose?: () => void;
  // Workspace hands ChatPane a setter so it can register/unregister an
  // imperative handle. There is no useEffect-driven `initialSessionId` field
  // anymore — the workspace calls handle.loadAndReplay() directly when the
  // user clicks a session in the navbar. One source of truth, no race.
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
};

export function ChatPane({
  paneId,
  runtimeSessionId,
  modelId,
  modelName,
  modelsLoading,
  contextWindow,
  cwd,
  projectName,
  projectSelector,
  modelSelector,
  gitBranch,
  gitSummary,
  onInitGit,
  browserToolEnabled,
  onToggleBrowserTool,
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onTabsChange,
  onClose,
  onRegisterHandle,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [pluginRows, setPluginRows] = useState<ComposerPluginRef[]>([]);
  const [skillRows, setSkillRows] = useState<ComposerSkillRef[]>([]);
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const [compacting, setCompacting] = useState(false);
  const tabsRef = useRef(tabs);
  const localStreamTabsRef = useRef<Set<string>>(new Set());
  const liveAssistantIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
  const selectedPlugins = activeTab?.plugins ?? [];
  const computerUseLoaded = selectedPlugins.some((plugin) =>
    [plugin.id, plugin.name, plugin.path].some((value) =>
      value?.toLowerCase().includes("computer-use"),
    ),
  );
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  const mentionRows = useMemo(() => {
    if (!mention) return [];
    return mention.kind === "plugin"
      ? byQuery(pluginRows, mention.query, 8)
      : byQuery(skillRows, mention.query, 8);
  }, [mention, pluginRows, skillRows]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ plugins?: ComposerPluginRef[] }>)
        .then((payload) => payload.plugins ?? [])
        .catch(() => [] as ComposerPluginRef[]),
      fetch("/api/agent/skills", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ skills?: ComposerSkillRef[] }>)
        .then((payload) => payload.skills ?? [])
        .catch(() => [] as ComposerSkillRef[]),
    ]).then(([plugins, skills]) => {
      if (cancelled) return;
      setPluginRows(plugins);
      setSkillRows(skills);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateTab = useCallback(
    (tabId: string, patch: (tab: SessionTab) => SessionTab) => {
      onTabsChange((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? patch(tab) : tab)),
      );
    },
    [onTabsChange],
  );

  const selectMentionRow = useCallback(
    async (row: ComposerPluginRef | ComposerSkillRef) => {
      if (!activeTab || !mention) return;
      const selectedMention = mention;
      const input = consumeComposerMention(activeTab.input, selectedMention);
      let selectedRow = row;
      if ("path" in row && row.path) {
        const endpoint =
          selectedMention.kind === "skill"
            ? `/api/agent/skills/load?path=${encodeURIComponent(row.path)}`
            : `/api/agent/plugins/load?path=${encodeURIComponent(row.path)}`;
        const loaded = await fetch(endpoint, { cache: "no-store" })
          .then((res) =>
            res.ok
              ? (res.json() as Promise<{
                  skill?: ComposerSkillRef;
                  plugin?: ComposerPluginRef;
                }>)
              : null,
          )
          .catch(() => null);
        selectedRow = loaded?.skill
          ? { ...row, ...loaded.skill, id: row.id }
          : loaded?.plugin
            ? { ...row, ...loaded.plugin, id: row.id }
            : row;
      }
      updateTab(activeTab.id, (tab) => {
        if (selectedMention.kind === "plugin") {
          const plugins = tab.plugins ?? [];
          const plugin = activateComposerPlugin(selectedRow as ComposerPluginRef);
          return plugins.some((plugin) => plugin.id === selectedRow.id)
            ? { ...tab, input }
            : { ...tab, input, plugins: [...plugins, plugin] };
        }
        const skills = tab.skills ?? [];
        return skills.some((skill) => skill.id === selectedRow.id)
          ? { ...tab, input }
          : { ...tab, input, skills: [...skills, selectedRow as ComposerSkillRef] };
      });
      if (
        selectedMention.kind === "plugin" &&
        row.name.toLowerCase().includes("browser-use") &&
        !browserToolEnabled
      ) {
        onToggleBrowserTool();
      }
      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [activeTab, browserToolEnabled, mention, onToggleBrowserTool, updateTab],
  );

  const removeLoadedContext = useCallback(
    (kind: "plugin" | "skill", id: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        plugins:
          kind === "plugin"
            ? (tab.plugins ?? []).filter((plugin) => plugin.id !== id)
            : tab.plugins,
        skills:
          kind === "skill" ? (tab.skills ?? []).filter((skill) => skill.id !== id) : tab.skills,
      }));
    },
    [activeTab, updateTab],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (stickToBottomRef.current) {
      requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight }));
    }
  }, [activeTab?.messages, activeTab?.status]);

  const patchAssistant = useCallback(
    (tabId: string, assistantId: string, patch: (msg: ChatMessage) => ChatMessage) => {
      updateTab(tabId, (tab) => ({
        ...tab,
        messages: tab.messages.map((m) => (m.id === assistantId ? patch(m) : m)),
      }));
    },
    [updateTab],
  );

  const applyPiEvent = useCallback(
    (tabId: string, assistantId: string, event: Record<string, unknown>) => {
      const eventType = event.type;
      const currentAssistantId = () => liveAssistantIdsRef.current.get(tabId) ?? assistantId;
      const ensureNextAssistant = () => {
        const id = newId("assistant");
        liveAssistantIdsRef.current.set(tabId, id);
        updateTab(tabId, (tab) => ({
          ...tab,
          activeAssistantId: id,
          messages: [
            ...tab.messages,
            { id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
          ],
        }));
        return id;
      };
      const patchCurrentAssistant = (patch: (msg: ChatMessage) => ChatMessage) => {
        patchAssistant(tabId, currentAssistantId(), patch);
      };

      if (eventType === "queue_update") {
        updateTab(tabId, (tab) => ({
          ...tab,
          queue: reconcileQueueWithPiEvent(tab.queue ?? [], event),
        }));
        return;
      }
      if (eventType === "message_start" || eventType === "message_end") {
        const msg = event.message as
          | { role?: string; content?: string | Record<string, unknown>[] }
          | undefined;
        if (msg?.role === "user") {
          const text = visibleUserTextFromPi(messageText(msg.content));
          if (!text) return;
          const current = tabsRef.current.find((tab) => tab.id === tabId);
          const lastUser = [...(current?.messages ?? [])]
            .reverse()
            .find((entry) => entry.role === "user");
          if (lastUser && (lastUser.text === text || text.includes(lastUser.text))) return;
          updateTab(tabId, (tab) => {
            return {
              ...tab,
              messages: [
                ...tab.messages,
                { id: newId("user"), role: "user", text, timestamp: nowLabel() },
              ],
            };
          });
          ensureNextAssistant();
          return;
        }
      }
      const usage = usageFromEvent(event);
      if (usage) {
        updateTab(tabId, (tab) => ({ ...tab, tokenStats: usage }));
      }

      const compactionText = compactionTextFromEvent(event);
      if (compactionText) {
        patchCurrentAssistant((msg) => ({
          ...msg,
          blocks: appendEventBlock(msg.blocks ?? [], compactionText),
        }));
        return;
      }

      if (eventType === "message_update") {
        const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
        const updateType = ame?.type;
        if (updateType === "text_delta" && typeof ame?.delta === "string") {
          const delta = ame.delta;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: appendDelta(msg.blocks ?? [], "text", delta),
          }));
          return;
        }
        if (updateType === "thinking_delta" && typeof ame?.delta === "string") {
          const delta = ame.delta;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: appendDelta(msg.blocks ?? [], "thinking", delta),
          }));
          return;
        }
        if (updateType === "toolcall_start") {
          const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
          if (!snapshot) return;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              snapshot.id,
              (existing) => ({
                ...existing,
                name: snapshot.name,
                args: snapshot.args ?? existing.args,
              }),
              () => ({
                kind: "tool",
                id: snapshot.id,
                name: snapshot.name,
                status: "running",
                text: "",
                argsText: stringifyToolArgs(snapshot.args) ?? "",
                args: snapshot.args,
              }),
            ),
          }));
          return;
        }
        if (updateType === "toolcall_delta") {
          const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
          const delta = toolCallDeltaFromUpdate(ame);
          if (!snapshot || (!delta && !snapshot.args)) return;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              snapshot.id,
              (existing) => ({
                ...existing,
                name: snapshot.name || existing.name,
                args: snapshot.args ?? existing.args,
                argsText: delta
                  ? (existing.argsText ?? "") + delta
                  : existing.argsText || stringifyToolArgs(snapshot.args),
              }),
              () => ({
                kind: "tool",
                id: snapshot.id,
                name: snapshot.name,
                status: "running",
                text: "",
                argsText: delta || stringifyToolArgs(snapshot.args) || "",
                args: snapshot.args,
              }),
            ),
          }));
          return;
        }
        if (updateType === "toolcall_end") {
          const toolCall = ame?.toolCall as
            | { id?: string; name?: string; arguments?: unknown }
            | undefined;
          if (!toolCall) return;
          const id = toolCall.id || newId("tool");
          const name = toolCall.name || "tool";
          const argsText = JSON.stringify(toolCall.arguments ?? {}, null, 2);
          const argsObj =
            toolCall.arguments && typeof toolCall.arguments === "object"
              ? (toolCall.arguments as Record<string, unknown>)
              : undefined;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              id,
              (existing) => ({
                ...existing,
                name,
                argsText,
                args: argsObj ?? existing.args,
                text: existing.text || argsText,
              }),
              () => ({
                kind: "tool",
                id,
                name,
                status: "running",
                argsText,
                args: argsObj,
                text: argsText,
              }),
            ),
          }));
          return;
        }
      }

      if (eventType === "tool_execution_start") {
        const id = String(event.toolCallId || newId("tool"));
        const name = String(event.toolName || "tool");
        patchCurrentAssistant((msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            id,
            (existing) => existing,
            () => ({ kind: "tool", id, name, status: "running", text: "" }),
          ),
        }));
        return;
      }

      if (eventType === "tool_execution_update" || eventType === "tool_execution_end") {
        const id = String(event.toolCallId || "");
        if (!id) return;
        const resultText = extractToolText(event.partialResult || event.result);
        patchCurrentAssistant((msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            id,
            (existing) => ({
              ...existing,
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : existing.status,
              resultText: resultText || existing.resultText,
              // Keep `text` for legacy callers; prefer args text if present so
              // we don't blow away the file content with the tool's stdout.
              text: existing.argsText || existing.text || resultText,
            }),
            () => ({
              kind: "tool",
              id,
              name: "tool",
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : "running",
              resultText,
              text: resultText,
            }),
          ),
        }));
      }
    },
    [patchAssistant, updateTab],
  );

  const loadRuntimeStatus = useCallback(
    async (
      sessionId: string,
    ): Promise<{
      active?: boolean;
      running?: boolean;
      piSessionId?: string | null;
      eventSeq?: number;
      events?: RuntimeLoggedEvent[];
    } | null> => {
      try {
        const payload = await fetch(
          `/api/agent/runtime/status?sessionId=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        ).then((res) =>
          safeJson<{
            status?: {
              active?: boolean;
              running?: boolean;
              piSessionId?: string | null;
              eventSeq?: number;
            };
            events?: RuntimeLoggedEvent[];
          }>(res),
        );
        return payload.status ? { ...payload.status, events: payload.events ?? [] } : null;
      } catch {
        return null;
      }
    },
    [],
  );

  // Send a control-mode message (steer / follow_up) without taking ownership of
  // the long-running prompt stream.
  const sendControlMessage = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      runtime: string,
      tabId: string,
      piSessionId?: string | null,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!text.trim() || !modelId) return { ok: false };
      const selectedTab = tabsRef.current.find((tab) => tab.id === tabId);
      const plugins = activeComposerPlugins(selectedTab?.plugins ?? []);
      const skills = selectedTab?.skills ?? [];
      const message = selectedContextPrompt(text, plugins, skills);
      const ensureAssistantId = () => {
        const current = tabsRef.current.find((tab) => tab.id === tabId);
        const existing =
          (current?.activeAssistantId &&
            current.messages.some((entry) => entry.id === current.activeAssistantId) &&
            current.activeAssistantId) ||
          [...(current?.messages ?? [])].reverse().find((entry) => entry.role === "assistant")?.id;
        if (existing) return existing;
        const assistantId = newId("assistant");
        updateTab(tabId, (tab) => ({
          ...tab,
          activeAssistantId: assistantId,
          messages: [
            ...tab.messages,
            { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
          ],
        }));
        return assistantId;
      };
      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: runtime,
            modelId,
            message,
            cwd: cwd.trim() || undefined,
            piSessionId,
            mode,
            browserToolEnabled,
            plugins,
            skills,
          }),
        });
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Agent request failed: ${response.status}`);
        }
        // Drain the short SSE stream so the connection closes cleanly.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let controlError = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            const payload = parseAgentTurnSsePayload(line);
            if (payload?.type === "error") controlError = payload.error;
            if (payload?.type === "status") {
              updateTab(tabId, (tab) => ({
                ...tab,
                piSessionId: payload.piSessionId || tab.piSessionId,
                status: statusAfterControlPhase(tab.status, payload.phase),
              }));
            }
            if (payload?.type === "pi") {
              const eventId = piSessionIdFromEvent(payload.event);
              const assistantId = ensureAssistantId();
              const agentEnded = isAgentEndEvent(payload.event);
              updateTab(tabId, (tab) => ({
                ...tab,
                piSessionId: eventId || tab.piSessionId,
                lastEventSeq: typeof payload.seq === "number" ? payload.seq : tab.lastEventSeq,
                status: agentEnded ? "idle" : tab.status,
                activeAssistantId: agentEnded ? undefined : assistantId,
              }));
              if (eventId) onPiSessionIdChange?.(eventId);
              applyPiEvent(tabId, assistantId, payload.event);
            }
          }
        }
        if (controlError) throw new Error(controlError);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Message failed" };
      }
    },
    [applyPiEvent, browserToolEnabled, cwd, modelId, onPiSessionIdChange, updateTab],
  );

  const submitPrompt = useCallback(
    async (rawText: string, targetTabId?: string) => {
      const selectedTab =
        (targetTabId ? tabsRef.current.find((tab) => tab.id === targetTabId) : null) ?? activeTab;
      if (!selectedTab) return;
      const text = rawText.trim();
      if ((!text && attachments.length === 0) || !modelId || readingAttachments) return;

      const tabId = selectedTab.id;
      const userId = newId("user");
      const assistantId = newId("assistant");
      const runtime = selectedTab.runtimeSessionId || runtimeSessionId;
      const attachedText = attachmentPrompt(attachments);
      const attachmentSummary =
        attachments.length > 0
          ? `Attached: ${attachments.map((file) => file.name).join(", ")}`
          : "";
      const userText = text || attachmentSummary;
      const displayText = [text, attachmentSummary].filter(Boolean).join("\n\n");
      const contextText = selectedContextPrompt(
        text,
        activeComposerPlugins(selectedTab.plugins ?? []),
        selectedTab.skills ?? [],
      );
      const promptText = [contextText, attachedText].filter(Boolean).join("\n\n");

      // Optimistic update: show the user's turn + a blank assistant message.
      updateTab(tabId, (tab) => ({
        ...tab,
        cwd: tab.cwd || cwd,
        modelId: tab.modelId || modelId,
        startedAt: tab.startedAt ?? new Date().toISOString(),
        input: "",
        error: "",
        status: "starting",
        activeAssistantId: assistantId,
        title:
          tab.messages.filter((m) => m.role === "user").length === 0
            ? sessionTitleFromPrompt(userText)
            : tab.title,
        messages: [
          ...tab.messages,
          { id: userId, role: "user", text: displayText, timestamp: nowLabel() },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            blocks: [],
            timestamp: nowLabel(),
          },
        ],
      }));
      stickToBottomRef.current = true;
      setAttachments([]);
      setIsMultiline(false);
      if (textareaRef.current) textareaRef.current.style.height = "";
      if (fileInputRef.current) fileInputRef.current.value = "";

      let agentEnded = false;
      let streamError = "";
      liveAssistantIdsRef.current.set(tabId, assistantId);
      localStreamTabsRef.current.add(tabId);
      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: runtime,
            modelId,
            message: promptText,
            cwd: cwd.trim() || undefined,
            piSessionId:
              tabsRef.current.find((tab) => tab.id === tabId)?.piSessionId ??
              selectedTab.piSessionId,
            browserToolEnabled,
            plugins: activeComposerPlugins(selectedTab.plugins ?? []),
            skills: selectedTab.skills ?? [],
          }),
        });
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Agent request failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            const payload = parseAgentTurnSsePayload(line);
            if (!payload) continue;
            if (payload.type === "status") {
              const phase = payload.phase;
              updateTab(tabId, (tab) => ({
                ...tab,
                piSessionId: payload.piSessionId || tab.piSessionId,
                status: phase === "done" ? "idle" : phase,
                activeAssistantId: phase === "done" ? undefined : tab.activeAssistantId,
              }));
              if (payload.piSessionId) onPiSessionIdChange?.(payload.piSessionId);
            } else if (payload.type === "error") {
              streamError = payload.error;
              updateTab(tabId, (tab) => ({ ...tab, error: payload.error, status: "idle" }));
            } else if (payload.type === "pi") {
              const piEvent = payload.event;
              const eventId = piSessionIdFromEvent(piEvent);
              if (eventId) {
                updateTab(tabId, (tab) => ({ ...tab, piSessionId: eventId }));
                onPiSessionIdChange?.(eventId);
              }
              if (typeof payload.seq === "number") {
                updateTab(tabId, (tab) => ({ ...tab, lastEventSeq: payload.seq }));
              }
              if (isAgentEndEvent(piEvent)) {
                agentEnded = true;
                const latestPiSessionId =
                  eventId ??
                  tabsRef.current.find((tab) => tab.id === tabId)?.piSessionId ??
                  selectedTab.piSessionId ??
                  "";
                onPiSessionIdChange?.(latestPiSessionId);
              }
              applyPiEvent(tabId, assistantId, piEvent);
            }
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err.message : "Agent request failed";
      } finally {
        localStreamTabsRef.current.delete(tabId);
        liveAssistantIdsRef.current.delete(tabId);
        const runtimeStatus = agentEnded ? null : await loadRuntimeStatus(runtime);
        const currentPiSessionId =
          tabsRef.current.find((tab) => tab.id === tabId)?.piSessionId ??
          selectedTab.piSessionId ??
          null;
        const runtimeStillActive = runtimeStatus
          ? runtimeStatusLooksActive(runtimeStatus) &&
            (!runtimeStatus.piSessionId ||
              !currentPiSessionId ||
              runtimeStatus.piSessionId === currentPiSessionId)
          : false;
        updateTab(tabId, (tab) => ({
          ...tab,
          status: runtimeStillActive ? "running" : "idle",
          activeAssistantId: runtimeStillActive ? assistantId : undefined,
          error: streamError
            ? runtimeStillActive
              ? `${streamError}; reattaching to the running session.`
              : streamError
            : tab.error,
        }));
      }

      // Drain queued messages once the agent finished its run.
      if (agentEnded) {
        const queued = (tabsRef.current.find((tab) => tab.id === tabId)?.queue ?? []).slice();
        const { next, remaining } = drainQueueAfterAgentEnd(queued);
        if (next) {
          updateTab(tabId, (tab) => ({ ...tab, queue: remaining }));
          // Schedule on the next tick so React commits the optimistic
          // update before we kick off the next prompt.
          setTimeout(() => void submitPromptRef.current?.(next.text, tabId), 0);
        } else if (queued.length > 0) {
          updateTab(tabId, (tab) => ({ ...tab, queue: remaining }));
        }
      }
    },
    [
      activeTab,
      attachments,
      modelId,
      readingAttachments,
      runtimeSessionId,
      cwd,
      browserToolEnabled,
      onPiSessionIdChange,
      applyPiEvent,
      loadRuntimeStatus,
      updateTab,
    ],
  );

  // Stable ref so the queue-drain inside submitPrompt can re-enter without
  // forming a useCallback cycle.
  const submitPromptRef = useRef<(text: string, targetTabId?: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  useEffect(() => {
    submitPromptRef.current = submitPrompt;
  }, [submitPrompt]);

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      if ((!text && attachments.length === 0) || !modelId || readingAttachments) return;

      // While running, Enter sends a steering message. If the UI is stale
      // (Pi has already ended but the composer still says running), fall back
      // to a normal prompt so the model actually sees the message.
      if (running) {
        if (!text) return;
        const runtime = activeTab.runtimeSessionId || runtimeSessionId;
        const status = await loadRuntimeStatus(runtime);
        if (!runtimeStatusAcceptsControl(status, activeTab.piSessionId)) {
          updateTab(activeTab.id, (tab) => ({
            ...tab,
            status: "idle",
            activeAssistantId: undefined,
          }));
          await submitPrompt(text, activeTab.id);
          return;
        }
        const queuedId = newId("queue");
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          input: "",
          error: "",
          queue: [...(tab.queue ?? []), { id: queuedId, mode: "steer", text, sent: true }],
        }));
        const result = await sendControlMessage(
          "steer",
          text,
          runtime,
          activeTab.id,
          activeTab.piSessionId,
        );
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          queue: (tab.queue ?? []).filter((item) => item.id !== queuedId),
          ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
        }));
        return;
      }
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      const status = await loadRuntimeStatus(runtime);
      if (status && runtimeStatusAcceptsControl(status, activeTab.piSessionId)) {
        const queuedId = newId("queue");
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          input: "",
          error: "",
          queue: [...(tab.queue ?? []), { id: queuedId, mode: "steer", text, sent: true }],
        }));
        const result = await sendControlMessage(
          "steer",
          text,
          runtime,
          activeTab.id,
          activeTab.piSessionId,
        );
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          queue: (tab.queue ?? []).filter((item) => item.id !== queuedId),
          ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
        }));
        return;
      }

      await submitPrompt(text, activeTab.id);
    },
    [
      activeTab,
      attachments.length,
      modelId,
      readingAttachments,
      running,
      runtimeSessionId,
      loadRuntimeStatus,
      sendControlMessage,
      submitPrompt,
      updateTab,
    ],
  );

  // Tab-key behavior: when idle, submit immediately; while a turn is running,
  // send an actual Pi follow-up so Pi owns queue ordering and the original
  // runtime stream continues into the queued turn.
  const queueMessage = useCallback(async () => {
    if (!activeTab) return;
    const text = activeTab.input.trim();
    if (!text || !modelId) return;
    const tabId = activeTab.id;
    if (!running) {
      await submitPromptRef.current(text, tabId);
      return;
    }
    const runtime = activeTab.runtimeSessionId || runtimeSessionId;
    const status = await loadRuntimeStatus(runtime);
    if (!runtimeStatusAcceptsControl(status, activeTab.piSessionId)) {
      updateTab(tabId, (tab) => ({ ...tab, status: "idle", activeAssistantId: undefined }));
      await submitPromptRef.current(text, tabId);
      return;
    }
    const queuedId = newId("queue");
    updateTab(tabId, (tab) => ({
      ...tab,
      cwd: tab.cwd || cwd,
      input: "",
      error: "",
      queue: [...(tab.queue ?? []), { id: queuedId, mode: "follow_up", text }],
    }));
    const result = await sendControlMessage(
      "follow_up",
      text,
      runtime,
      tabId,
      activeTab.piSessionId,
    );
    updateTab(tabId, (tab) => ({
      ...tab,
      queue: (tab.queue ?? []).map((item) =>
        item.id === queuedId ? { ...item, sent: result.ok } : item,
      ),
      ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
    }));
  }, [
    activeTab,
    modelId,
    running,
    cwd,
    loadRuntimeStatus,
    runtimeSessionId,
    sendControlMessage,
    updateTab,
  ]);

  const removeQueued = useCallback(
    (queueId: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        queue: (tab.queue ?? []).filter((entry) => entry.id !== queueId),
      }));
    },
    [activeTab, updateTab],
  );

  const attachFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const fileArray = files ? Array.from(files) : [];
      if (fileArray.length === 0 || !activeTab) return;
      if (running) {
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          error: "Pause or wait for the current turn before attaching files.",
        }));
        return;
      }
      setReadingAttachments(true);
      try {
        const next = await Promise.all(fileArray.map((file) => createAttachment(file)));
        setAttachments((current) => {
          const seen = new Set(current.map(attachmentDedupKey));
          const uniqueNext: ChatAttachment[] = [];
          next.forEach((file) => {
            const key = attachmentDedupKey(file);
            if (seen.has(key)) return;
            seen.add(key);
            uniqueNext.push(file);
          });
          return [...current, ...uniqueNext];
        });
        updateTab(activeTab.id, (tab) => ({ ...tab, error: "" }));
      } catch (err) {
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          error: err instanceof Error ? err.message : "Failed to attach file",
        }));
      } finally {
        setReadingAttachments(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [activeTab, running, updateTab],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromDataTransfer(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void attachFiles(files);
    },
    [attachFiles],
  );

  const handleComposerDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = running ? "none" : "copy";
      setComposerDragActive(true);
    },
    [running],
  );

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setComposerDragActive(false);
  }, []);

  const handleComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setComposerDragActive(false);
      void attachFiles(filesFromDataTransfer(event.dataTransfer));
    },
    [attachFiles],
  );

  const abortTurn = useCallback(async () => {
    if (!activeTab) return;
    const tabId = activeTab.id;
    await fetch("/api/agent/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeTab.runtimeSessionId || runtimeSessionId }),
    }).catch(() => undefined);
    updateTab(tabId, (tab) => ({ ...tab, status: "idle" }));
  }, [activeTab, runtimeSessionId, updateTab]);

  const resumeRuntimeTabId =
    activeTab && (activeTab.status === "running" || activeTab.status === "starting")
      ? activeTab.id
      : null;
  const resumeRuntimeSessionId = resumeRuntimeTabId
    ? activeTab?.runtimeSessionId || runtimeSessionId
    : null;

  useEffect(() => {
    if (!resumeRuntimeTabId || !resumeRuntimeSessionId) return;
    if (localStreamTabsRef.current.has(resumeRuntimeTabId)) return;
    let closed = false;
    const current = tabsRef.current.find((tab) => tab.id === resumeRuntimeTabId);
    const params = new URLSearchParams({
      sessionId: resumeRuntimeSessionId,
      after: String(current?.lastEventSeq ?? 0),
    });
    const source = new EventSource(`/api/agent/runtime/events?${params.toString()}`);

    const ensureAssistantId = (): string => {
      const current = tabsRef.current.find((tab) => tab.id === resumeRuntimeTabId);
      const existing =
        (current?.activeAssistantId &&
          current.messages.some((message) => message.id === current.activeAssistantId) &&
          current.activeAssistantId) ||
        [...(current?.messages ?? [])].reverse().find((message) => message.role === "assistant")
          ?.id;
      if (existing) {
        updateTab(resumeRuntimeTabId, (tab) => ({ ...tab, activeAssistantId: existing }));
        return existing;
      }
      const assistantId = newId("assistant");
      updateTab(resumeRuntimeTabId, (tab) => ({
        ...tab,
        activeAssistantId: assistantId,
        messages: [
          ...tab.messages,
          { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
        ],
      }));
      return assistantId;
    };

    source.onmessage = (event) => {
      if (closed) return;
      let payload:
        | { type: "status"; phase: string; session?: { piSessionId?: string | null } }
        | { type: "pi"; seq?: number; event: Record<string, unknown> };
      try {
        payload = JSON.parse(event.data) as typeof payload;
      } catch {
        return;
      }
      if (payload.type === "status") {
        updateTab(resumeRuntimeTabId, (tab) => ({
          ...tab,
          piSessionId: payload.session?.piSessionId || tab.piSessionId,
          status: payload.phase === "done" || payload.phase === "idle" ? "idle" : "running",
          activeAssistantId:
            payload.phase === "done" || payload.phase === "idle"
              ? undefined
              : tab.activeAssistantId,
        }));
        return;
      }
      if (payload.type === "pi") {
        const eventId = piSessionIdFromEvent(payload.event);
        const assistantId = ensureAssistantId();
        const agentEnded = isAgentEndEvent(payload.event);
        updateTab(resumeRuntimeTabId, (tab) => ({
          ...tab,
          piSessionId: eventId || tab.piSessionId,
          lastEventSeq: typeof payload.seq === "number" ? payload.seq : tab.lastEventSeq,
          status: agentEnded ? "idle" : "running",
          activeAssistantId: agentEnded ? undefined : assistantId,
        }));
        if (eventId) onPiSessionIdChange?.(eventId);
        applyPiEvent(resumeRuntimeTabId, assistantId, payload.event);
        if (agentEnded) {
          const queued = (
            tabsRef.current.find((tab) => tab.id === resumeRuntimeTabId)?.queue ?? []
          ).slice();
          const { next, remaining } = drainQueueAfterAgentEnd(queued);
          if (next) {
            updateTab(resumeRuntimeTabId, (tab) => ({ ...tab, queue: remaining }));
            setTimeout(() => void submitPromptRef.current?.(next.text, resumeRuntimeTabId), 0);
          } else if (queued.length > 0) {
            updateTab(resumeRuntimeTabId, (tab) => ({ ...tab, queue: remaining }));
          }
        }
      }
    };
    source.onerror = () => {
      if (closed) return;
      void fetch(
        `/api/agent/runtime/status?sessionId=${encodeURIComponent(resumeRuntimeSessionId)}`,
        { cache: "no-store" },
      )
        .then((res) =>
          safeJson<{ status?: { active?: boolean; piSessionId?: string | null } }>(res),
        )
        .then((payload) => {
          if (closed) return;
          if (payload.status?.active) {
            updateTab(resumeRuntimeTabId, (tab) => ({
              ...tab,
              piSessionId: payload.status?.piSessionId || tab.piSessionId,
              status: "running",
            }));
            return;
          }
          source.close();
          updateTab(resumeRuntimeTabId, (tab) =>
            tab.status === "running" || tab.status === "starting"
              ? { ...tab, status: "idle", activeAssistantId: undefined }
              : tab,
          );
        })
        .catch(() => {
          // Keep EventSource's built-in retry path alive for transient drops.
        });
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [
    applyPiEvent,
    onPiSessionIdChange,
    resumeRuntimeSessionId,
    resumeRuntimeTabId,
    runtimeSessionId,
    updateTab,
  ]);

  // Replay a past pi session into the currently active tab. Looks up the
  // active tab by id at call time so concurrent updates don't race.
  const loadAndReplay = useCallback(
    async (piSessionId: string) => {
      if (!cwd) return;
      const tabId = activeTabId;
      if (!tabId) return;
      updateTab(tabId, (tab) => ({ ...tab, status: "loading", error: "" }));
      try {
        const response = await fetch(
          `/api/agent/sessions/${encodeURIComponent(piSessionId)}?cwd=${encodeURIComponent(cwd)}`,
          { cache: "no-store" },
        );
        const payload = await safeJson<{
          events?: Record<string, unknown>[];
          error?: string;
        }>(response);
        if (!response.ok) throw new Error(payload.error || "Failed to load session");

        const runtimeId =
          tabsRef.current.find((tab) => tab.id === tabId)?.runtimeSessionId || runtimeSessionId;
        const runtimeStatus = await loadRuntimeStatus(runtimeId);
        const runtimeActive =
          runtimeStatus?.active === true &&
          (!runtimeStatus.piSessionId || runtimeStatus.piSessionId === piSessionId);
        const replayEvents = mergeCanonicalAndRuntimeEvents(
          payload.events ?? [],
          runtimeActive ? runtimeStatus?.events : [],
        );
        const { messages, title, startedAt } = replaySessionEvents(replayEvents);
        const tokenStats = [...replayEvents]
          .reverse()
          .map(usageFromEvent)
          .find((stats): stats is TokenStats => Boolean(stats));
        const replaySeq = replayCursorAfterRuntimeHydration(runtimeActive, runtimeStatus?.eventSeq);

        updateTab(tabId, (tab) => ({
          ...tab,
          messages,
          piSessionId,
          cwd: tab.cwd || cwd,
          modelId: tab.modelId || modelId,
          title: title ?? tab.title,
          startedAt: startedAt ?? tab.startedAt,
          tokenStats: tokenStats ?? tab.tokenStats,
          status: runtimeActive ? "running" : "idle",
          activeAssistantId: undefined,
          lastEventSeq: replaySeq,
          error: "",
        }));
      } catch (err) {
        updateTab(tabId, (tab) => ({
          ...tab,
          error: err instanceof Error ? err.message : "Failed to load session",
          status: "idle",
        }));
      }
    },
    [cwd, modelId, activeTabId, runtimeSessionId, loadRuntimeStatus, updateTab],
  );

  // Register a stable imperative handle so the workspace can call
  // loadAndReplay directly from event handlers. This replaces the previous
  // useEffect that watched an `initialSessionId` prop and chained side
  // effects on every re-render.
  const handleRef = useRef<ChatPaneHandle>({ loadAndReplay });
  handleRef.current = { loadAndReplay };
  useEffect(() => {
    if (!onRegisterHandle) return;
    const handle: ChatPaneHandle = {
      loadAndReplay: (id) => handleRef.current.loadAndReplay(id),
    };
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [onRegisterHandle]);

  const queue = activeTab?.queue ?? [];
  const visibleQueueItems = visibleQueuedMessages(queue);
  const visibleQueue = queueExpanded ? visibleQueueItems : visibleQueueItems.slice(-1);
  const latestQueued = visibleQueueItems[visibleQueueItems.length - 1] ?? null;
  const compactSession = useCallback(async () => {
    if (!activeTab || running || compacting || !modelId) return;
    setCompacting(true);
    updateTab(activeTab.id, (tab) => ({ ...tab, error: "" }));
    try {
      const response = await fetch("/api/agent/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeTab.runtimeSessionId || runtimeSessionId,
          modelId,
          cwd: cwd.trim() || undefined,
          piSessionId: activeTab.piSessionId,
          browserToolEnabled,
          plugins: activeComposerPlugins(activeTab.plugins ?? []),
          skills: activeTab.skills ?? [],
        }),
      });
      const payload = await safeJson<{ error?: string; status?: { piSessionId?: string | null } }>(
        response,
      );
      if (!response.ok) throw new Error(payload.error || "Compaction failed");
      const nextSessionId = payload.status?.piSessionId || activeTab.piSessionId;
      if (nextSessionId) await loadAndReplay(nextSessionId);
    } catch (error) {
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        error: error instanceof Error ? error.message : "Compaction failed",
      }));
    } finally {
      setCompacting(false);
    }
  }, [
    activeTab,
    browserToolEnabled,
    compacting,
    cwd,
    loadAndReplay,
    modelId,
    running,
    runtimeSessionId,
    updateTab,
  ]);

  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--bg)"
    >
      {onClose ? (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute right-12 top-2 z-30 inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          aria-label="Close pane"
          title="Close pane"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      ) : null}
      {activeTab?.error ? (
        <div className="border-b border-(--border) bg-(--err)/10 px-4 py-2 text-xs text-(--err)">
          {activeTab.error}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const distanceFromBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight;
          stickToBottomRef.current = distanceFromBottom <= 80;
        }}
        className={`min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2 ${showEmptyPrompt ? "flex" : ""}`}
      >
        <div
          className={`mx-auto w-full max-w-[var(--thread-w)] ${showEmptyPrompt ? "flex flex-1" : ""}`}
        >
          {showEmptyPrompt ? (
            <div className="flex flex-1 items-center justify-center text-center text-[26px] font-medium leading-[1.35] text-(--fg)">
              <p className="max-w-[680px]">
                A dream is something you build for yourself.
                <br />
                Just talk to it.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {(activeTab?.messages ?? [])
                .filter((m) => m.role !== "system")
                .map((message) => (
                  <TimelineMessage key={message.id} message={message} />
                ))}
              {running ? (
                <div className="flex items-center gap-2 py-4 text-xs text-(--dim)">
                  <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-(--accent)" />
                  <span className="animate-pulse">Pi is {activeTab?.status}…</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={sendMessage} className="shrink-0 bg-(--bg) px-6 pb-2 pt-1">
        {visibleQueueItems.length > 0 ? (
          <div className="mx-auto mb-1 w-[85%] max-w-[var(--composer-w)] overflow-hidden rounded-lg bg-(--composer) px-4 py-2 text-[11px] text-(--fg)">
            <button
              type="button"
              onClick={() => setQueueExpanded((value) => !value)}
              className="flex w-full min-w-0 items-center gap-2 text-left"
              aria-expanded={queueExpanded}
              title="Queued follow-ups and steers"
            >
              <ChevronDownIcon
                className={`h-3 w-3 shrink-0 text-(--dim) transition-transform ${
                  queueExpanded ? "rotate-180" : "-rotate-90"
                }`}
              />
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-(--dim)">
                queue {visibleQueueItems.length}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {latestQueued?.text ?? "No queued message"}
              </span>
            </button>
            {queueExpanded ? (
              <div className="mt-1 space-y-0.5">
                {visibleQueue.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-w-0 items-center gap-2 py-1"
                    title={`${item.mode === "steer" ? "Steer" : "Queued follow-up"}: ${item.text}`}
                  >
                    <span
                      className={`shrink-0 font-mono text-[10px] uppercase tracking-wide ${
                        item.mode === "steer" ? "text-(--accent)" : "text-(--dim)"
                      }`}
                    >
                      {item.mode === "steer" ? "steer" : "queue"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.text}</span>
                    <button
                      type="button"
                      onClick={() => removeQueued(item.id)}
                      className="shrink-0 p-0.5 text-(--dim) hover:text-(--fg)"
                      aria-label="Remove queued message"
                      title="Remove queued message"
                    >
                      <CloseIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
          className={`mx-auto max-w-[var(--composer-w)] overflow-visible rounded-lg bg-(--composer) shadow-none transition-colors ${
            composerDragActive ? "outline outline-1 outline-(--accent)/50" : ""
          }`}
        >
          {composerDragActive ? (
            <div className="px-4 pt-2 text-[11px] text-(--accent)">
              Drop files to attach to the next message.
            </div>
          ) : null}
          {(activeTab?.plugins?.length ?? 0) + (activeTab?.skills?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2 text-[11px]">
              {(activeTab?.plugins ?? []).map((plugin) => (
                <LoadedContextTab
                  key={`plugin-${plugin.id}`}
                  prefix="@"
                  label={plugin.displayName ?? plugin.name}
                  title={plugin.path}
                  active={plugin.name.toLowerCase().includes("computer-use")}
                  onRemove={() => removeLoadedContext("plugin", plugin.id)}
                />
              ))}
              {(activeTab?.skills ?? []).map((skill) => (
                <LoadedContextTab
                  key={`skill-${skill.id}`}
                  prefix="$"
                  label={skill.name}
                  title={skill.path}
                  active={false}
                  onRemove={() => removeLoadedContext("skill", skill.id)}
                />
              ))}
            </div>
          ) : null}
          {mention ? (
            <div className="px-4 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-(--dim)">
                {mention.kind === "plugin" ? "Plugins" : "Skills"}
              </div>
              {mentionRows.length ? (
                <div className="grid gap-1">
                  {mentionRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void selectMentionRow(row)}
                      className="flex min-w-0 items-start justify-between gap-3 py-1 text-left text-(--dim) hover:text-(--fg)"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] text-(--fg)">
                          {mention.kind === "plugin" ? "@" : "$"}
                          {mentionRowTitle(row)}
                          {mentionRowVersion(row) ? (
                            <span className="ml-1 font-mono text-[10px] text-(--dim)">
                              {mentionRowVersion(row)}
                            </span>
                          ) : null}
                        </span>
                        {mentionRowDescription(row) ? (
                          <span className="block truncate text-[10.5px] text-(--dim)">
                            {mentionRowDescription(row)}
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate font-mono text-[10px] text-(--dim)">
                        {row.source ?? ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-2 py-1 text-[11px] text-(--dim)">
                  No {mention.kind === "plugin" ? "plugins" : "skills"} match{" "}
                  <span className="font-mono">{mention.query || "…"}</span>.
                </div>
              )}
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-4 pt-2">
              {attachments.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex max-w-[220px] items-center gap-1 px-1 py-0.5 text-[11px] text-(--dim)"
                  title={`${file.name} · ${file.type} · ${formatFileSize(file.size)}${file.path ? ` · ${file.path}` : ""}`}
                >
                  {isImageAttachment(file) ? (
                    // Keep composer image previews intentionally small; the
                    // attachment is still sent at full inline/file fidelity.
                    <img
                      src={file.content}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <FileIcon className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 opacity-70">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) => current.filter((item) => item.id !== file.id))
                    }
                    className="p-0.5 hover:text-(--fg)"
                    aria-label={`Remove ${file.name}`}
                    title={`Remove ${file.name}`}
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={activeTab?.input ?? ""}
            onPaste={handleComposerPaste}
            onChange={(event) => {
              const value = event.target.value;
              if (!activeTab) return;
              updateTab(activeTab.id, (tab) => ({ ...tab, input: value }));
              setMention(detectComposerMention(value, event.currentTarget.selectionStart));
              const element = event.currentTarget;
              if (!value) {
                element.style.height = "";
                setIsMultiline(false);
                setMention(null);
                return;
              }
              element.style.height = "auto";
              element.style.height = `${element.scrollHeight}px`;
              setIsMultiline(element.scrollHeight > 38);
            }}
            onKeyDown={(event) => {
              if (mention) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMention(null);
                  return;
                }
                if ((event.key === "Enter" || event.key === "Tab") && mentionRows[0]) {
                  event.preventDefault();
                  selectMentionRow(mentionRows[0]);
                  return;
                }
              }
              // Enter (no shift) → send. While running, this becomes a steer.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
                return;
              }
              // Tab → queue (follow-up). Captured even while running so the
              // user can pile up tasks while the agent is working.
              if (event.key === "Tab" && !event.shiftKey) {
                if (!activeTab?.input.trim()) return;
                event.preventDefault();
                void queueMessage();
                return;
              }
              // Esc → pause (abort). Cmd/Ctrl+. for parity.
              if (
                event.key === "Escape" ||
                (event.key === "." && (event.metaKey || event.ctrlKey))
              ) {
                if (running) {
                  event.preventDefault();
                  void abortTurn();
                }
              }
            }}
            placeholder={
              !modelName && modelsLoading
                ? "Loading models…"
                : !modelName
                  ? "No models available — check /v1/models"
                  : running
                    ? `Steer ${modelName} (Enter) · queue with Tab · Esc to pause`
                    : `Ask ${modelName} (Enter) · queue with Tab · paste/drop files`
            }
            className="min-h-[42px] max-h-[132px] w-full resize-none overflow-y-auto bg-transparent px-4 py-2.5 text-sm leading-5 text-(--fg) outline-none placeholder:text-(--dim)"
          />
          <div className="flex min-h-10 items-center gap-1.5 overflow-hidden bg-transparent px-3 pb-2 pt-1 text-xs">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void attachFiles(event.currentTarget.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={readingAttachments || running}
              className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--dim) hover:text-(--fg) disabled:opacity-30"
              aria-label="Attach files"
              title="Attach files (or paste/drop into composer)"
            >
              <AttachIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleBrowserTool}
              aria-pressed={browserToolEnabled}
              title={
                browserToolEnabled
                  ? "Browser tool: ON — agent can drive the browser"
                  : "Browser tool: OFF — click to let the agent navigate, click, fill, and read pages"
              }
              className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${
                browserToolEnabled ? "text-(--accent)" : "text-(--dim) hover:text-(--fg)"
              }`}
            >
              <span className="relative inline-flex">
                <GlobeIcon className="h-3.5 w-3.5" />
                {computerUseLoaded ? <ComputerUseActivityDot /> : null}
              </span>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {modelSelector}
              {running ? (
                <>
                  {activeTab?.input.trim() ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void queueMessage()}
                        className="inline-flex !h-7 !min-h-7 shrink-0 items-center px-1.5 text-[11px] text-(--dim) underline-offset-2 hover:text-(--fg) hover:underline"
                        title="Queue (Tab)"
                      >
                        Queue
                      </button>
                      <button
                        type="submit"
                        className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1 rounded-md bg-(--accent)/10 px-2 text-[11px] text-(--accent) hover:bg-(--accent)/15 hover:text-(--fg)"
                        title="Steer (Enter): interrupt current turn and send"
                      >
                        <SendIcon className="h-3 w-3" /> Steer
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void abortTurn()}
                    className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1 px-2 text-xs text-(--dim) hover:text-(--fg)"
                    title="Pause (Esc)"
                  >
                    <StopIcon className="h-3 w-3" /> Pause
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  disabled={
                    (!activeTab?.input.trim() && attachments.length === 0) ||
                    !modelId ||
                    readingAttachments
                  }
                  className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--fg) hover:text-(--accent) disabled:opacity-30"
                  aria-label="Send"
                  title="Send (Enter) · Queue (Tab)"
                >
                  <SendIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="mx-auto mt-0.5 flex max-w-[var(--composer-w)] items-center gap-2 overflow-hidden font-mono text-[10px] text-(--dim)">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <button
              type="button"
              onClick={() => void compactSession()}
              disabled={running || compacting || !activeTab?.piSessionId || !modelId}
              className="inline-flex shrink-0 items-center gap-1 text-(--dim) hover:text-(--fg) disabled:pointer-events-none disabled:opacity-30"
              title="Compact this Pi session context"
            >
              {compacting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              compact
            </button>
            <span className="shrink-0 text-(--border)">·</span>
            <div className="min-w-0 max-w-[42%] shrink">
              {projectSelector ? (
                projectSelector
              ) : cwd ? (
                <span className="block min-w-0 truncate text-(--dim)" title={cwd}>
                  {cwd}
                </span>
              ) : null}
            </div>
            {gitBranch ? (
              <span className="inline-flex min-w-0 shrink items-center gap-1 text-(--dim)">
                <GitBranchIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{gitBranch}</span>
              </span>
            ) : gitSummary && !gitSummary.isRepo ? (
              <button
                type="button"
                onClick={onInitGit}
                className="inline-flex shrink-0 items-center gap-1 text-(--dim) hover:text-(--fg)"
                title="Init git"
              >
                <GitBranchIcon className="h-3 w-3" />
                git
              </button>
            ) : null}
            {gitSummary?.isRepo ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                <span className="text-emerald-400">+{gitSummary.additions}</span>
                <span className="text-red-400">-{gitSummary.deletions}</span>
                {gitSummary.statusCount > 0 ? (
                  <span className="text-(--dim)">· {gitSummary.statusCount} files</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <span>R {formatTokenCount(activeTab?.tokenStats?.read ?? 0)}</span>
            <span>W {formatTokenCount(activeTab?.tokenStats?.write ?? 0)}</span>
            <span>
              {formatTokenCount(activeTab?.tokenStats?.current ?? 0)}/
              {formatTokenCount(contextWindow)}
            </span>
          </div>
        </div>
      </form>
    </section>
  );
}

function mentionRowTitle(row: ComposerPluginRef | ComposerSkillRef): string {
  return ("displayName" in row && row.displayName) || row.name;
}

function mentionRowVersion(row: ComposerPluginRef | ComposerSkillRef): string | undefined {
  return "version" in row ? row.version : undefined;
}

function mentionRowDescription(row: ComposerPluginRef | ComposerSkillRef): string | undefined {
  return "shortDescription" in row ? row.shortDescription : undefined;
}

function LoadedContextTab({
  prefix,
  label,
  title,
  active,
  onRemove,
}: {
  prefix: "@" | "$";
  label: string;
  title?: string;
  active?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      className="inline-flex max-w-[240px] items-center gap-1 py-0.5 text-[11px] text-(--fg)"
      title={title ?? label}
    >
      <span className="font-mono text-(--accent)">{prefix}</span>
      {active ? <ComputerUseActivityDot inline /> : null}
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 text-(--dim) hover:text-(--fg)"
        aria-label={`Unload ${prefix}${label}`}
        title={`Unload ${prefix}${label}`}
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </span>
  );
}

function ComputerUseActivityDot({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={
        inline
          ? "relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
          : "absolute -right-1.5 -top-1 inline-flex h-2.5 w-2.5 items-center justify-center"
      }
      aria-hidden="true"
    >
      <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-(--accent)/35" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-(--accent)" />
    </span>
  );
}

function TimelineMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="max-w-[72%] rounded-xl bg-(--surface) px-3.5 py-2 text-sm leading-6 text-(--fg)">
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
        </div>
      </article>
    );
  }
  const blocks = message.blocks ?? [];
  return (
    <article className="min-w-0">
      {blocks.length === 0 ? (
        <div className="text-sm leading-6 text-(--dim)">…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block) => {
            if (block.kind === "thinking") {
              return (
                <details key={block.id} className="text-xs" open>
                  <summary className="cursor-pointer list-none text-[11px] italic text-(--dim) hover:text-(--fg)">
                    Thinking
                  </summary>
                  <pre className="mt-2 max-w-full whitespace-pre-wrap break-words border-l-2 border-(--border) pl-3 font-mono text-[11px] leading-5 text-(--dim) [overflow-wrap:anywhere]">
                    {block.text}
                  </pre>
                </details>
              );
            }
            if (block.kind === "text") {
              return <AssistantMarkdown key={block.id} text={block.text} />;
            }
            if (block.kind === "event") {
              return (
                <div
                  key={block.id}
                  className="flex items-center gap-3 py-1 text-[11px] text-(--dim)"
                >
                  <span className="h-px flex-1 bg-(--border)" />
                  <span>{block.text}</span>
                  <span className="h-px flex-1 bg-(--border)" />
                </div>
              );
            }
            return <ToolBlockView key={block.id} block={block} />;
          })}
        </div>
      )}
    </article>
  );
}

// ----- Tool block rendering -----

const FILE_WRITE_TOOL_NAMES = new Set([
  "write_file",
  "write",
  "create_file",
  "edit_file",
  "edit",
  "apply_patch",
  "apply_edit",
  "replace_file",
  "str_replace_editor",
]);

const LANG_BY_EXT: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  json: "json",
  md: "md",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  py: "py",
  rs: "rs",
  go: "go",
  sh: "sh",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
};

function detectLang(filePath: string | null | undefined): string {
  if (!filePath) return "";
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "";
  const ext = filePath.slice(dot + 1).toLowerCase();
  return LANG_BY_EXT[ext] ?? "";
}

// Try to extract a streaming-friendly preview of "what file is being written"
// from the partially-parsed tool args. We accept partial JSON: greedy extract
// the value of the most likely "content" / "text" / "patch" key.
function extractPartialField(argsText: string, keys: string[]): string | null {
  if (!argsText) return null;
  for (const key of keys) {
    const needle = `"${key}"`;
    const idx = argsText.indexOf(needle);
    if (idx === -1) continue;
    // Find the colon and the opening quote of the value.
    const colon = argsText.indexOf(":", idx + needle.length);
    if (colon === -1) continue;
    let i = colon + 1;
    while (i < argsText.length && /\s/.test(argsText[i])) i += 1;
    if (argsText[i] !== '"') continue;
    let j = i + 1;
    let out = "";
    while (j < argsText.length) {
      const ch = argsText[j];
      if (ch === "\\") {
        const next = argsText[j + 1];
        if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else if (next === "r") out += "\r";
        else if (next === '"') out += '"';
        else if (next === "\\") out += "\\";
        else if (next === undefined) break;
        else out += next;
        j += 2;
        continue;
      }
      if (ch === '"') return out;
      out += ch;
      j += 1;
    }
    // Unterminated string — return what we have so far for live streaming.
    return out;
  }
  return null;
}

function extractFromArgs(
  args: Record<string, unknown> | undefined,
  argsText: string | undefined,
  keys: string[],
): string | null {
  if (args) {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string") return value;
    }
  }
  if (argsText) return extractPartialField(argsText, keys);
  return null;
}

function compactToolText(value: string | null | undefined, limit = 88): string | null {
  if (!value) return null;
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function fileBasename(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  return clean.slice(slash + 1) || clean;
}

function humanizeToolName(name: string): string {
  return name
    .replace(/^functions[._-]/, "")
    .replace(/^mcp__[a-z0-9_-]+__/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function hasAnyNeedle(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function toolArg(
  block: ToolBlock,
  keys: string[],
  fallback?: string | null | undefined,
): string | null {
  return extractFromArgs(block.args, block.argsText, keys) ?? fallback ?? null;
}

function toolMeta(block: ToolBlock, filePath?: string | null) {
  const name = block.name.toLowerCase();
  const path = toolArg(block, [
    "path",
    "file_path",
    "filePath",
    "file",
    "filename",
    "target_file",
    "uri",
    "ref_id",
  ]);
  const query = toolArg(block, ["query", "q", "pattern", "search", "search_query", "needle"]);
  const command = toolArg(block, ["cmd", "command", "script", "shell", "input"]);
  const url = toolArg(block, ["url", "href"]);
  const resolvedPath = filePath ?? path;
  const basename = fileBasename(resolvedPath);

  if (FILE_WRITE_TOOL_NAMES.has(name) || hasAnyNeedle(name, ["edit", "write", "patch"])) {
    return {
      icon: <PencilLine className="h-4 w-4" />,
      label: basename ? `Edited ${basename}` : humanizeToolName(block.name),
      detail: resolvedPath && basename !== resolvedPath ? resolvedPath : null,
    };
  }
  if (hasAnyNeedle(name, ["search", "grep", "find", "ripgrep", "rg"])) {
    return {
      icon: <Search className="h-4 w-4" />,
      label: compactToolText(query, 80)
        ? `Searched for ${compactToolText(query, 80)}`
        : "Searched files",
      detail: path && !query ? path : null,
    };
  }
  if (hasAnyNeedle(name, ["read", "open", "cat", "view", "list"])) {
    return {
      icon: <FileText className="h-4 w-4" />,
      label: basename ? `Read ${basename}` : humanizeToolName(block.name),
      detail: resolvedPath && basename !== resolvedPath ? resolvedPath : null,
    };
  }
  if (hasAnyNeedle(name, ["exec", "command", "shell", "bash", "run", "terminal"])) {
    return {
      icon: <TerminalSquare className="h-4 w-4" />,
      label: "Ran command",
      detail: compactToolText(command, 110),
    };
  }
  if (hasAnyNeedle(name, ["browser", "web", "open_url", "navigate"])) {
    return {
      icon: <GlobeIcon className="h-4 w-4" />,
      label: "Used browser",
      detail: compactToolText(url, 110),
    };
  }
  return {
    icon: <Wrench className="h-4 w-4" />,
    label: humanizeToolName(block.name),
    detail: compactToolText(command ?? query ?? path ?? url, 110),
  };
}

function ToolStatus({ status }: { status: ToolBlock["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-(--dim)">
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-(--err)">
        <AlertTriangle className="h-3 w-3" />
        error
      </span>
    );
  }
  return null;
}

function ToolSummary({
  block,
  filePath,
  children,
  open = false,
}: {
  block: ToolBlock;
  filePath?: string | null;
  children?: ReactNode;
  open?: boolean;
}) {
  const meta = toolMeta(block, filePath);
  return (
    <details className="group py-0.5" open={open}>
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md py-1 text-(--dim) hover:text-(--fg) [&::-webkit-details-marker]:hidden">
        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center opacity-80">
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-6">{meta.label}</span>
          {meta.detail ? (
            <span className="block truncate font-mono text-[11px] leading-4 opacity-70">
              {meta.detail}
            </span>
          ) : null}
        </span>
        <ToolStatus status={block.status} />
        {children ? (
          <ChevronDownIcon className="mt-1 h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
        ) : null}
      </summary>
      {children ? <div className="ml-6 mt-1">{children}</div> : null}
    </details>
  );
}

function ToolOutput({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-(--dim) [overflow-wrap:anywhere]">
      {children}
    </pre>
  );
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  const isFileWrite = FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase());
  const filePath = isFileWrite
    ? extractFromArgs(block.args, block.argsText, ["path", "file_path", "filePath", "file"])
    : null;
  const fileContent = isFileWrite
    ? extractFromArgs(block.args, block.argsText, ["content", "text", "newText", "new_content"])
    : null;
  const patchContent = isFileWrite
    ? extractFromArgs(block.args, block.argsText, ["patch", "diff", "edits"])
    : null;
  const lang = detectLang(filePath);
  const isHtml = lang === "html";
  const [showPreview, setShowPreview] = useState(false);

  if (isFileWrite && (fileContent !== null || patchContent !== null)) {
    const body = fileContent ?? patchContent ?? "";
    return (
      <ToolSummary block={block} filePath={filePath} open={block.status === "running"}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.08em] text-(--dim)">
          <span>{lang || "source"}</span>
          {isHtml ? (
            <button
              type="button"
              onClick={() => setShowPreview((value) => !value)}
              className="rounded-md px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            >
              {showPreview ? "Source" : "Preview"}
            </button>
          ) : null}
        </div>
        {isHtml && showPreview ? (
          <iframe
            sandbox=""
            srcDoc={body}
            className="h-72 w-full rounded-md border border-(--border) bg-white"
            title={filePath ?? "preview"}
          />
        ) : (
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-(--border)/70 bg-(--surface)/35 p-2 font-mono text-[11px] leading-5 text-(--fg)">
            {body}
          </pre>
        )}
        {block.resultText ? (
          <div className="mt-1 font-mono text-[10px] text-(--dim)">
            <ToolOutput>{block.resultText}</ToolOutput>
          </div>
        ) : null}
      </ToolSummary>
    );
  }

  // Generic fallback (shells, reads, searches, browser tools, etc.).
  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolSummary block={block} open={block.status === "running"}>
      {display ? <ToolOutput>{display}</ToolOutput> : null}
    </ToolSummary>
  );
}
