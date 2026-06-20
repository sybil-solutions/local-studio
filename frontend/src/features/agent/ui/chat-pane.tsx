"use client";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import {
  type FileMentionRow,
  type LoadedContextKind,
  type MentionRow,
} from "@/features/agent/ui/agent-composer-context";
import { browserContextPrompt } from "@/features/agent/browser/context";
import {
  activateComposerPlugin,
  activeComposerPlugins,
  byQuery,
  consumeComposerMention,
  detectComposerMention,
  selectedContextPrompt,
  type ComposerMention,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
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
  createAttachment,
  createProjectFileAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  imageFileFromDataUrlText,
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
  useComposerTextareaHeightSync({
    value: activeTab?.input ?? "",
    textareaRef,
    lastAppliedComposerHeightRef,
    lastComposerValueLengthRef,
  });
  const { selectedPlugins, selectedSkills, selectedPromptTemplates, removeLoadedContext } =
    useComposerLoadedContext({ activeTab, tools });

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
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--agent-bg)"
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
        selectedPlugins={selectedPlugins}
        selectedSkills={selectedSkills}
        status={activeTab?.status}
        textareaRef={textareaRef}
      />
    </section>
  );
}

function useChatPaneDerivedState({
  activeTabId,
  contextWindow,
  tabs,
}: {
  activeTabId: string;
  contextWindow: number;
  tabs: SessionTab[];
}) {
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  const queue = activeTab?.queue ?? [];
  const sdkContextUsage = activeTab?.contextUsage ?? null;
  const currentContextTokens = sdkContextUsage?.tokens ?? activeTab?.tokenStats?.current ?? 0;
  const effectiveContextWindow =
    sdkContextUsage?.contextWindow && sdkContextUsage.contextWindow > 0
      ? sdkContextUsage.contextWindow
      : contextWindow;

  return {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    visibleQueueItems: visibleQueuedMessages(queue),
  };
}

const getChatPaneSnapshot = (): number => 0;

type ChatPaneFileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};

function useChatPaneStickToBottomEffect({
  activeTabId,
  setStickToBottom,
}: {
  activeTabId: string | null | undefined;
  setStickToBottom: Dispatch<SetStateAction<boolean>>;
}): void {
  const subscribeStickToBottom = useCallback(() => {
    setStickToBottom(true);
    return () => undefined;
  }, [activeTabId, setStickToBottom]);

  useSyncExternalStore(subscribeStickToBottom, getChatPaneSnapshot, getChatPaneSnapshot);
}

function useChatPaneMentionEffects({
  cwd,
  mention,
  setFileMentionRows,
  setMentionIndex,
}: {
  cwd: string;
  mention: ComposerMention | null;
  setFileMentionRows: Dispatch<SetStateAction<ChatPaneFileMentionRow[]>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
}): void {
  const subscribeMentionIndex = useCallback(() => {
    setMentionIndex(0);
    return () => undefined;
  }, [mention?.kind, mention?.query, setMentionIndex]);

  const subscribeMentionRows = useCallback(() => {
    if (!mention || mention.kind !== "plugin" || !cwd) {
      setFileMentionRows([]);
      return () => undefined;
    }
    let cancelled = false;
    void fetch(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
          } | null,
        ) => {
          if (cancelled) return;
          const rows = (payload?.entries ?? [])
            .filter((entry) => entry.kind === "file")
            .map((entry) => ({
              id: `file:${entry.rel}`,
              name: entry.name,
              rel: entry.rel,
              path: entry.path,
              source: "project",
            }));
          setFileMentionRows(rows);
        },
      )
      .catch(() => {
        if (!cancelled) setFileMentionRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, mention, setFileMentionRows]);

  useSyncExternalStore(subscribeMentionIndex, getChatPaneSnapshot, getChatPaneSnapshot);
  useSyncExternalStore(subscribeMentionRows, getChatPaneSnapshot, getChatPaneSnapshot);
}

