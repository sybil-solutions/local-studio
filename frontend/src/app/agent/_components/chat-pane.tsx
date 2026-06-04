"use client";
import {
  FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { CloseIcon, FileIcon } from "@/ui/icons";
import { AgentChatPaneHeader } from "@/ui/agent-chat-pane-header";
import { AgentComposerActions } from "@/ui/agent-composer-actions";
import { AgentComposerStatusBar } from "@/ui/agent-composer-status-bar";
import {
  AgentLoadedContextTabs,
  AgentMentionPicker,
  type FileMentionRow,
  type MentionRow,
} from "@/ui/agent-composer-context";
import { AgentQueuePanel } from "@/ui/agent-queue-panel";
import {
  useChatPaneMentionEffects,
  useChatPaneRegisterHandleEffect,
  useChatPaneStickToBottomEffect,
} from "@/hooks/agent/use-chat-pane-effects";
import { useProjectsNavSessionPrefs } from "@/hooks/agent/use-projects-nav-section-effects";
import {
  activateComposerPlugin,
  activeComposerPlugins,
  byQuery,
  detectComposerMention,
  consumeComposerMention,
  selectedContextPrompt,
  type ComposerMention,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import {
  AgentTurnSsePayload,
  AssistantBlock,
  asRecord,
  ChatMessage,
  ChatPaneHandle,
  EventBlock,
  cleanSessionTitle,
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
import { copySessionPref, patchSessionPref } from "@/lib/agent/session/prefs";
import { promptRequestsBrowser } from "@/lib/agent/browser/intent";
import { useTools } from "@/lib/agent/tools/context";
import {
  attachmentDedupKey,
  attachmentPrompt,
  createAttachment,
  createProjectFileAttachment,
  dataTransferHasFiles,
  filesFromDataTransfer,
  formatFileSize,
  imageFileFromDataUrlText,
  imageInputFromAttachment,
  isImageAttachment,
  isRenderableAttachment,
  type ChatAttachment,
} from "./chat-attachments";
import { Timeline } from "./timeline/timeline";
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
  // Track the height we last *applied* to the composer textarea so we can
  // skip the "height: auto" reset on every keystroke. Resetting to auto
  // collapses the textarea for one paint before the new scrollHeight is
  // re-applied, which the user sees as flicker once the composer is
  // multi-line. We only need that reset when content might have *shrunk*
  // (i.e., when the value got shorter than before).
  const lastAppliedComposerHeightRef = useRef(0);
  const lastComposerValueLengthRef = useRef(0);
  const [isMultiline, setIsMultiline] = useState(false);
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
  const sessionPrefs = useProjectsNavSessionPrefs();
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
  // Consume "attach as context" requests (e.g. file comments from the
  // filesystem panel) into this pane's composer attachments. Only the focused
  // pane consumes a given request; a handled-id guard prevents re-adding.
  // Uses useSyncExternalStore (not useEffect) per this repo's workspace rule.
  const contextAttachRequest = tools.contextAttachRequest;
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
  }, [contextAttachRequest, isFocused]);
  useSyncExternalStore(
    subscribeContextAttach,
    getChatPaneEffectSnapshot,
    getChatPaneEffectSnapshot,
  );
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
  // Rule: if the visible session is empty (no rendered messages, no input,
  // not actively running) the header is blank. This covers three different
  // cases that all looked broken before:
  //   - a brand-new starter tab opened via "+" (no piSessionId yet)
  //   - a persisted chat being restored before replay has filled in messages
  //   - a freshly cleared/forked session waiting for its first turn
  // Once the user types or pi streams the first message in, the real title
  // takes over.
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
  const selectMentionRow = useCallback(
    async (entry: MentionRow) => {
      if (!activeTab || !mention) return;
      const selectedMention = mention;
      if (entry.kind === "file") {
        const input = consumeComposerMention(activeTab.input, selectedMention);
        updateTab(activeTab.id, (tab) => ({ ...tab, input }));
        const loaded = await fetch(
          `/api/agent/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(entry.row.rel)}`,
          { cache: "no-store" },
        )
          .then((response) =>
            response.ok
              ? (response.json() as Promise<{
                  content: string;
                  truncated: boolean;
                  size: number;
                }>)
              : null,
          )
          .catch(() => null);
        const attachment = createProjectFileAttachment({
          id: entry.row.id,
          name: entry.row.name,
          path: entry.row.path,
          content: loaded?.content ?? "",
          truncated: loaded?.truncated ?? true,
          size: loaded?.size ?? 0,
        });
        setAttachments((current) => {
          const nextKey = attachmentDedupKey(attachment);
          if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
          return [...current, attachment];
        });
        setMention(null);
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
      const row = entry.row;
      const input = consumeComposerMention(activeTab.input, selectedMention);
      let selectedRow = row;
      if ("path" in row && row.path) {
        const endpoint =
          selectedMention.kind === "skill"
            ? `/api/agent/skills/load?path=${encodeURIComponent(row.path)}`
            : selectedMention.kind === "promptTemplate"
              ? `/api/agent/prompt-templates/load?path=${encodeURIComponent(row.path)}`
              : `/api/agent/plugins/load?path=${encodeURIComponent(row.path)}`;
        const loaded = await fetch(endpoint, { cache: "no-store" })
          .then((res) =>
            res.ok
              ? (res.json() as Promise<{
                  skill?: ComposerSkillRef;
                  plugin?: ComposerPluginRef;
                  template?: ComposerPromptTemplateRef;
                }>)
              : null,
          )
          .catch(() => null);
        selectedRow = loaded?.skill
          ? { ...row, ...loaded.skill, id: row.id }
          : loaded?.plugin
            ? { ...row, ...loaded.plugin, id: row.id }
            : loaded?.template
              ? { ...row, ...loaded.template, id: row.id }
              : row;
      }
      updateTab(activeTab.id, (tab) => ({ ...tab, input }));
      const current = tools.selectionFor(activeTab.id);
      if (selectedMention.kind === "plugin") {
        if (!current.plugins.some((plugin) => plugin.id === selectedRow.id)) {
          tools.setSelection(activeTab.id, {
            ...current,
            plugins: [...current.plugins, activateComposerPlugin(selectedRow as ComposerPluginRef)],
          });
        }
      } else if (selectedMention.kind === "skill") {
        if (!current.skills.some((skill) => skill.id === selectedRow.id)) {
          tools.setSelection(activeTab.id, {
            ...current,
            skills: [...current.skills, selectedRow as ComposerSkillRef],
          });
        }
      } else if (
        selectedMention.kind === "promptTemplate" &&
        !current.promptTemplates.some((template) => template.id === selectedRow.id)
      ) {
        tools.setSelection(activeTab.id, {
          ...current,
          promptTemplates: [...current.promptTemplates, selectedRow as ComposerPromptTemplateRef],
        });
      }
      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [activeTab, cwd, mention, tools, updateTab],
  );
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
      setIsMultiline(false);
      if (textareaRef.current) textareaRef.current.style.height = "";
      lastAppliedComposerHeightRef.current = 0;
      lastComposerValueLengthRef.current = 0;
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
      setIsMultiline(false);
      if (textareaRef.current) textareaRef.current.style.height = "";
      lastAppliedComposerHeightRef.current = 0;
      lastComposerValueLengthRef.current = 0;
      const result = await engine.sendControl(mode, text, runtime, tab.id, tab.piSessionId);
      updateTab(tab.id, (t) => ({
        ...t,
        queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
        ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
      }));
    },
    [engine, ensureBrowserToolForText, updateTab],
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
        // Insert plain text ourselves in ONE atomic update. Letting the browser
        // natively insert a large multi-line paste makes the controlled value
        // round-trip through the reducer mid-insertion, so the textarea visibly
        // fills line-by-line and the auto-resize fires repeatedly (flicker +
        // resize). Splicing at the caret and updating once avoids that.
        if (!text || !activeTab) return;
        event.preventDefault();
        const element = event.currentTarget;
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? element.value.length;
        const current = activeTab.input ?? "";
        const nextValue = current.slice(0, start) + text + current.slice(end);
        const nextCaret = start + text.length;
        updateTab(activeTab.id, (tab) => ({ ...tab, input: nextValue }));
        setMention(null);
        // Resize once after React commits the new value, and restore the caret
        // to just after the inserted text.
        requestAnimationFrame(() => {
          const node = textareaRef.current;
          if (!node) return;
          node.setSelectionRange(nextCaret, nextCaret);
          node.style.height = "auto";
          const next = node.scrollHeight;
          node.style.height = `${next}px`;
          lastAppliedComposerHeightRef.current = next;
          lastComposerValueLengthRef.current = nextValue.length;
          setIsMultiline(next > 38);
        });
        return;
      }
      event.preventDefault();
      void attachFiles(files);
    },
    [activeTab, attachFiles, updateTab],
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
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-4 pt-2">
              {attachments.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex max-w-[220px] items-center gap-1 px-1 py-0.5 text-[length:var(--fs-sm)] text-(--dim)"
                  title={`${file.name} · ${file.type} · ${formatFileSize(file.size)}${file.path ? ` · ${file.path}` : ""}`}
                >
                  {isImageAttachment(file) ? (
                    <img
                      src={file.content}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded object-cover"
                    />
                  ) : isRenderableAttachment(file) && file.previewKind === "pdf" ? (
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-(--border) bg-(--bg) font-mono text-[length:var(--fs-2xs)] text-(--fg)">
                      PDF
                    </span>
                  ) : isRenderableAttachment(file) && file.previewKind === "video" ? (
                    <video
                      src={file.previewUrl}
                      className="h-7 w-7 shrink-0 rounded object-cover"
                      muted
                    />
                  ) : (
                    <FileIcon className="h-3 w-3 shrink-0" />
                  )}{" "}
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 opacity-70">{formatFileSize(file.size)}</span>{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) => current.filter((item) => item.id !== file.id))
                    }
                    className="p-0.5 hover:text-(--fg)"
                    aria-label={`Remove ${file.name}`}
                    title={`Remove ${file.name}`}
                  >
                    <CloseIcon className="h-3 w-3" />{" "}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            rows={1}
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
                lastAppliedComposerHeightRef.current = 0;
                lastComposerValueLengthRef.current = 0;
                setIsMultiline(false);
                setMention(null);
                return;
              }
              const prevLength = lastComposerValueLengthRef.current;
              lastComposerValueLengthRef.current = value.length;
              const shrinking = value.length < prevLength;
              // When the content shrinks we have to briefly let the textarea
              // collapse so `scrollHeight` reflects the new minimum.
              // When the content only grows, we can skip the "height: auto"
              // reset — that reset is what causes the one-frame flicker
              // every keystroke in a multi-line composer.
              if (shrinking) {
                element.style.height = "auto";
              }
              const next = element.scrollHeight;
              if (!shrinking && next === lastAppliedComposerHeightRef.current) {
                // Height didn't change while growing — skip the write
                // entirely. Re-assigning the same `style.height` still
                // forces a style recompute on Electron/Chromium and
                // contributes to the perceptible shake.
                return;
              }
              element.style.height = `${next}px`;
              lastAppliedComposerHeightRef.current = next;
              setIsMultiline(next > 38);
            }}
            onKeyDown={(event) => {
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
                  selectMentionRow(mentionRows[mentionIndex]);
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
            placeholder=""
            className="min-h-[44px] max-h-[50vh] w-full resize-none overflow-y-auto bg-transparent px-4 py-2.5 text-[length:var(--fs-lg)] leading-[1.6] tracking-normal text-(--fg) outline-none placeholder:text-(--dim)/60"
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

const getChatPaneEffectSnapshot = (): number => 0;
