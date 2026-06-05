"use client";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
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
import { byQuery, type ComposerMention } from "@/lib/agent/composer-context";
import {
  AgentTurnSsePayload,
  AssistantBlock,
  asRecord,
  ChatMessage,
  ChatPaneHandle,
  EventBlock,
  QueuedMessage,
  SessionTab,
  TextBlock,
  ThinkingBlock,
  TokenStats,
  ToolBlock,
  visibleQueuedMessages,
} from "@/lib/agent/session";
import { useSessionEngine } from "@/lib/agent/sessions/engine";
import { useTools } from "@/lib/agent/tools/context";
import { Timeline } from "./timeline/timeline";
import { useChatPaneSendFlow } from "./use-chat-pane-send-flow";
import { useChatPaneSessionTitle } from "./use-chat-pane-session-title";
import { useComposerAttachments } from "./use-composer-attachments";
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
  const lastAppliedComposerHeightRef = useRef(0);
  const lastComposerValueLengthRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);
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
  const updateTab = useCallback(
    (tabId: string, patch: (tab: SessionTab) => SessionTab) => {
      onTabsChange((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? patch(tab) : tab)),
      );
    },
    [onTabsChange],
  );
  const {
    attachments,
    setAttachments,
    readingAttachments,
    composerDragActive,
    attachFiles,
    removeAttachment,
    clearAttachments,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
  } = useComposerAttachments({
    activeTab,
    running: Boolean(running),
    updateTab,
    fileInputRef,
  });
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
  const { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn } =
    useChatPaneSendFlow({
      activeTab,
      attachments,
      clearAttachments,
      cwd,
      engine,
      modelId,
      readingAttachments,
      resetComposerHeight,
      running: Boolean(running),
      runtimeSessionId,
      setMention,
      setStickToBottom,
      tools,
      updateTab,
    });
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
          <AgentAttachmentTray attachments={attachments} onRemove={removeAttachment} />
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