function useChatPaneContextAttachEffect({
  contextAttachRequest,
  isFocused,
  setAttachments,
}: {
  contextAttachRequest: ContextAttachRequest | null;
  isFocused: boolean;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
}): void {
  const handledContextAttachRef = useRef(0);
  const subscribeContextAttach = useCallback(() => {
    if (
      contextAttachRequest &&
      isFocused &&
      handledContextAttachRef.current !== contextAttachRequest.id
    ) {
      handledContextAttachRef.current = contextAttachRequest.id;
      const attachment: ChatAttachment = {
        id: newId("ctx"),
        name: contextAttachRequest.label,
        type: "text/plain",
        size: contextAttachRequest.content.length,
        ...(contextAttachRequest.path ? { path: contextAttachRequest.path } : {}),
        mode: "text",
        content: contextAttachRequest.content,
        previewKind: "file",
      };
      setAttachments((current) => {
        const nextKey = attachmentDedupKey(attachment);
        if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
        return [...current, attachment];
      });
    }
    return () => undefined;
  }, [contextAttachRequest, isFocused, setAttachments]);

  useSyncExternalStore(subscribeContextAttach, getChatPaneSnapshot, getChatPaneSnapshot);
}

function useChatPaneRegisterHandleEffect({
  handleRef,
  onRegisterHandle,
}: {
  handleRef: RefObject<ChatPaneHandle>;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
}): void {
  const subscribeHandle = useCallback(() => {
    if (!onRegisterHandle) return () => undefined;
    const handle: ChatPaneHandle = {
      loadAndReplay: (id) => handleRef.current.loadAndReplay(id),
      compact: () => handleRef.current.compact(),
    };
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [handleRef, onRegisterHandle]);

  useSyncExternalStore(subscribeHandle, getChatPaneSnapshot, getChatPaneSnapshot);
}

function useChatPaneRuntimeHandle({
  activeTab,
  activeTabId,
  engine,
  modelId,
  onRegisterHandle,
  running,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  engine: SessionEngine;
  modelId: string;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  running: boolean;
}) {
  const [compacting, setCompacting] = useState(false);
  const loadAndReplay = useCallback(
    async (piSessionId: string) => {
      if (!activeTabId) return;
      await engine.loadAndReplay(piSessionId, activeTabId);
    },
    [activeTabId, engine],
  );
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
}

function useChatPaneSessionTitle({
  activeTab,
  activeTabId,
  paneId,
  running,
  onPiSessionIdChange,
  onRenameSession,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  paneId: string;
  running: boolean;
  onPiSessionIdChange?: (sessionId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
}) {
  const sessionPrefs = useProjectsNavSessionPrefs();
  const sessionPrefKeys = useMemo(
    () =>
      [
        activeTab?.piSessionId,
        paneId && activeTab?.id ? `tab:${paneId}:${activeTab.id}` : null,
      ].filter((value): value is string => Boolean(value)),
    [activeTab?.id, activeTab?.piSessionId, paneId],
  );
  const sessionPrefTitle = sessionPrefKeys.reduce((title, key) => {
    const nextTitle = cleanSessionTitle(sessionPrefs[key]?.title);
    return nextTitle || title;
  }, "");
  // Empty starter/restored tabs stay visually untitled until user content arrives.
  const sessionLooksEmpty =
    !activeTab || (activeTab.messages.length === 0 && !activeTab.input.trim() && !running);
  const displayedSessionTitle = sessionLooksEmpty
    ? ""
    : sessionPrefTitle || cleanSessionTitle(activeTab?.title) || "";
  const sessionPinned = sessionPrefKeys.some((key) => Boolean(sessionPrefs[key]?.pinned));
  const patchActiveSessionPrefs = useCallback(
    (patch: { title?: string; pinned?: boolean }) => {
      for (const key of sessionPrefKeys) patchSessionPref(key, patch);
    },
    [sessionPrefKeys],
  );
  const togglePinnedSession = useCallback(() => {
    if (sessionPrefKeys.length === 0) return;
    patchActiveSessionPrefs({ pinned: !sessionPinned });
  }, [patchActiveSessionPrefs, sessionPinned, sessionPrefKeys.length]);
  const handlePiSessionIdChange = useCallback(
    (piSessionId: string) => {
      if (paneId && activeTabId) copySessionPref(`tab:${paneId}:${activeTabId}`, piSessionId);
      // Once a fresh chat earns its persistent id, swap the throwaway `?new=`
      // nonce in the address bar for `?session=<piSessionId>` so a reload
      // reattaches to (or at least reopens) this conversation instead of
      // restarting a blank chat and losing the in-flight turn from view. Use
      // replaceState — it's invisible to Next's `useSearchParams`, so the
      // running turn's nav effect never re-fires. Side-chat pane excluded.
      if (typeof window !== "undefined" && paneId !== "computer-side-chat" && piSessionId) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("new") !== null && params.get("session") !== piSessionId) {
          params.delete("new");
          params.set("session", piSessionId);
          window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
        }
      }
      onPiSessionIdChange?.(piSessionId);
    },
    [activeTabId, onPiSessionIdChange, paneId],
  );
  const renameActiveSession = useCallback(
    (nextTitle: string) => {
      if (!activeTab) return;
      const trimmed = cleanSessionTitle(nextTitle);
      if (!trimmed || trimmed === displayedSessionTitle) return;
      onRenameSession(activeTab.id, trimmed);
      patchActiveSessionPrefs({ title: trimmed });
    },
    [activeTab, displayedSessionTitle, onRenameSession, patchActiveSessionPrefs],
  );

  return {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  };
}

