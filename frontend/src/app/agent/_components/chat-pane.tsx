"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { AgentChatPaneHeader } from "@/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/ui/agent-composer-frame";
import { type FileMentionRow } from "@/ui/agent-composer-context";
import {
  useChatPaneContextAttachEffect,
  useChatPaneMentionEffects,
  useChatPaneStickToBottomEffect,
} from "@/hooks/agent/use-chat-pane-effects";
import type { ComposerMention } from "@/lib/agent/composer-context";
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
import type { BrowserBackend } from "@/lib/agent/tools/types";
import { Timeline } from "./timeline/timeline";
import { useChatPaneDerivedState } from "./use-chat-pane-derived-state";
import { useChatPaneRuntimeHandle } from "./use-chat-pane-runtime-handle";
import { useChatPaneSendFlow } from "./use-chat-pane-send-flow";
import { useChatPaneSessionTitle } from "./use-chat-pane-session-title";
import { useComposerAttachments } from "./use-composer-attachments";
import { useComposerLoadedContext } from "./use-composer-loaded-context";
import { useComposerMentionRows } from "./use-composer-mention-rows";
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
  browserBackend: BrowserBackend;
  onToggleBrowserBackend: () => void;
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
  browserBackend,
  onToggleBrowserBackend,
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
  const tools = useTools();
  const {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    visibleQueueItems,
  } = useChatPaneDerivedState({ activeTabId, contextWindow, tabs });
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
  const mentionRows = useComposerMentionRows({
    fileMentionRows,
    mention,
    pluginRows: tools.pluginCatalogue,
    promptTemplateRows: tools.promptTemplateCatalogue,
    skillRows: tools.skillCatalogue,
  });
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
  const { selectedPlugins, selectedSkills, selectedPromptTemplates, removeLoadedContext } =
    useComposerLoadedContext({ activeTab, tools });

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
    browserBackend,
    canvasEnabled: tools.computer.canvasEnabled,
    onPiSessionIdChange: handlePiSessionIdChange,
    updateSession,
    selectionFor: tools.selectionFor,
  });
  const { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn } =
    useChatPaneSendFlow({
      activeTab,
      attachments,
      browserToolEnabled,
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
  const openComputerStatus = useCallback(() => {
    tools.setComputerTab("status");
    tools.setComputerOpen(true);
  }, [tools]);
  useChatPaneRuntimeHandle({
    activeTab,
    activeTabId,
    engine,
    modelId,
    onRegisterHandle,
    running: Boolean(running),
  });
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
      <AgentComposerFrame
        attachments={attachments}
        browserToolEnabled={browserToolEnabled}
        browserBackend={browserBackend}
        canvasEnabled={canvasEnabled}
        composerDragActive={composerDragActive}
        contextWindow={effectiveContextWindow}
        currentContextTokens={currentContextTokens}
        cwd={cwd}
        fileInputRef={fileInputRef}
        gitBranch={gitBranch}
        gitSummary={gitSummary}
        input={activeTab?.input ?? ""}
        mention={mention}
        mentionIndex={mentionIndex}
        mentionRows={mentionRows}
        modelSelector={modelSelector}
        onAbortTurn={() => void abortTurn()}
        onAttachFiles={(files) => void attachFiles(files)}
        onComposerChange={handleComposerChange}
        onComposerDragLeave={handleComposerDragLeave}
        onComposerDragOver={handleComposerDragOver}
        onComposerDrop={handleComposerDrop}
        onComposerKeyDown={handleComposerKeyDown}
        onComposerPaste={handleComposerPaste}
        onEditQueued={editQueued}
        onInitGit={onInitGit}
        onOpenStatus={openComputerStatus}
        onQueueExpandedChange={setQueueExpanded}
        onQueueMessage={() => void queueMessage()}
        onRemoveAttachment={removeAttachment}
        onRemoveLoadedContext={removeLoadedContext}
        onRemoveQueued={removeQueued}
        onSelectMention={(entry) => void selectMentionRow(entry)}
        onSteerQueued={(queueId) => void steerQueued(queueId)}
        onSubmit={sendMessage}
        onToggleBrowserBackend={onToggleBrowserBackend}
        onToggleBrowserTool={onToggleBrowserTool}
        onToggleCanvas={onToggleCanvas}
        promptTemplates={selectedPromptTemplates}
        queueExpanded={queueExpanded}
        queueItems={visibleQueueItems}
        readingAttachments={readingAttachments}
        running={Boolean(running)}
        selectedPlugins={selectedPlugins}
        selectedSkills={selectedSkills}
        status={activeTab?.status}
        textareaRef={textareaRef}
      />
    </section>
  );
}
