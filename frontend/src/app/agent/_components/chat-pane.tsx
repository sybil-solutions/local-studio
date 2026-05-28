"use client";
import {
  FormEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  AtSign,
  Code2,
  FileText,
  Hash,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Plus,
  Slash,
  Sparkles,
} from "lucide-react";
import {
  CloseIcon,
  FileIcon,
  GitBranchIcon,
  GlobeIcon,
  MoreIcon,
  SendIcon,
  StopIcon,
} from "@/components/icons";
import { useClickOutside } from "@/hooks/use-click-outside";
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
  type ComposerExtensionOverride,
  type ComposerExtensionRef,
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
  formatTokenCount,
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
type FileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};
type ExtensionRowState = ComposerExtensionRef & {
  effectiveEnabled: boolean;
  hasTurnOverride: boolean;
};

type MentionRow =
  | { kind: "plugin"; row: ComposerPluginRef }
  | { kind: "skill"; row: ComposerSkillRef }
  | { kind: "promptTemplate"; row: ComposerPromptTemplateRef }
  | { kind: "file"; row: FileMentionRow }
  | { kind: "extension"; row: ExtensionRowState };

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
  const selectedExtensionOverrides = activeSelection.extensionOverrides;
  const extensionCatalogue = tools.extensionCatalogue;
  const refreshExtensionCatalogue = tools.refreshExtensionCatalogue;
  const computerUseLoaded = selectedPlugins.some((plugin) =>
    [plugin.id, plugin.name, plugin.path].some((value) =>
      value?.toLowerCase().includes("computer-use"),
    ),
  );
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  useChatPaneStickToBottomEffect({
    activeTabId: activeTab?.id,
    setStickToBottom,
  });
  const overrideByKey = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const entry of selectedExtensionOverrides) map.set(entry.key, entry.enabled);
    return map;
  }, [selectedExtensionOverrides]);
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
      // Surface installed Pi extensions here too — they own real slash
      // commands (e.g. /goal from @narumitw/pi-goal) and the user otherwise
      // has no visual confirmation that they're loaded.
      const extensions = byQuery(extensionCatalogue, mention.query, 8).map((row) => {
        const overrideKeys = [row.source, row.path].filter(Boolean) as string[];
        let effectiveEnabled = row.enabled;
        let hasTurnOverride = false;
        for (const key of overrideKeys) {
          if (overrideByKey.has(key)) {
            effectiveEnabled = overrideByKey.get(key) ?? row.enabled;
            hasTurnOverride = true;
            break;
          }
        }
        return {
          kind: "extension" as const,
          row: { ...row, effectiveEnabled, hasTurnOverride },
        };
      });
      return [...templates, ...extensions].slice(0, 12);
    }
    if (mention.kind === "extension") {
      return byQuery(extensionCatalogue, mention.query, 12).map((row) => {
        const overrideKeys = [row.source, row.path].filter(Boolean) as string[];
        let effectiveEnabled = row.enabled;
        let hasTurnOverride = false;
        for (const key of overrideKeys) {
          if (overrideByKey.has(key)) {
            effectiveEnabled = overrideByKey.get(key) ?? row.enabled;
            hasTurnOverride = true;
            break;
          }
        }
        return {
          kind: "extension" as const,
          row: { ...row, effectiveEnabled, hasTurnOverride },
        };
      });
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
  }, [
    extensionCatalogue,
    fileMentionRows,
    mention,
    overrideByKey,
    pluginRows,
    promptTemplateRows,
    skillRows,
  ]);
  // Refresh the extension catalogue whenever the `/plugins` picker opens so
  // freshly-installed packages or external `enabled.json` edits show up.
  const mentionKind = mention?.kind;
  const lastExtensionRefreshRef = useRef<number>(0);
  if (mentionKind === "extension" || mentionKind === "promptTemplate") {
    const now = Date.now();
    if (now - lastExtensionRefreshRef.current > 1_500) {
      lastExtensionRefreshRef.current = now;
      void refreshExtensionCatalogue();
    }
  }
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
  const toggleExtensionOverride = useCallback(
    (row: ExtensionRowState) => {
      if (!activeTab) return;
      const current = tools.selectionFor(activeTab.id);
      const key = row.source && row.source !== "auto" ? row.source : row.path;
      const next = !row.effectiveEnabled;
      // If the new state matches the persisted enabled flag we have no
      // reason to keep a per-turn override around (cleaner UX, no stale chip).
      const overrides = current.extensionOverrides.filter((entry) => entry.key !== key);
      if (next !== row.enabled) {
        overrides.push({ key, enabled: next });
      }
      tools.setSelection(activeTab.id, { ...current, extensionOverrides: overrides });
    },
    [activeTab, tools],
  );
  const persistExtensionEnabled = useCallback(
    async (row: ExtensionRowState, enabled: boolean) => {
      const key = row.source && row.source !== "auto" ? row.source : row.path;
      try {
        await fetch("/api/agent/extensions/enable", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, enabled }),
        });
        if (activeTab) {
          const current = tools.selectionFor(activeTab.id);
          const overrides = current.extensionOverrides.filter((entry) => entry.key !== key);
          if (overrides.length !== current.extensionOverrides.length) {
            tools.setSelection(activeTab.id, { ...current, extensionOverrides: overrides });
          }
        }
        await refreshExtensionCatalogue();
      } catch {
        // Best-effort — the picker will reflect the previous state.
      }
    },
    [activeTab, refreshExtensionCatalogue, tools],
  );
  const selectMentionRow = useCallback(
    async (entry: MentionRow) => {
      if (!activeTab || !mention) return;
      const selectedMention = mention;
      if (entry.kind === "extension") {
        // `/plugins` picker: clicking a row toggles the per-turn override.
        // The picker stays open so the user can flip multiple plugins; the
        // composer text is preserved so they can continue typing afterwards.
        toggleExtensionOverride(entry.row);
        // Keep focus in the textarea but don't close the picker; users
        // typically toggle several before sending.
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
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
      if (
        selectedMention.kind === "plugin" &&
        entry.kind === "plugin" &&
        row.name.toLowerCase().includes("browser-use") &&
        !browserToolEnabled
      ) {
        onToggleBrowserTool();
      }
      setMention(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [
      activeTab,
      browserToolEnabled,
      cwd,
      mention,
      onToggleBrowserTool,
      toggleExtensionOverride,
      tools,
      updateTab,
    ],
  );
  const removeLoadedContext = useCallback(
    (kind: "plugin" | "skill" | "promptTemplate" | "extensionOverride", id: string) => {
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
        extensionOverrides:
          kind === "extensionOverride"
            ? current.extensionOverrides.filter((entry) => entry.key !== id)
            : current.extensionOverrides,
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
        extensionOverrides: selection.extensionOverrides,
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
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [] });
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
    [activeTab, attachments.length, buildPromptArgs, engine, modelId, readingAttachments, tools],
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
    [engine, updateTab],
  );
  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      if (running) {
        if (!text || readingAttachments) return;
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
      if ((!text && attachments.length === 0) || readingAttachments) return;
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
    if (!text) return;
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
        const pastedImage = imageFileFromDataUrlText(event.clipboardData.getData("text/plain"));
        if (!pastedImage) return;
        event.preventDefault();
        void attachFiles([pastedImage]);
        return;
      }
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
  const visibleQueue = queueExpanded ? visibleQueueItems : visibleQueueItems.slice(-1);
  const latestQueued = visibleQueueItems[visibleQueueItems.length - 1] ?? null;
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
  const displayCwd = formatHomeRelativePath(cwd);
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--agent-bg)"
    >
      {showHeader ? (
        <ChatPaneHeader
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
          statusLabel={activeTab?.status}
          emptyPrompt={Boolean(showEmptyPrompt)}
        />
      </div>
      <form onSubmit={sendMessage} className="shrink-0 bg-(--agent-bg) px-6 pb-1.5 pt-2">
        {visibleQueueItems.length > 0 ? (
          <div className="mx-auto mb-1 w-[85%] max-w-[var(--composer-w)] overflow-hidden rounded-lg bg-(--composer) px-4 py-2 text-[11px] text-(--fg)">
            <button
              type="button"
              onClick={() => setQueueExpanded((value) => !value)}
              className="flex w-full min-w-0 items-center gap-2 text-left"
              aria-expanded={queueExpanded}
              title="Queued follow-ups and steers"
            >
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-(--dim)">
                queue {visibleQueueItems.length}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {latestQueued?.text ?? "No queued message"}
              </span>
            </button>{" "}
            {queueExpanded ? (
              <div className="mt-1 space-y-0.5">
                {" "}
                {visibleQueue.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-w-0 items-center gap-2 py-1"
                    title={`${item.mode === "steer" ? "Steer" : "Queued follow-up"}: ${item.text}`}
                  >
                    {" "}
                    <span
                      className={`shrink-0 font-mono text-[10px] uppercase tracking-wide ${item.mode === "steer" ? "text-(--accent)" : "text-(--dim)"}`}
                    >
                      {item.mode === "steer" ? "steer" : "queue"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.text}</span>{" "}
                    <button
                      type="button"
                      onClick={() => removeQueued(item.id)}
                      className="shrink-0 p-0.5 text-(--dim) hover:text-(--fg)"
                      aria-label="Remove queued message"
                      title="Remove queued message"
                    >
                      <CloseIcon className="h-3 w-3" />{" "}
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
          className={`mx-auto max-w-[var(--composer-w)] overflow-visible rounded-2xl border border-(--border)/20 bg-(--composer) shadow-[0_2px_12px_rgba(0,0,0,0.15)] transition-colors ${composerDragActive ? "outline outline-1 outline-(--accent)/50" : ""}`}
        >
          {" "}
          {composerDragActive ? (
            <div className="px-4 pt-2 text-[11px] text-(--accent)">
              Drop files to attach to the next message.
            </div>
          ) : null}
          {selectedPlugins.length +
            selectedSkills.length +
            selectedPromptTemplates.length +
            selectedExtensionOverrides.length >
          0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pt-2 text-[11px]">
              {selectedPlugins.map((plugin) => (
                <LoadedContextTab
                  key={`plugin-${plugin.id}`}
                  prefix="@"
                  label={plugin.displayName ?? plugin.name}
                  title={plugin.path}
                  active={plugin.name.toLowerCase().includes("computer-use")}
                  onRemove={() => removeLoadedContext("plugin", plugin.id)}
                />
              ))}{" "}
              {selectedSkills.map((skill) => (
                <LoadedContextTab
                  key={`skill-${skill.id}`}
                  prefix="$"
                  label={skill.name}
                  title={skill.path}
                  active={false}
                  onRemove={() => removeLoadedContext("skill", skill.id)}
                />
              ))}
              {selectedPromptTemplates.map((template) => (
                <LoadedContextTab
                  key={`template-${template.id}`}
                  prefix="/"
                  label={template.name}
                  title={template.description ?? template.path}
                  active={false}
                  onRemove={() => removeLoadedContext("promptTemplate", template.id)}
                />
              ))}
              {selectedExtensionOverrides.map((entry) => {
                const ext = extensionCatalogue.find(
                  (row) => row.source === entry.key || row.path === entry.key,
                );
                const label = ext?.name ?? entry.key;
                return (
                  <LoadedContextTab
                    key={`extover-${entry.key}`}
                    prefix={entry.enabled ? "/+" : "/-"}
                    label={label}
                    title={`${entry.enabled ? "Force-enable" : "Force-disable"} for this turn: ${entry.key}`}
                    active={entry.enabled}
                    onRemove={() => removeLoadedContext("extensionOverride", entry.key)}
                  />
                );
              })}
            </div>
          ) : null}
          {mention ? (
            <div className="px-4 pt-2">
              <MentionPickerHeader
                kind={mention.kind}
                query={mention.query}
                onOpenPlugins={() => {
                  tools.setComputerTab("plugins");
                  tools.setComputerOpen(true);
                }}
              />{" "}
              {mentionRows.length ? (
                <div className="grid gap-1">
                  {" "}
                  {mentionRows.map((entry, index) => {
                    if (entry.kind === "extension") {
                      return (
                        <MentionExtensionRow
                          key={`ext:${entry.row.id}`}
                          entry={entry}
                          active={index === mentionIndex}
                          onSelect={() => void selectMentionRow(entry)}
                          onPersist={(next) => void persistExtensionEnabled(entry.row, next)}
                        />
                      );
                    }
                    return (
                      <MentionRowItem
                        key={entry.row.id}
                        entry={entry}
                        active={index === mentionIndex}
                        onSelect={() => void selectMentionRow(entry)}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-(--border) px-3 py-3 text-center text-[11px] text-(--dim)">
                  No{" "}
                  {mention.kind === "plugin"
                    ? "plugins or files"
                    : mention.kind === "skill"
                      ? "skills"
                      : mention.kind === "promptTemplate"
                        ? "slash commands or extensions"
                        : "installed Pi extensions"}{" "}
                  match <span className="font-mono text-(--fg)">{mention.query || "…"}</span>
                  {mention.kind === "extension" ? (
                    <>
                      .{" "}
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          tools.setComputerTab("plugins");
                          tools.setComputerOpen(true);
                        }}
                        className="text-(--accent) hover:underline"
                      >
                        Browse catalog →
                      </button>
                    </>
                  ) : null}
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
                    <img
                      src={file.content}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded object-cover"
                    />
                  ) : isRenderableAttachment(file) && file.previewKind === "pdf" ? (
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-(--border) bg-(--bg) font-mono text-[9px] text-(--fg)">
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
            placeholder={
              !modelName && modelsLoading
                ? "Loading models…"
                : !modelName
                  ? "No models available"
                  : running
                    ? `Steer ${modelName}…`
                    : `Message ${modelName}`
            }
            className="min-h-[44px] max-h-[50vh] w-full resize-none overflow-y-auto bg-transparent px-4 py-2.5 text-[14px] leading-[1.6] tracking-normal text-(--fg) outline-none placeholder:text-(--dim)/60"
          />
          <div className="agent-composer-actions-row flex min-h-8 items-center gap-1.5 bg-transparent px-3 pb-1.5 pt-0.5 text-xs">
            {" "}
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
              className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--dim) hover:text-(--fg)/80 disabled:opacity-30"
              aria-label="Attach files"
              title="Attach files (or paste/drop into composer)"
            >
              {" "}
              <Plus className="h-3.5 w-3.5" />
            </button>{" "}
            <button
              type="button"
              onClick={onToggleBrowserTool}
              aria-pressed={browserToolEnabled}
              title={
                browserToolEnabled
                  ? "Browser tool: ON — agent can drive the browser"
                  : "Browser tool: OFF — click to let the agent navigate, click, fill, and read pages"
              }
              className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${browserToolEnabled ? "text-(--accent)/70 hover:text-(--accent)" : "text-(--dim)/75 hover:text-(--fg)/80"}`}
            >
              <span className="relative inline-flex">
                {" "}
                <GlobeIcon className="h-3.5 w-3.5" />
                {computerUseLoaded ? <ComputerUseActivityDot /> : null}{" "}
              </span>
            </button>{" "}
            <button
              type="button"
              onClick={onToggleCanvas}
              aria-pressed={canvasEnabled}
              title={
                canvasEnabled
                  ? "Canvas: ON — shared scratchboard tools loaded; model reads/writes the canvas"
                  : "Canvas: OFF — click to share a scratchboard with the model (notes, plans, links, state)"
              }
              className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${canvasEnabled ? "text-(--accent)/70 hover:text-(--accent)" : "text-(--dim)/75 hover:text-(--fg)/80"}`}
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>{" "}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {modelSelector}{" "}
              {running ? (
                <>
                  {" "}
                  {activeTab?.status === "starting" ? (
                    <span
                      className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1.5 px-2 text-[11px] text-(--dim)"
                      title="Waiting for the model to start"
                    >
                      {" "}
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Starting…{" "}
                    </span>
                  ) : activeTab?.input.trim() ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void queueMessage()}
                        className="inline-flex !h-7 !min-h-7 shrink-0 items-center px-1.5 text-[11px] text-(--dim) underline-offset-2 hover:text-(--fg) hover:underline"
                        title="Queue (Tab)"
                      >
                        {" "}
                        Queue
                      </button>{" "}
                      <button
                        type="submit"
                        className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1 rounded-md bg-(--accent)/10 px-2 text-[11px] text-(--accent)/75 hover:bg-(--accent)/15 hover:text-(--fg)/85"
                        title="Steer (Enter): interrupt current turn and send"
                      >
                        <SendIcon className="h-3 w-3" /> Steer{" "}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void abortTurn()}
                    disabled={activeTab?.status === "starting"}
                    className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1 px-2 text-xs text-(--dim) hover:text-(--fg) disabled:opacity-30 disabled:hover:text-(--dim)"
                    title="Pause (Esc)"
                  >
                    {" "}
                    <StopIcon className="h-3 w-3" /> Pause
                  </button>{" "}
                </>
              ) : (
                <button
                  type="submit"
                  disabled={
                    (!activeTab?.input.trim() && attachments.length === 0) || readingAttachments
                  }
                  className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--dim)/85 hover:text-(--fg)/85 disabled:opacity-30"
                  aria-label="Send"
                  title="Send (Enter) · Queue (Tab)"
                >
                  {activeTab?.status === "starting" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SendIcon className="h-3.5 w-3.5" />
                  )}{" "}
                </button>
              )}{" "}
            </div>
          </div>{" "}
        </div>
        <div className="relative z-20 mx-auto mt-2.5 flex max-w-[var(--composer-w)] items-center gap-2 overflow-visible font-mono text-[10px] text-(--dim)">
          {" "}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <div className="min-w-0 max-w-[42%] shrink overflow-visible">
              {displayCwd ? (
                <span className="block min-w-0 truncate text-(--dim)" title={cwd}>
                  {displayCwd}{" "}
                </span>
              ) : null}{" "}
            </div>
            {gitBranch ? (
              <span className="inline-flex min-w-0 shrink items-center gap-1 text-(--dim)">
                <GitBranchIcon className="h-3 w-3 shrink-0" />{" "}
                <span className="truncate">{gitBranch}</span>
              </span>
            ) : gitSummary && !gitSummary.isRepo ? (
              <button
                type="button"
                onClick={onInitGit}
                className="inline-flex shrink-0 items-center gap-1 text-(--dim) hover:text-(--fg)"
                title="Init git"
              >
                {" "}
                <GitBranchIcon className="h-3 w-3" />
                git{" "}
              </button>
            ) : null}{" "}
            {gitSummary?.isRepo ? (
              <span className="inline-flex shrink-0 items-center gap-1">
                {" "}
                <span className="text-emerald-400">+{gitSummary.additions}</span>
                <span className="text-red-400">-{gitSummary.deletions}</span>{" "}
                {gitSummary.statusCount > 0 ? (
                  <span className="text-(--dim)">· {gitSummary.statusCount} files</span>
                ) : null}
              </span>
            ) : null}
          </div>{" "}
          <ContextReadout
            current={currentContextTokens}
            contextWindow={effectiveContextWindow}
            onClick={openComputerStatus}
          />
        </div>{" "}
      </form>
    </section>
  );
}

function ContextReadout({
  current,
  contextWindow,
  onClick,
}: {
  current: number;
  contextWindow: number;
  onClick: () => void;
}) {
  const title = `Open status · Context ${formatTokenCount(current)} / ${formatTokenCount(contextWindow)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto inline-flex shrink-0 items-center rounded-sm px-1 text-(--dim) hover:text-(--fg)/80"
      title={title}
      aria-label={title}
    >
      <span className="tabular-nums">
        {formatTokenCount(current)}/{formatTokenCount(contextWindow)}
      </span>
    </button>
  );
}

const CHAT_HEADER_MENU_CLASS =
  "absolute left-0 top-7 isolate z-[999] min-w-[160px] rounded-md border border-[#3a3a3a] bg-[#202020] p-1 text-xs text-(--fg) opacity-100 shadow-[0_12px_32px_rgba(0,0,0,0.85)]";

function ChatPaneHeader({
  title,
  pinned,
  rightPanelOpen,
  canFork,
  canClose,
  onTogglePinned,
  onRename,
  onFork,
  onClose,
  onToggleRightPanel,
}: {
  title: string;
  pinned: boolean;
  rightPanelOpen: boolean;
  canFork: boolean;
  canClose: boolean;
  onTogglePinned: () => void;
  onRename: (title: string) => void;
  onFork?: () => void;
  onClose?: () => void;
  onToggleRightPanel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const RightPanelIcon = rightPanelOpen ? PanelRightClose : PanelRightOpen;
  const startRename = () => {
    setDraftTitle(title);
    setRenaming(true);
    setOpen(false);
  };
  const finishRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(trimmed);
    setRenaming(false);
  };
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border) px-2 text-xs">
      <div ref={ref} className="relative flex min-w-0 flex-1 items-center gap-1.5">
        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename();
              if (event.key === "Escape") {
                setDraftTitle(title);
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded-sm bg-(--surface) px-1.5 py-0.5 text-[12px] font-medium text-(--fg) outline-none"
            aria-label="Rename session"
          />
        ) : (
          <span className="min-w-0 truncate text-[12px] font-medium text-(--fg)" title={title}>
            {title}
          </span>
        )}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((value) => !value)}
          className={`relative z-10 -my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            open
              ? "text-(--fg) hover:bg-(--surface)"
              : "text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          }`}
          aria-label="Session settings"
          title="Session settings"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <MoreIcon className="pointer-events-none h-3.5 w-3.5" />
        </button>
        {open ? (
          <div className={CHAT_HEADER_MENU_CLASS} role="menu">
            <HeaderMenuItem onClick={startRename}>Rename</HeaderMenuItem>
            <HeaderMenuItem
              onClick={() => {
                onTogglePinned();
                setOpen(false);
              }}
            >
              {pinned ? "Unpin" : "Pin"}
            </HeaderMenuItem>
            <HeaderMenuItem
              disabled={!canFork}
              onClick={() => {
                onFork?.();
                setOpen(false);
              }}
            >
              Fork
            </HeaderMenuItem>
          </div>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {canClose ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose?.();
            }}
            className="relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            aria-label="Close pane"
            title="Close pane"
          >
            <CloseIcon className="h-3 w-3 pointer-events-none" />
          </button>
        ) : null}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onToggleRightPanel}
          aria-pressed={rightPanelOpen}
          className={`relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-md ${
            rightPanelOpen
              ? "text-(--fg) hover:bg-(--surface)"
              : "text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          }`}
          title={rightPanelOpen ? "Hide right sidebar" : "Show right sidebar"}
          aria-label={rightPanelOpen ? "Hide right sidebar" : "Show right sidebar"}
        >
          <RightPanelIcon className="pointer-events-none h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function HeaderMenuItem({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full rounded-sm px-2.5 py-1.5 text-left text-xs text-(--fg) hover:bg-[#2a2a2a] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      role="menuitem"
    >
      {children}
    </button>
  );
}

function formatHomeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const homeMatch = normalized.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (homeMatch) return `~${homeMatch[1] ?? ""}`;
  return normalized;
}

function mentionRowTitle(entry: MentionRow): string {
  if (entry.kind === "file") return entry.row.rel;
  return ("displayName" in entry.row && entry.row.displayName) || entry.row.name;
}
function mentionRowVersion(entry: MentionRow): string | undefined {
  return entry.kind === "plugin" ? entry.row.version : undefined;
}
function mentionRowDescription(entry: MentionRow): string | undefined {
  if (entry.kind === "file") return entry.row.path;
  if (entry.kind === "plugin") return entry.row.shortDescription;
  if (entry.kind === "promptTemplate") return entry.row.description;
  return undefined;
}
function LoadedContextTab({
  prefix,
  label,
  title,
  active,
  onRemove,
}: {
  prefix: "@" | "$" | "/" | "/+" | "/-";
  label: string;
  title?: string;
  active?: boolean;
  onRemove: () => void;
}) {
  const meta = LOADED_TAB_META[prefix];
  return (
    <span
      className={`inline-flex max-w-[240px] items-center gap-1.5 rounded border px-2 py-1 text-[11px] shadow-sm shadow-black/5 ${meta.classes}`}
      title={title ?? label}
    >
      <meta.Icon className="h-3 w-3 shrink-0" />
      {active ? <ComputerUseActivityDot inline /> : null}
      <span className="truncate text-(--fg)">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="-mr-1 ml-0.5 rounded p-0.5 text-(--dim) hover:bg-black/10 hover:text-(--fg)"
        aria-label={`Unload ${prefix}${label}`}
        title={`Unload ${prefix}${label}`}
      >
        <CloseIcon className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

const LOADED_TAB_META: Record<
  "@" | "$" | "/" | "/+" | "/-",
  { Icon: typeof AtSign; classes: string }
> = {
  "@": {
    Icon: AtSign,
    classes: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  $: {
    Icon: Sparkles,
    classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  "/": {
    Icon: Slash,
    classes: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  "/+": {
    Icon: Plug,
    classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  "/-": {
    Icon: Plug,
    classes: "border-red-500/30 bg-red-500/10 text-red-300",
  },
};

const MENTION_KIND_META: Record<
  "plugin" | "skill" | "promptTemplate" | "extension",
  {
    title: string;
    hint: string;
    Icon: typeof AtSign;
    accentClass: string;
  }
> = {
  plugin: {
    title: "Plugins & files",
    hint: "Type to filter · Enter to attach",
    Icon: AtSign,
    accentClass: "text-sky-300",
  },
  skill: {
    title: "Skills",
    hint: "Pick a skill to instruct the agent",
    Icon: Sparkles,
    accentClass: "text-violet-300",
  },
  promptTemplate: {
    title: "Slash commands",
    hint: "Templates + installed Pi extensions",
    Icon: Slash,
    accentClass: "text-amber-300",
  },
  extension: {
    title: "Pi extensions",
    hint: "Click ON/OFF to override for this turn",
    Icon: Plug,
    accentClass: "text-emerald-300",
  },
};

function MentionPickerHeader({
  kind,
  query,
  onOpenPlugins,
}: {
  kind: "plugin" | "skill" | "promptTemplate" | "extension";
  query: string;
  onOpenPlugins: () => void;
}) {
  const meta = MENTION_KIND_META[kind];
  return (
    <div className="mb-1.5 flex items-center gap-2 border-b border-(--border)/60 pb-1.5 text-[11px]">
      <meta.Icon className={`h-3.5 w-3.5 ${meta.accentClass}`} />
      <span className="font-medium text-(--fg)">{meta.title}</span>
      {query ? (
        <span className="font-mono text-[10px] text-(--dim)">
          {query.length > 24 ? `${query.slice(0, 24)}…` : query}
        </span>
      ) : null}
      <span className="ml-auto truncate text-[10px] text-(--dim)">{meta.hint}</span>
      {kind === "extension" ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenPlugins}
          className="rounded border border-(--border) px-1.5 py-[1px] text-[10px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          title="Open the Pi packages panel"
        >
          Manage
        </button>
      ) : null}
    </div>
  );
}

function MentionExtensionRow({
  entry,
  active,
  onSelect,
  onPersist,
}: {
  entry: { kind: "extension"; row: ExtensionRowState };
  active: boolean;
  onSelect: () => void;
  onPersist: (next: boolean) => void;
}) {
  const effective = entry.row.effectiveEnabled;
  const persisted = entry.row.enabled;
  const turnOverride = entry.row.hasTurnOverride;
  const source =
    entry.row.source && entry.row.source !== "auto" ? entry.row.source : entry.row.path;
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover)/60 hover:text-(--fg)"
      }`}
      title={effective ? "Click to disable for this turn" : "Click to enable for this turn"}
    >
      <Plug className={`h-3.5 w-3.5 shrink-0 ${effective ? "text-emerald-300" : "text-(--dim)"}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] text-(--fg)">{entry.row.name}</span>
          <span
            className={`shrink-0 rounded px-1 py-[1px] text-[9px] font-medium uppercase tracking-wide ${
              effective ? "bg-emerald-500/20 text-emerald-300" : "bg-(--bg) text-(--dim)"
            }`}
          >
            {effective ? "On" : "Off"}
          </span>
          {turnOverride ? (
            <span
              className="shrink-0 rounded bg-(--accent)/15 px-1 py-[1px] font-mono text-[9px] uppercase tracking-wide text-(--accent)"
              title="Per-turn override"
            >
              turn
            </span>
          ) : null}
        </span>
        <span className="block truncate text-[10.5px] text-(--dim)">{source}</span>
      </span>
      <span
        role="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onPersist(!persisted);
        }}
        className="hidden shrink-0 rounded border border-(--border) px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-(--dim) hover:bg-(--hover) hover:text-(--fg) sm:inline"
        title={
          persisted
            ? "Disable persistently (writes enabled.json)"
            : "Enable persistently (writes enabled.json)"
        }
      >
        {persisted ? "Save off" : "Save on"}
      </span>
    </button>
  );
}