type UpdateTab = (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;

type UseChatPaneSendFlowOptions = {
  activeTab: SessionTab | null;
  attachments: ChatAttachment[];
  browserToolEnabled: boolean;
  clearAttachments: () => void;
  cwd: string;
  engine: SessionEngine;
  modelId: string;
  modelSupportsVision: boolean;
  readingAttachments: boolean;
  resetComposerHeight: () => void;
  running: boolean;
  runtimeSessionId: string;
  setMention: (mention: ComposerMention | null) => void;
  setStickToBottom: (stickToBottom: boolean) => void;
  tools: ToolsContextValue;
  updateTab: UpdateTab;
};

function useChatPaneSendFlow({
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
  running,
  runtimeSessionId,
  setMention,
  setStickToBottom,
  tools,
  updateTab,
}: UseChatPaneSendFlowOptions) {
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());

  const buildPromptArgs = useCallback(
    (sessionId: string, rawText: string, effectiveBrowserEnabled = browserToolEnabled) => {
      const text = rawText.trim();
      const attachedText = attachmentPrompt(attachments, { modelSupportsVision });
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
      const browserContextText = browserContextPrompt({
        enabled: effectiveBrowserEnabled,
        backend: tools.browser.backend,
        url: tools.browser.url,
        modelId,
      });
      const prompt = [browserContextText, contextText, attachedText].filter(Boolean).join("\n\n");
      const images = modelSupportsVision
        ? attachments.flatMap((file) => {
            const image = imageInputFromAttachment(file);
            return image ? [image] : [];
          })
        : [];
      const messageAttachments = attachments.map((file) => {
        // Prefer the durable inline data URL over the ephemeral blob: URL when
        // available; blob URLs are tied to the composer document and can go stale
        // after a session is persisted and replayed.
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
        browserToolEnabled: effectiveBrowserEnabled,
        plugins: activeComposerPlugins(selection.plugins) as ComposerPluginRef[],
        skills: selection.skills,
        promptTemplates: selection.promptTemplates,
      };
    },
    [attachments, browserToolEnabled, modelId, modelSupportsVision, tools],
  );

  const submitPrompt = useCallback(
    async (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return;
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) return;
      const args = buildPromptArgs(targetId, rawText, browserToolEnabled);
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0 || currentSelection.plugins.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [], plugins: [] });
      }
      setStickToBottom(true);
      clearAttachments();
      resetComposerHeight();
      await engine.submitPrompt({ ...args, targetSessionId: targetId });
    },
    [
      activeTab,
      attachments.length,
      browserToolEnabled,
      buildPromptArgs,
      clearAttachments,
      engine,
      modelId,
      readingAttachments,
      resetComposerHeight,
      setStickToBottom,
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
    [engine, resetComposerHeight, updateTab],
  );

  const runtimeAcceptsControl = useCallback(
    async (tab: SessionTab, runtime: string) => {
      // A steer/control only applies while THIS session has an in-flight turn.
      // After a turn settles the pi SDK session stays loaded, so loadRuntimeStatus
      // keeps reporting active=true — trusting that alone misroutes the NEXT
      // prompt as a steer to an idle agent, which silently stalls (the message
      // is added but no turn starts). Gate on the local turn state first.
      if (tab.status !== "running" && tab.status !== "starting") return false;
      const status = await engine.loadRuntimeStatus(runtime, tab.piSessionId);
      if (!status) return true;
      if (!runtimeStatusLooksActive(status)) return false;
      return !status.piSessionId || !tab.piSessionId || status.piSessionId === tab.piSessionId;
    },
    [engine],
  );

  // Single-flight a submit through one of the in-flight guards: bail if this
  // session already has a submit pending, clear any open @mention, then run and
  // always release the guard. Shared by composer send, queue, and retry.
  const runGuardedSubmit = useCallback(
    async (guard: SessionSubmitGuard, sessionId: string, run: () => Promise<void>) => {
      if (!beginSessionSubmit(guard, sessionId)) return;
      setMention(null);
      try {
        await run();
      } finally {
        endSessionSubmit(guard, sessionId);
      }
    },
    [setMention],
  );

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
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
      if (await runtimeAcceptsControl(activeTab, runtime)) {
        if (!text) return;
        await runGuardedSubmit(controlSubmitInFlightRef.current, activeTab.id, () =>
          queueAndSendControl("steer", text, activeTab, runtime),
        );
        return;
      }
      await runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () =>
        submitPrompt(text, activeTab.id),
      );
    },
    [
      activeTab,
      attachments.length,
      modelId,
      queueAndSendControl,
      readingAttachments,
      runGuardedSubmit,
      runtimeAcceptsControl,
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
    const runtime = activeTab.runtimeSessionId || runtimeSessionId;
    if (await runtimeAcceptsControl(activeTab, runtime)) {
      await runGuardedSubmit(controlSubmitInFlightRef.current, activeTab.id, () =>
        queueAndSendControl("follow_up", text, activeTab, runtime, cwd),
      );
      return;
    }
    await runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () =>
      submitPrompt(text, activeTab.id),
    );
  }, [
    activeTab,
    cwd,
    modelId,
    queueAndSendControl,
    runGuardedSubmit,
    runtimeAcceptsControl,
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

  const abortTurn = useCallback(async () => {
    if (!activeTab) return;
    await engine.abortTurn(activeTab.id);
  }, [activeTab, engine]);

  // Re-run the last user turn after a failure (a 503, a network blip). On a
  // *send* failure the text is restored to the composer, but a turn that errors
  // mid-stream leaves the prompt only in the transcript with an empty composer —
  // so retry resends the last user message directly.
  const retryLast = useCallback(async () => {
    if (!activeTab || !modelId) return;
    const lastUserText = [...activeTab.messages].reverse().find((m) => m.role === "user")?.text;
    const text = (lastUserText ?? activeTab.input).trim();
    if (!text) return;
    await runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, async () => {
      updateTab(activeTab.id, (t) => ({ ...t, error: "", input: "" }));
      await submitPrompt(text, activeTab.id);
    });
  }, [activeTab, modelId, runGuardedSubmit, submitPrompt, updateTab]);

  return { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn, retryLast };
}

