"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import { type FileMentionRow } from "@/features/agent/ui/agent-composer-context";
import {
  useComposerAttachments,
  useComposerLoadedContext,
  useComposerMentionRows,
  useComposerMentionSelection,
  useComposerTextareaBehavior,
  useComposerTextareaHeightSync,
  type UpdateTab,
} from "@/features/agent/ui/chat-pane-composer";
import { type ComposerMention } from "@/features/agent/composer-context";
import { useChatPaneDerivedState } from "@/features/agent/ui/chat-pane-derived-state";
import {
  useChatPaneContextAttachEffect,
  useChatPaneMentionEffects,
  useChatPaneStickToBottomEffect,
} from "@/features/agent/ui/chat-pane-ui-effects";
import { useChatPaneRuntimeHandle } from "@/features/agent/ui/chat-pane-runtime-handle";
import { useChatPaneSessionTitle } from "@/features/agent/ui/chat-pane-session-title";
import { useChatPaneSendFlow } from "@/features/agent/ui/chat-pane-send-flow";
import { useProjectsNavSessionPrefs } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import {
  AssistantBlock,
  asRecord,
  ChatMessage,
  ChatPaneHandle,
  cleanSessionTitle,
  EventBlock,
  isPlaceholderSessionTitle,
  newId,
  nowLabel,
  QueuedMessage,
  runtimeStatusLooksActive,
  SessionTab,
  TextBlock,
  ThinkingBlock,
  TokenStats,
  ToolBlock,
  visibleQueuedMessages,
} from "@/features/agent/messages";
import { copySessionPref, patchSessionPref } from "@/features/agent/messages/prefs";
import { useSessionEngine, type SessionEngine } from "@/features/agent/runtime/engine";
import {
  beginSessionSubmit,
  endSessionSubmit,
  type SessionSubmitGuard,
} from "@/features/agent/runtime/selectors";
import { useTools, type ToolsContextValue } from "@/features/agent/tools/context";
import type { GitSummary } from "@/features/agent/projects/types";
import type { BrowserBackend, ContextAttachRequest } from "@/features/agent/tools/types";
import {
  attachmentDedupKey,
  attachmentPrompt,
  imageInputFromAttachment,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";
import { Timeline } from "@/features/agent/ui/timeline/timeline";
import { CloseIcon, ReloadIcon } from "@/ui/icons";
import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
export type {
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

const FINALIZATION_RETRY_ERROR_RE =
  /Model did not produce a valid final response\.?\s+Retrying finalization/i;
const BENIGN_TRANSPORT_ERROR_RE = /^(?:terminated|abort(?:ed)?|network error|load failed)$/i;

function downloadTextFile(filename: string, content: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function visibleSessionError(error?: string): string {
  const value = error?.trim() ?? "";
  return FINALIZATION_RETRY_ERROR_RE.test(value) || BENIGN_TRANSPORT_ERROR_RE.test(value)
    ? ""
    : value;
}

/** A failed turn can be retried when a model is set, nothing is running, and
 * there's a prior user message (or restored draft) to resend. */
function canRetrySession(tab: SessionTab | null, hasModel: boolean, running: boolean): boolean {
  if (!tab || !hasModel || running) return false;
  return tab.messages.some((message) => message.role === "user") || Boolean(tab.input.trim());
}

type Props = {
  paneId: string;
  runtimeSessionId: string;
  modelId: string;
  modelName: string | null;
  modelSupportsVision: boolean;
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  projectName: string | null;
  modelSelector?: ReactNode;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
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
  modelSupportsVision,
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
  useComposerTextareaHeightSync({
    value: activeTab?.input ?? "",
    textareaRef,
    lastAppliedComposerHeightRef,
    lastComposerValueLengthRef,
  });
  const { selectedSkills, selectedPromptTemplates, removeLoadedContext } = useComposerLoadedContext(
    { activeTab, tools },
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
    updateSession: updateTab,
    selectionFor: tools.selectionFor,
  });
  const { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn, retryLast } =
    useChatPaneSendFlow({
      activeTab,
      attachments,
      browserToolEnabled,
      clearAttachments,
      cwd,
      engine,
      modelId,
      modelSupportsVision,
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
  const visibleError = visibleSessionError(activeTab?.error);
  const canRetry = canRetrySession(activeTab, Boolean(modelId), Boolean(running));
  const dismissVisibleError = useCallback(() => {
    if (!activeTab) return;
    updateTab(activeTab.id, (tab) => ({ ...tab, error: "" }));
  }, [activeTab, updateTab]);
  const exportSession = useCallback(() => {
    if (!activeTab) return;
    const markdown = sessionToMarkdown(activeTab.messages, displayedSessionTitle);
    downloadTextFile(exportFilenameFromTitle(displayedSessionTitle), markdown);
  }, [activeTab, displayedSessionTitle]);
  const canExport = Boolean(
    activeTab?.messages.some((message) => message.role !== "system" && message.text.trim()),
  );
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--agent-bg) shadow-[inset_1px_0_rgba(255,255,255,0.015)]"
    >
      {showHeader ? (
        <AgentChatPaneHeader
          title={displayedSessionTitle}
          pinned={sessionPinned}
          rightPanelOpen={rightPanelOpen}
          canFork={Boolean(onForkSession)}
          canClose={Boolean(onClose)}
          canExport={canExport}
          onTogglePinned={togglePinnedSession}
          onRename={renameActiveSession}
          onFork={onForkSession}
          onExport={exportSession}
          onClose={onClose}
          onToggleRightPanel={onToggleRightPanel}
        />
      ) : null}
      {visibleError ? (
        <div
          className="flex shrink-0 items-start gap-3 border-b border-(--border) bg-(--err)/10 px-4 py-2 text-xs text-(--err)"
          role="alert"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{visibleError}</span>
          {canRetry ? (
            <button
              type="button"
              onClick={() => void retryLast()}
              className="-my-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-(--err)/30 px-1.5 py-0.5 text-(--err)/90 hover:bg-(--err)/10 hover:text-(--err)"
              aria-label="Retry"
              title="Resend the last message"
            >
              <ReloadIcon className="h-3 w-3 pointer-events-none" />
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismissVisibleError}
            className="-my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--err)/75 hover:bg-(--err)/10 hover:text-(--err)"
            aria-label="Dismiss error"
            title="Dismiss error"
          >
            <CloseIcon className="h-3 w-3 pointer-events-none" />
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <Timeline
          key={activeTab?.id ?? "empty"}
          stickToBottom={stickToBottom}
          onStickToBottomChange={setStickToBottom}
          messages={activeTab?.messages ?? []}
          running={Boolean(running)}
          onForkSession={onForkSession}
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
        selectedSkills={selectedSkills}
        status={activeTab?.status}
        textareaRef={textareaRef}
      />
    </section>
  );
}