function MentionRowItem({
  entry,
  active,
  onSelect,
}: {
  entry: MentionRow;
  active: boolean;
  onSelect: () => void;
}) {
  // `extension` kind has its own renderer above; this only handles file /
  // plugin / skill / promptTemplate.
  const kindMeta = MENTION_KIND_META[entry.kind === "file" ? "plugin" : entry.kind];
  const Icon = entry.kind === "file" ? FileText : kindMeta.Icon;
  const accent = entry.kind === "file" ? "text-(--dim)" : kindMeta.accentClass;
  const title = mentionRowTitle(entry);
  const description = mentionRowDescription(entry);
  const version = mentionRowVersion(entry);
  const source = entry.kind !== "file" ? (entry.row.source ?? "") : "";
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover)/60 hover:text-(--fg)"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] text-(--fg)">{title}</span>
          {version ? <span className="font-mono text-[10px] text-(--dim)">{version}</span> : null}
        </span>
        {description ? (
          <span className="block truncate text-[10.5px] text-(--dim)">{description}</span>
        ) : null}
      </span>
      {source ? (
        <span
          className="hidden truncate font-mono text-[9px] uppercase tracking-wide text-(--dim) sm:inline"
          title={source}
        >
          {source}
        </span>
      ) : null}
    </button>
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
      <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-(--accent)/35" />{" "}
      <span className="relative h-1.5 w-1.5 rounded-full bg-(--accent)" />
    </span>
  );
}