type UseComposerAttachmentsOptions = {
  activeTab: SessionTab | null;
  running: boolean;
  updateTab: UpdateTab;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

function useComposerAttachments({
  activeTab,
  running,
  updateTab,
  fileInputRef,
}: UseComposerAttachmentsOptions) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);

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
    [activeTab, fileInputRef, running, updateTab],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [fileInputRef]);

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

  return {
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
  };
}

function useComposerLoadedContext({
  activeTab,
  tools,
}: {
  activeTab: SessionTab | null;
  tools: ToolsContextValue;
}) {
  const activeSelection = tools.selectionFor(activeTab?.id);
  const removeLoadedContext = useCallback(
    (kind: LoadedContextKind, id: string) => {
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

  return {
    selectedPlugins: activeSelection.plugins,
    selectedSkills: activeSelection.skills,
    selectedPromptTemplates: activeSelection.promptTemplates,
    removeLoadedContext,
  };
}

type UseComposerMentionRowsOptions = {
  fileMentionRows: FileMentionRow[];
  mention: ComposerMention | null;
  pluginRows: ComposerPluginRef[];
  promptTemplateRows: ComposerPromptTemplateRef[];
  skillRows: ComposerSkillRef[];
};

function useComposerMentionRows({
  fileMentionRows,
  mention,
  pluginRows,
  promptTemplateRows,
  skillRows,
}: UseComposerMentionRowsOptions): MentionRow[] {
  return useMemo<MentionRow[]>(() => {
    if (!mention) return [];
    if (mention.kind === "skill") {
      return byQuery(skillRows, mention.query, 8).map((row) => ({ kind: "skill", row }));
    }
    if (mention.kind === "promptTemplate") {
      return byQuery(promptTemplateRows, mention.query, 8).map((row) => ({
        kind: "promptTemplate" as const,
        row,
      }));
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
}

type ContextRow = ComposerPluginRef | ComposerSkillRef | ComposerPromptTemplateRef;
type LoadedContextRow = {
  skill?: ComposerSkillRef;
  plugin?: ComposerPluginRef;
  template?: ComposerPromptTemplateRef;
};

function useComposerMentionSelection({
  activeTab,
  mention,
  cwd,
  tools,
  updateTab,
  setAttachments,
  setMention,
  textareaRef,
}: {
  activeTab: SessionTab | null;
  mention: ComposerMention | null;
  cwd: string;
  tools: Pick<ToolsContextValue, "selectionFor" | "setSelection">;
  updateTab: (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return useCallback(
    async (entry: MentionRow) => {
      if (!activeTab || !mention) return;

      if (entry.kind === "file") {
        const input = consumeComposerMention(activeTab.input, mention);
        updateTab(activeTab.id, (tab) => ({ ...tab, input }));
        addUniqueAttachment(setAttachments, await loadProjectFileAttachment(cwd, entry.row));
      } else {
        const selectedRow = await loadContextRow(entry.row, mention.kind);
        const input = consumeComposerMention(activeTab.input, mention);
        updateTab(activeTab.id, (tab) => ({ ...tab, input }));
        applySelectedContext(activeTab.id, mention.kind, selectedRow, tools);
      }

      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [activeTab, cwd, mention, setAttachments, setMention, textareaRef, tools, updateTab],
  );
}

async function loadProjectFileAttachment(
  cwd: string,
  row: Extract<MentionRow, { kind: "file" }>["row"],
): Promise<ChatAttachment> {
  const loaded = await jsonOrNull<{ content: string; truncated: boolean; size: number }>(
    `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(row.rel)}`,
  );
  return createProjectFileAttachment({
    id: row.id,
    name: row.name,
    path: row.path,
    content: loaded?.content ?? "",
    truncated: loaded?.truncated ?? true,
    size: loaded?.size ?? 0,
  });
}

async function loadContextRow(row: ContextRow, kind: ComposerMention["kind"]): Promise<ContextRow> {
  if (!row.path) return row;
  const loaded = await jsonOrNull<LoadedContextRow>(loadEndpoint(kind, row.path));
  return loaded?.skill
    ? { ...row, ...loaded.skill, id: row.id }
    : loaded?.plugin
      ? { ...row, ...loaded.plugin, id: row.id }
      : loaded?.template
        ? { ...row, ...loaded.template, id: row.id }
        : row;
}

function loadEndpoint(kind: ComposerMention["kind"], path: string): string {
  const encoded = encodeURIComponent(path);
  if (kind === "skill") return `/api/agent/skills/load?path=${encoded}`;
  if (kind === "promptTemplate") return `/api/agent/prompt-templates/load?path=${encoded}`;
  return `/api/agent/plugins/load?path=${encoded}`;
}

function applySelectedContext(
  sessionId: string,
  kind: ComposerMention["kind"],
  selectedRow: ContextRow,
  tools: Pick<ToolsContextValue, "selectionFor" | "setSelection">,
) {
  const current = tools.selectionFor(sessionId);
  if (kind === "plugin" && !current.plugins.some((plugin) => plugin.id === selectedRow.id)) {
    return tools.setSelection(sessionId, {
      ...current,
      plugins: [...current.plugins, activateComposerPlugin(selectedRow as ComposerPluginRef)],
    });
  }
  if (kind === "skill" && !current.skills.some((skill) => skill.id === selectedRow.id)) {
    return tools.setSelection(sessionId, {
      ...current,
      skills: [...current.skills, selectedRow as ComposerSkillRef],
    });
  }
  if (
    kind === "promptTemplate" &&
    !current.promptTemplates.some((template) => template.id === selectedRow.id)
  ) {
    return tools.setSelection(sessionId, {
      ...current,
      promptTemplates: [...current.promptTemplates, selectedRow as ComposerPromptTemplateRef],
    });
  }
}

function addUniqueAttachment(
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>,
  attachment: ChatAttachment,
) {
  setAttachments((current) => {
    const nextKey = attachmentDedupKey(attachment);
    if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
    return [...current, attachment];
  });
}

function jsonOrNull<T>(url: string): Promise<T | null> {
  return fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<T>) : null))
    .catch(() => null);
}

function useComposerTextareaHeightSync({
  value,
  textareaRef,
  lastAppliedComposerHeightRef,
  lastComposerValueLengthRef,
}: {
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lastAppliedComposerHeightRef: MutableRefObject<number>;
  lastComposerValueLengthRef: MutableRefObject<number>;
}) {
  const subscribeHeightSync = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return () => undefined;

    if (!value) {
      node.style.height = "";
      node.scrollTop = 0;
      lastAppliedComposerHeightRef.current = 0;
      lastComposerValueLengthRef.current = 0;
      return () => undefined;
    }

    node.style.height = "auto";
    const next = node.scrollHeight;
    node.style.height = `${next}px`;
    lastAppliedComposerHeightRef.current = next;
    lastComposerValueLengthRef.current = value.length;
    return () => undefined;
  }, [lastAppliedComposerHeightRef, lastComposerValueLengthRef, textareaRef, value]);

  useSyncExternalStore(subscribeHeightSync, getChatPaneSnapshot, getChatPaneSnapshot);
}

function useComposerTextareaBehavior({
  activeTab,
  mention,
  mentionRows,
  mentionIndex,
  running,
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
}: {
  activeTab: SessionTab | null;
  mention: ComposerMention | null;
  mentionRows: MentionRow[];
  mentionIndex: number;
  running: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  lastAppliedComposerHeightRef: MutableRefObject<number>;
  lastComposerValueLengthRef: MutableRefObject<number>;
  resetComposerHeight: () => void;
  updateTab: UpdateTab;
  setMention: Dispatch<SetStateAction<ComposerMention | null>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
  selectMentionRow: (entry: MentionRow) => Promise<void>;
  queueMessage: () => Promise<void>;
  abortTurn: () => Promise<void>;
  attachFiles: (files: FileList | File[] | null) => Promise<void>;
}) {
  const resizeAfterCommit = useCallback(
    (nextValue: string, nextCaret: number) => {
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.setSelectionRange(nextCaret, nextCaret);
        node.style.height = "auto";
        const next = node.scrollHeight;
        node.style.height = `${next}px`;
        lastAppliedComposerHeightRef.current = next;
        lastComposerValueLengthRef.current = nextValue.length;
      });
    },
    [lastAppliedComposerHeightRef, lastComposerValueLengthRef, textareaRef],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromDataTransfer(event.clipboardData);
      if (files.length === 0) {
        const text = event.clipboardData.getData("text/plain");
        const pastedImage = imageFileFromDataUrlText(text);
        if (pastedImage) {
          event.preventDefault();
          void attachFiles([pastedImage]);
          return;
        }
        if (!text || !activeTab) return;
        event.preventDefault();
        // Apply large text pastes as one controlled update to avoid composer resize flicker.
        const element = event.currentTarget;
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? element.value.length;
        const current = activeTab.input ?? "";
        const nextValue = current.slice(0, start) + text + current.slice(end);
        const nextCaret = start + text.length;
        updateTab(activeTab.id, (tab) => ({ ...tab, input: nextValue }));
        setMention(null);
        resizeAfterCommit(nextValue, nextCaret);
        return;
      }
      event.preventDefault();
      void attachFiles(files);
    },
    [activeTab, attachFiles, resizeAfterCommit, setMention, updateTab],
  );

  const handleComposerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({ ...tab, input: value }));
      setMention(value ? detectComposerMention(value, event.currentTarget.selectionStart) : null);
      const element = event.currentTarget;
      if (!value) {
        resetComposerHeight();
        return;
      }
      const prevLength = lastComposerValueLengthRef.current;
      lastComposerValueLengthRef.current = value.length;
      const shrinking = value.length < prevLength;
      if (shrinking) element.style.height = "auto";
      const next = element.scrollHeight;
      if (!shrinking && next === lastAppliedComposerHeightRef.current) return;
      element.style.height = `${next}px`;
      lastAppliedComposerHeightRef.current = next;
    },
    [
      activeTab,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      setMention,
      updateTab,
    ],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setMentionIndex((index) => {
            if (mentionRows.length === 0) return 0;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            return (index + delta + mentionRows.length) % mentionRows.length;
          });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setMention(null);
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && mentionRows[mentionIndex]) {
          event.preventDefault();
          void selectMentionRow(mentionRows[mentionIndex]);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        if (!activeTab?.input.trim()) return;
        event.preventDefault();
        void queueMessage();
        return;
      }
      if (event.key === "Escape" || (event.key === "." && (event.metaKey || event.ctrlKey))) {
        if (running) {
          event.preventDefault();
          void abortTurn();
        }
      }
    },
    [
      abortTurn,
      activeTab,
      mention,
      mentionIndex,
      mentionRows,
      queueMessage,
      running,
      selectMentionRow,
      setMention,
      setMentionIndex,
    ],
  );

  return {
    handleComposerPaste,
    handleComposerChange,
    handleComposerKeyDown,
  };
}
