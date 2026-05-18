"use client";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
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
  AgentTurnSsePayload,
  AssistantBlock,
  asRecord,
  ChatMessage,
  ChatPaneHandle,
  EventBlock,
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
import { useTools } from "@/lib/agent/tools/context";
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
  onPiSessionIdChange?: (sessionId: string) => void;
  tabs: SessionTab[];
  activeTabId: string;
  onTabsChange: (tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[])) => void;
  onClose?: () => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const [compacting, setCompacting] = useState(false);
  const tools = useTools();
  const pluginRows = tools.pluginCatalogue;
  const skillRows = tools.skillCatalogue;
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
  const activeSelection = tools.selectionFor(activeTab?.id);
  const selectedPlugins = activeSelection.plugins;
  const selectedSkills = activeSelection.skills;
  const computerUseLoaded = selectedPlugins.some((plugin) =>
    [plugin.id, plugin.name, plugin.path].some((value) =>
      value?.toLowerCase().includes("computer-use"),
    ),
  );
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  useEffect(() => {
    setStickToBottom(true);
  }, [activeTab?.id]);
  const mentionRows = useMemo(() => {
    if (!mention) return [];
    return mention.kind === "plugin"
      ? byQuery(pluginRows, mention.query, 8)
      : byQuery(skillRows, mention.query, 8);
  }, [mention, pluginRows, skillRows]);
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
      updateTab(activeTab.id, (tab) => ({ ...tab, input }));
      const current = tools.selectionFor(activeTab.id);
      if (selectedMention.kind === "plugin") {
        if (!current.plugins.some((plugin) => plugin.id === selectedRow.id)) {
          tools.setSelection(activeTab.id, {
            plugins: [...current.plugins, activateComposerPlugin(selectedRow as ComposerPluginRef)],
            skills: current.skills,
          });
        }
      } else if (!current.skills.some((skill) => skill.id === selectedRow.id)) {
        tools.setSelection(activeTab.id, {
          plugins: current.plugins,
          skills: [...current.skills, selectedRow as ComposerSkillRef],
        });
      }
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
    [activeTab, browserToolEnabled, mention, onToggleBrowserTool, tools, updateTab],
  );
  const removeLoadedContext = useCallback(
    (kind: "plugin" | "skill", id: string) => {
      if (!activeTab) return;
      const current = tools.selectionFor(activeTab.id);
      tools.setSelection(activeTab.id, {
        plugins:
          kind === "plugin"
            ? current.plugins.filter((plugin) => plugin.id !== id)
            : current.plugins,
        skills:
          kind === "skill" ? current.skills.filter((skill) => skill.id !== id) : current.skills,
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
    onPiSessionIdChange,
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
      return { text, prompt, displayText, userText };
    },
    [attachments, tools],
  );
  const submitPrompt = useCallback(
    async (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return;
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) return;
      const args = buildPromptArgs(targetId, rawText);
      setStickToBottom(true);
      setAttachments([]);
      setIsMultiline(false);
      if (textareaRef.current) textareaRef.current.style.height = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
      await engine.submitPrompt({ ...args, targetSessionId: targetId });
    },
    [activeTab, attachments.length, buildPromptArgs, engine, modelId, readingAttachments],
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
      if (activeTab.status === "starting" || activeTab.status === "loading") return;
      const text = activeTab.input.trim();
      if ((!text && attachments.length === 0) || !modelId || readingAttachments) return;
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      const status = await engine.loadRuntimeStatus(runtime);
      const accepts = engine.acceptsControl(status, activeTab.piSessionId);
      if (running) {
        if (!text) return;
        if (!accepts) {
          updateTab(activeTab.id, (t) => ({ ...t, status: "idle", activeAssistantId: undefined }));
          await submitPrompt(text, activeTab.id);
          return;
        }
        await queueAndSendControl("steer", text, activeTab, runtime);
        return;
      }
      if (accepts) {
        await queueAndSendControl("steer", text, activeTab, runtime);
        return;
      }
      await submitPrompt(text, activeTab.id);
    },
    [
      activeTab,
      attachments.length,
      engine,
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
    if (!text || !modelId) return;
    if (!running) {
      await submitPrompt(text, activeTab.id);
      return;
    }
    const runtime = activeTab.runtimeSessionId || runtimeSessionId;
    const status = await engine.loadRuntimeStatus(runtime);
    if (!engine.acceptsControl(status, activeTab.piSessionId)) {
      updateTab(activeTab.id, (t) => ({ ...t, status: "idle", activeAssistantId: undefined }));
      await submitPrompt(text, activeTab.id);
      return;
    }
    await queueAndSendControl("follow_up", text, activeTab, runtime, cwd);
  }, [
    activeTab,
    cwd,
    engine,
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
    await engine.abortTurn(activeTab.id);
  }, [activeTab, engine]);
  const loadAndReplay = useCallback(
    async (piSessionId: string) => {
      if (!activeTabId) return;
      await engine.loadAndReplay(piSessionId, activeTabId);
    },
    [activeTabId, engine],
  );
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
    try {
      await engine.compact(activeTab.id);
    } finally {
      setCompacting(false);
    }
  }, [activeTab, compacting, engine, modelId, running]);
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--bg)"
    >
      {" "}
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
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />{" "}
        </button>
      ) : null}{" "}
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
      <form onSubmit={sendMessage} className="shrink-0 bg-(--bg) px-6 pb-2 pt-0">
        {visibleQueueItems.length > 0 ? (
          <div className="mx-auto mb-1 w-[85%] max-w-[var(--composer-w)] overflow-hidden rounded-lg bg-(--composer) px-4 py-2 text-[11px] text-(--fg)">
            <button
              type="button"
              onClick={() => setQueueExpanded((value) => !value)}
              className="flex w-full min-w-0 items-center gap-2 text-left"
              aria-expanded={queueExpanded}
              title="Queued follow-ups and steers"
            >
              {" "}
              <ChevronDownIcon
                className={`h-3 w-3 shrink-0 text-(--dim) transition-transform ${queueExpanded ? "rotate-180" : "-rotate-90"}`}
              />
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-(--dim)">
                queue {visibleQueueItems.length}
              </span>{" "}
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
          className={`mx-auto max-w-[var(--composer-w)] overflow-visible rounded-lg bg-(--composer) shadow-none transition-colors ${composerDragActive ? "outline outline-1 outline-(--accent)/50" : ""}`}
        >
          {" "}
          {composerDragActive ? (
            <div className="px-4 pt-2 text-[11px] text-(--accent)">
              Drop files to attach to the next message.
            </div>
          ) : null}
          {selectedPlugins.length + selectedSkills.length > 0 ? (
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
            </div>
          ) : null}
          {mention ? (
            <div className="px-4 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-(--dim)">
                {mention.kind === "plugin" ? "Plugins" : "Skills"}
              </div>{" "}
              {mentionRows.length ? (
                <div className="grid gap-1">
                  {" "}
                  {mentionRows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void selectMentionRow(row)}
                      className="flex min-w-0 items-start justify-between gap-3 py-1 text-left text-(--dim) hover:text-(--fg)"
                    >
                      {" "}
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] text-(--fg)">
                          {" "}
                          {mention.kind === "plugin" ? "@" : "$"}
                          {mentionRowTitle(row)}{" "}
                          {mentionRowVersion(row) ? (
                            <span className="ml-1 font-mono text-[10px] text-(--dim)">
                              {mentionRowVersion(row)}
                            </span>
                          ) : null}
                        </span>{" "}
                        {mentionRowDescription(row) ? (
                          <span className="block truncate text-[10.5px] text-(--dim)">
                            {mentionRowDescription(row)}
                          </span>
                        ) : null}
                      </span>{" "}
                      <span className="truncate font-mono text-[10px] text-(--dim)">
                        {row.source ?? ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-2 py-1 text-[11px] text-(--dim)">
                  {" "}
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
                    <img
                      src={file.content}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded object-cover"
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
                  ? "No models available — check /v1/models"
                  : running
                    ? `Steer ${modelName} (Enter) · queue with Tab · Esc to pause`
                    : `Ask ${modelName} (Enter) · queue with Tab · paste/drop files`
            }
            className="min-h-[42px] max-h-[132px] w-full resize-none overflow-y-auto bg-transparent px-4 py-2.5 text-sm leading-5 text-(--fg) outline-none placeholder:text-(--dim)"
          />
          <div className="flex min-h-10 items-center gap-1.5 bg-transparent px-3 pb-2 pt-1 text-xs">
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
              className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--dim) hover:text-(--fg) disabled:opacity-30"
              aria-label="Attach files"
              title="Attach files (or paste/drop into composer)"
            >
              {" "}
              <AttachIcon className="h-3.5 w-3.5" />
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
              className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-md ${browserToolEnabled ? "text-(--accent)" : "text-(--dim) hover:text-(--fg)"}`}
            >
              <span className="relative inline-flex">
                {" "}
                <GlobeIcon className="h-3.5 w-3.5" />
                {computerUseLoaded ? <ComputerUseActivityDot /> : null}{" "}
              </span>
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
                        className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1 rounded-md bg-(--accent)/10 px-2 text-[11px] text-(--accent) hover:bg-(--accent)/15 hover:text-(--fg)"
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
                    (!activeTab?.input.trim() && attachments.length === 0) ||
                    !modelId ||
                    readingAttachments ||
                    activeTab?.status === "starting" ||
                    activeTab?.status === "loading"
                  }
                  className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center text-(--fg) hover:text-(--accent) disabled:opacity-30"
                  aria-label="Send"
                  title="Send (Enter) · Queue (Tab)"
                >
                  {activeTab?.status === "starting" || activeTab?.status === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SendIcon className="h-3.5 w-3.5" />
                  )}{" "}
                </button>
              )}{" "}
            </div>
          </div>{" "}
        </div>
        <div className="relative z-20 mx-auto mt-0.5 flex max-w-[var(--composer-w)] items-center gap-2 overflow-visible font-mono text-[10px] text-(--dim)">
          {" "}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <button
              type="button"
              onClick={() => void compactSession()}
              disabled={running || compacting || !activeTab?.piSessionId || !modelId}
              className="inline-flex shrink-0 items-center gap-1 text-(--dim) hover:text-(--fg) disabled:pointer-events-none disabled:opacity-30"
              title="Compact this Pi session context"
            >
              {" "}
              {compacting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              compact{" "}
            </button>
            <span className="shrink-0 text-(--border)">·</span>{" "}
            <div className="min-w-0 max-w-[42%] shrink overflow-visible">
              {projectSelector ? (
                projectSelector
              ) : cwd ? (
                <span className="block min-w-0 truncate text-(--dim)" title={cwd}>
                  {cwd}{" "}
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
          <div className="flex shrink-0 items-center justify-end gap-2">
            <span>R {formatTokenCount(activeTab?.tokenStats?.read ?? 0)}</span>{" "}
            <span>W {formatTokenCount(activeTab?.tokenStats?.write ?? 0)}</span>
            <span>
              {" "}
              {formatTokenCount(activeTab?.tokenStats?.current ?? 0)}/
              {formatTokenCount(contextWindow)}
            </span>{" "}
          </div>
        </div>{" "}
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
      {" "}
      <span className="font-mono text-(--accent)">{prefix}</span>
      {active ? <ComputerUseActivityDot inline /> : null} <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 text-(--dim) hover:text-(--fg)"
        aria-label={`Unload ${prefix}${label}`}
        title={`Unload ${prefix}${label}`}
      >
        {" "}
        <CloseIcon className="h-3 w-3" />
      </button>{" "}
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
      <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-(--accent)/35" />{" "}
      <span className="relative h-1.5 w-1.5 rounded-full bg-(--accent)" />
    </span>
  );
}
