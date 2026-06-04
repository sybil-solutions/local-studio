"use client";
import {
  FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { AgentAttachmentTray } from "@/ui/agent-attachment-tray";
import { AgentChatPaneHeader } from "@/ui/agent-chat-pane-header";
import { AgentComposerActions } from "@/ui/agent-composer-actions";
import { AgentComposerStatusBar } from "@/ui/agent-composer-status-bar";
import { AgentComposerTextArea } from "@/ui/agent-composer-textarea";
import {
  AgentLoadedContextTabs,
  AgentMentionPicker,
  type FileMentionRow,
  type MentionRow,
} from "@/ui/agent-composer-context";
import { AgentQueuePanel } from "@/ui/agent-queue-panel";
import {
  useChatPaneContextAttachEffect,
  useChatPaneMentionEffects,
  useChatPaneRegisterHandleEffect,
  useChatPaneStickToBottomEffect,
} from "@/hooks/agent/use-chat-pane-effects";
import {
  activeComposerPlugins,
  byQuery,
  selectedContextPrompt,
  type ComposerMention,
  type ComposerPluginRef,
} from "@/lib/agent/composer-context";
import {
  AgentTurnSsePayload,
  AssistantBlock,
  asRecord,
  ChatMessage,
  ChatPaneHandle,
  EventBlock,
  isPlaceholderSessionTitle,
  newId,
  QueuedMessage,
  SessionTab,
  TextBlock,
  ThinkingBlock,
  TokenStats,
  ToolBlock,
  visibleQueuedMessages,
} from "@/lib/agent/session";
import { useSessionEngine } from "@/lib/agent/sessions/engine";
import {
  beginSessionSubmit,
  endSessionSubmit,
  type SessionSubmitGuard,
} from "@/lib/agent/sessions/submit-guard";
import { promptRequestsBrowser } from "@/lib/agent/browser/intent";
import { useTools } from "@/lib/agent/tools/context";
import {
  attachmentDedupKey,
  attachmentPrompt,
  createAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  imageInputFromAttachment,
  type ChatAttachment,
} from "./chat-attachments";
import { Timeline } from "./timeline/timeline";
import { useChatPaneSessionTitle } from "./use-chat-pane-session-title";
import { useComposerMentionSelection } from "./use-composer-mention-selection";
import { useComposerTextareaBehavior } from "./use-composer-textarea-behavior";
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
export { visibleQueuedMessages };
type Props = {
  paneId: string;
  runtimeSessionId: string;
  modelId: string;
  modelName: string | null;
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  projectName: string | null;
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
  canvasEnabled: boolean;
  onToggleCanvas: () => void;
  isFocused: boolean;
  onFocus: () => void;
  onPiSessionIdChange?: (sessionId: string) => void;
  tabs: SessionTab[];
  activeTabId: string;
  onTabsChange: (tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[])) => void;
  onRenameSession: (tabId: string, title: string) => void;
  onClose?: () => void;
  onForkSession?: () => void;
  rightPanelOpen: boolean;
  onToggleRightPanel: () => void;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  showHeader?: boolean;
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
  modelSelector,
  gitBranch,
  gitSummary,
  onInitGit,
  browserToolEnabled,
  onToggleBrowserTool,
  canvasEnabled,
  onToggleCanvas,
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onTabsChange,
  onRenameSession,
  onClose,
  onForkSession,
  rightPanelOpen,
  onToggleRightPanel,
  onRegisterHandle,
  showHeader = true,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const lastAppliedComposerHeightRef = useRef(0);
  const lastComposerValueLengthRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileMentionRows, setFileMentionRows] = useState<FileMentionRow[]>([]);
  const [compacting, setCompacting] = useState(false);
  const tools = useTools();
  const pluginRows = tools.pluginCatalogue;
  const skillRows = tools.skillCatalogue;
  const promptTemplateRows = tools.promptTemplateCatalogue;
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
  const activeSelection = tools.selectionFor(activeTab?.id);
  const selectedPlugins = activeSelection.plugins;
  const selectedSkills = activeSelection.skills;
  const selectedPromptTemplates = activeSelection.promptTemplates;
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  useChatPaneStickToBottomEffect({
    activeTabId: activeTab?.id,
    setStickToBottom,
  });
  useChatPaneContextAttachEffect({
    contextAttachRequest: tools.contextAttachRequest,
    isFocused,
    setAttachments,
  });
  const mentionRows = useMemo<MentionRow[]>(() => {
    if (!mention) return [];
    if (mention.kind === "skill") {
      return byQuery(skillRows, mention.query, 8).map((row) => ({ kind: "skill", row }));
    }
    if (mention.kind === "promptTemplate") {
      const templates = byQuery(promptTemplateRows, mention.query, 8).map((row) => ({
        kind: "promptTemplate" as const,
        row,
      }));
      return templates;
    }
    const plugins = byQuery(pluginRows, mention.query, 5).map((row) => ({
      kind: "plugin" as const,
      row,
    }));
    const q = mention.query.trim().toLowerCase();
    const files = fileMentionRows
      .filter(
        (row) => !q || row.rel.toLowerCase().includes(q) || row.name.toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((row) => ({ kind: "file" as const, row }));
    return [...plugins, ...files].slice(0, 8);
  }, [fileMentionRows, mention, pluginRows, promptTemplateRows, skillRows]);
  useChatPaneMentionEffects({
    cwd,
    mention,
    setFileMentionRows,
    setMentionIndex,
  });
  const updateTab = useCallback(
    (tabId: string, patch: (tab: SessionTab) => SessionTab) => {
      onTabsChange((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? patch(tab) : tab)),
      );
    },
    [onTabsChange],
  );
  const {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  } = useChatPaneSessionTitle({
    activeTab,
    activeTabId,
    paneId,
    running: Boolean(running),
    onPiSessionIdChange,
    onRenameSession,
  });
  const selectMentionRow = useComposerMentionSelection({
    activeTab,
    mention,
    cwd,
    tools,
    updateTab,
    setAttachments,
    setMention,
    textareaRef,
  });
  const resetComposerHeight = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    lastAppliedComposerHeightRef.current = 0;
    lastComposerValueLengthRef.current = 0;
  }, []);
  const removeLoadedContext = useCallback(
    (kind: "plugin" | "skill" | "promptTemplate", id: string) => {
      if (!activeTab) return;
      const current = tools.selectionFor(activeTab.id);
      tools.setSelection(activeTab.id, {
        plugins:
          kind === "plugin"
            ? current.plugins.filter((plugin) => plugin.id !== id)
            : current.plugins,
        skills:
          kind === "skill" ? current.skills.filter((skill) => skill.id !== id) : current.skills,
        promptTemplates:
          kind === "promptTemplate"
            ? current.promptTemplates.filter((template) => template.id !== id)
            : current.promptTemplates,
      });
    },
    [activeTab, tools],
  );

  const updateSession = useCallback(
    (sessionId: string, patch: (session: SessionTab) => SessionTab) => updateTab(sessionId, patch),
    [updateTab],
  );
  const engine = useSessionEngine({
    tabs,
    activeTabId,
    runtimeSessionId,
    modelId,
    cwd,
    browserToolEnabled,
    canvasEnabled: tools.computer.canvasEnabled,
    onPiSessionIdChange: handlePiSessionIdChange,
    updateSession,
    selectionFor: tools.selectionFor,
  });
  const ensureBrowserToolForText = useCallback(
    (text: string) => {
      if (!promptRequestsBrowser(text)) return;
      tools.setComputerTab("browser");
      tools.setBrowserEnabled(true);
    },
    [tools],
  );
  const buildPromptArgs = useCallback(
    (sessionId: string, rawText: string) => {
      const text = rawText.trim();
      const attachedText = attachmentPrompt(attachments);
      const attachmentSummary =
        attachments.length > 0
          ? `Attached: ${attachments.map((file) => file.name).join(", ")}`
          : "";
      const userText = text || attachmentSummary;
      const displayText = [text, attachmentSummary].filter(Boolean).join("\n\n");
      const selection = tools.selectionFor(sessionId);
      const contextText = selectedContextPrompt(
        text,
        activeComposerPlugins(selection.plugins),
        selection.skills,
      );
      const prompt = [contextText, attachedText].filter(Boolean).join("\n\n");
      const images = attachments.flatMap((file) => {
        const image = imageInputFromAttachment(file);
        return image ? [image] : [];
      });
      const messageAttachments = attachments.map((file) => {
        // Prefer the durable inline data URL over the ephemeral blob: URL when
        // available — blob URLs are tied to the composer document and become
        // stale once a session is persisted and replayed, which is why image
        // attachments rendered fine in the composer but not in chat history.
        const durablePreviewUrl =
          file.mode === "data-url" && file.content.startsWith("data:")
            ? file.content
            : file.previewUrl;
        return {
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
          path: file.path,
          mode: file.mode,
          content: file.content,
          previewKind: file.previewKind,
          previewUrl: durablePreviewUrl,
        };
      });
      return {
        text,
        prompt,
        displayText,
        userText,
        images,
        attachments: messageAttachments,
        plugins: activeComposerPlugins(selection.plugins) as ComposerPluginRef[],
        skills: selection.skills,
        promptTemplates: selection.promptTemplates,
      };
    },
    [attachments, tools],
  );
  const submitPrompt = useCallback(
    async (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return;
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) return;
      const args = buildPromptArgs(targetId, rawText);
      ensureBrowserToolForText(args.userText);
      // `args` already snapshotted the tagged plugins/skills (buildPromptArgs),
      // so they still ride this outgoing turn. Clear their composer pills on send
      // so a tagged `@plugin` (and `$skill`) goes out with the message instead of
      // lingering above the textarea for the next turn.
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0 || currentSelection.plugins.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [], plugins: [] });
      }
      setStickToBottom(true);
      setAttachments([]);
      resetComposerHeight();
      if (fileInputRef.current) fileInputRef.current.value = "";
      await engine.submitPrompt({ ...args, targetSessionId: targetId });
    },
    [
      activeTab,
      attachments.length,
      buildPromptArgs,
      engine,
      ensureBrowserToolForText,
      modelId,
      readingAttachments,
      resetComposerHeight,
      tools,
    ],
  );
  const queueAndSendControl = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      tab: SessionTab,
      runtime: string,
      cwdHint?: string,
    ) => {
      ensureBrowserToolForText(text);
      const queuedId = newId("queue");
      updateTab(tab.id, (t) => ({
        ...t,
        ...(cwdHint ? { cwd: t.cwd || cwdHint } : {}),
        input: "",
        error: "",
        queue:
          mode === "follow_up"
            ? [...(t.queue ?? []), { id: queuedId, mode, text, sent: true }]
            : t.queue,
      }));
      resetComposerHeight();
      const result = await engine.sendControl(mode, text, runtime, tab.id, tab.piSessionId);
      updateTab(tab.id, (t) => ({
        ...t,
        queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
        ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
      }));
    },
    [engine, ensureBrowserToolForText, resetComposerHeight, updateTab],
  );
  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      if (running) {
        if (!text || isPlaceholderSessionTitle(text) || readingAttachments) return;
        if (!modelId) {
          updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
          return;
        }
        if (!beginSessionSubmit(controlSubmitInFlightRef.current, activeTab.id)) return;
        setMention(null);
        try {
          await queueAndSendControl("steer", text, activeTab, runtime);
        } finally {
          endSessionSubmit(controlSubmitInFlightRef.current, activeTab.id);
        }
        return;
      }
      if (
        ((!text || isPlaceholderSessionTitle(text)) && attachments.length === 0) ||
        readingAttachments
      ) {
        return;
      }
      if (!modelId) {
        updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
        return;
      }
      if (!beginSessionSubmit(composerSubmitInFlightRef.current, activeTab.id)) return;
      setMention(null);
      try {
        await submitPrompt(text, activeTab.id);
      } finally {
        endSessionSubmit(composerSubmitInFlightRef.current, activeTab.id);
      }
    },
    [
      activeTab,
      attachments.length,
      modelId,
      queueAndSendControl,
      readingAttachments,
      running,
      runtimeSessionId,
      submitPrompt,
      updateTab,
    ],
  );
  const queueMessage = useCallback(async () => {
    if (!activeTab) return;
    const text = activeTab.input.trim();
    if (!text || isPlaceholderSessionTitle(text)) return;
    if (!modelId) {
      updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
      return;
    }
    // Queue follows the same contract as Steer: trust the user's
    // explicit intent and let the server route follow_up vs. fresh
    // prompt based on the live runtime state. The prompt stream can still be
    // in flight here, so follow-up controls must not share its in-flight guard.
    if (running) {
      if (!beginSessionSubmit(controlSubmitInFlightRef.current, activeTab.id)) return;
      setMention(null);
      try {
        const runtime = activeTab.runtimeSessionId || runtimeSessionId;
        await queueAndSendControl("follow_up", text, activeTab, runtime, cwd);
      } finally {
        endSessionSubmit(controlSubmitInFlightRef.current, activeTab.id);
      }
      return;
    }
    if (!beginSessionSubmit(composerSubmitInFlightRef.current, activeTab.id)) return;
    setMention(null);
    try {
      await submitPrompt(text, activeTab.id);
    } finally {
      endSessionSubmit(composerSubmitInFlightRef.current, activeTab.id);
    }
  }, [
    activeTab,
    cwd,
    modelId,
    queueAndSendControl,
    running,
    runtimeSessionId,
    submitPrompt,
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
  const editQueued = useCallback(
    (queueId: string, text: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        queue: (tab.queue ?? []).map((entry) =>
          entry.id === queueId ? { ...entry, text } : entry,
        ),
      }));
    },
    [activeTab, updateTab],
  );
  const steerQueued = useCallback(
    async (queueId: string) => {
      if (!activeTab) return;
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return;
      // Promote a queued follow-up to an immediate steer: drop it from the queue
      // and inject it into the running turn. Re-add on failure so the message is
      // never silently lost.
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      removeQueued(queueId);
      const result = await engine.sendControl(
        "steer",
        item.text,
        runtime,
        activeTab.id,
        activeTab.piSessionId,
      );
      if (!result.ok) {
        updateTab(activeTab.id, (t) => ({
          ...t,
          queue: [...(t.queue ?? []), item],
          error: result.error || "Steer failed",
        }));
      }
    },
    [activeTab, engine, removeQueued, runtimeSessionId, updateTab],
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
    await engine.abortTurn(activeTab.id);
  }, [activeTab, engine]);
  const { handleComposerPaste, handleComposerChange, handleComposerKeyDown } =
    useComposerTextareaBehavior({
      activeTab,
      mention,
      mentionRows,
      mentionIndex,
      running: Boolean(running),
      textareaRef,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      updateTab,
      setMention,
      setMentionIndex,
      selectMentionRow,
      queueMessage,
      abortTurn,
      attachFiles,
    });
  const loadAndReplay = useCallback(
    async (piSessionId: string) => {
      if (!activeTabId) return;
      await engine.loadAndReplay(piSessionId, activeTabId);
    },
    [activeTabId, engine],
  );
  const queue = activeTab?.queue ?? [];
  const visibleQueueItems = visibleQueuedMessages(queue);
  const openComputerStatus = useCallback(() => {
    tools.setComputerTab("status");
    tools.setComputerOpen(true);
  }, [tools]);
  // Prefer SDK-computed context usage (uses the model's real tokenizer + the
  // same compaction settings the SDK enforces). Fall back to the locally
  // estimated tokenStats while we're waiting for the first runtime status
  // poll to land.
  const sdkContextUsage = activeTab?.contextUsage ?? null;
  const currentContextTokens = sdkContextUsage?.tokens ?? activeTab?.tokenStats?.current ?? 0;
  const effectiveContextWindow =
    sdkContextUsage?.contextWindow && sdkContextUsage.contextWindow > 0
      ? sdkContextUsage.contextWindow
      : contextWindow;
  const compactSession = useCallback(async () => {
    if (!activeTab || running || compacting || !modelId) return;
    setCompacting(true);
    try {
      await engine.compact(activeTab.id);
    } finally {
      setCompacting(false);
    }
  }, [activeTab, compacting, engine, modelId, running]);
  const handleRef = useRef<ChatPaneHandle>({ loadAndReplay, compact: compactSession });
  handleRef.current = { loadAndReplay, compact: compactSession };
  useChatPaneRegisterHandleEffect({ handleRef, onRegisterHandle });
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--agent-bg)"
    >
      {showHeader ? (
        <AgentChatPaneHeader
          title={displayedSessionTitle}
          pinned={sessionPinned}
          rightPanelOpen={rightPanelOpen}
          canFork={Boolean(onForkSession)}
          canClose={Boolean(onClose)}
          onTogglePinned={togglePinnedSession}
          onRename={renameActiveSession}
          onFork={onForkSession}
          onClose={onClose}
          onToggleRightPanel={onToggleRightPanel}
        />
      ) : null}
      {activeTab?.error ? (
        <div className="border-b border-(--border) bg-(--err)/10 px-4 py-2 text-xs text-(--err)">
          {activeTab.error}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <Timeline
          key={activeTab?.id ?? "empty"}
          stickToBottom={stickToBottom}
          onStickToBottomChange={setStickToBottom}
          messages={activeTab?.messages ?? []}
          running={Boolean(running)}
          emptyPrompt={Boolean(showEmptyPrompt)}
        />
      </div>
      <form onSubmit={sendMessage} className="shrink-0 bg-(--agent-bg) px-6 pb-1.5 pt-2">
        <AgentQueuePanel
          items={visibleQueueItems}
          expanded={queueExpanded}
          running={Boolean(running)}
          onExpandedChange={setQueueExpanded}
          onEdit={editQueued}
          onRemove={removeQueued}
          onSteer={(queueId) => void steerQueued(queueId)}
        />
        <div
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
          className={`mx-auto w-full max-w-[var(--composer-w)] overflow-visible rounded-2xl border border-(--border)/20 bg-(--sidebar-bg) transition-colors ${composerDragActive ? "outline outline-1 outline-(--accent)/50" : ""}`}
        >
          {" "}
          {composerDragActive ? (
            <div className="px-4 pt-2 text-[length:var(--fs-sm)] text-(--accent)">
              Drop files to attach to the next message.
            </div>
          ) : null}
          <AgentLoadedContextTabs
            plugins={selectedPlugins}
            skills={selectedSkills}
            promptTemplates={selectedPromptTemplates}
            onRemove={removeLoadedContext}
          />
          <AgentMentionPicker
            mention={mention}
            rows={mentionRows}
            activeIndex={mentionIndex}
            onSelect={(entry) => void selectMentionRow(entry)}
          />
          <AgentAttachmentTray
            attachments={attachments}
            onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          />
          <AgentComposerTextArea
            inputRef={textareaRef}
            value={activeTab?.input ?? ""}
            onPaste={handleComposerPaste}
            onChange={handleComposerChange}
            onKeyDown={handleComposerKeyDown}
          />
          <AgentComposerActions
            fileInputRef={fileInputRef}
            onAttachFiles={(files) => void attachFiles(files)}
            readingAttachments={readingAttachments}
            running={Boolean(running)}
            status={activeTab?.status}
            input={activeTab?.input ?? ""}
            attachmentsCount={attachments.length}
            browserToolEnabled={browserToolEnabled}
            onToggleBrowserTool={onToggleBrowserTool}
            canvasEnabled={canvasEnabled}
            onToggleCanvas={onToggleCanvas}
            onQueueMessage={() => void queueMessage()}
            onAbortTurn={() => void abortTurn()}
          />
        </div>
        <AgentComposerStatusBar
          cwd={cwd}
          gitBranch={gitBranch}
          gitSummary={gitSummary}
          onInitGit={onInitGit}
          modelSelector={modelSelector}
          currentContextTokens={currentContextTokens}
          contextWindow={effectiveContextWindow}
          onOpenStatus={openComputerStatus}
        />
      </form>
    </section>
  );
}
