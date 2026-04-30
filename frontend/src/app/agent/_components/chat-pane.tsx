"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Plus, Send, Square, X } from "lucide-react";
import { AssistantMarkdown } from "./assistant-markdown";

export type ToolBlock = {
  kind: "tool";
  id: string;
  name: string;
  status: "running" | "done" | "error";
  text: string;
};
export type TextBlock = { kind: "text"; id: string; text: string };
export type ThinkingBlock = { kind: "thinking"; id: string; text: string };
export type AssistantBlock = TextBlock | ThinkingBlock | ToolBlock;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  blocks?: AssistantBlock[];
  timestamp?: string;
};

export type SessionTab = {
  // Stable id local to this pane, used as a React key for tabs.
  id: string;
  // Pi session UUID (null = unstarted, will be assigned by pi when the first
  // turn runs).
  piSessionId: string | null;
  // Display title — derived from the first user message of the session, or a
  // placeholder while empty.
  title: string;
  messages: ChatMessage[];
  status: string;
  error: string;
  input: string;
};

type Props = {
  paneId: string;
  // The unique runtime session id used as the PiRpcSession key on the server.
  runtimeSessionId: string;
  modelId: string;
  modelName: string | null;
  modelsLoading: boolean;
  cwd: string;
  projectName: string | null;
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
  onTabsChange: (tabs: SessionTab[]) => void;
  onActiveTabChange: (tabId: string) => void;
  onClose?: () => void;
  // External request to load and replay a session (e.g. user clicked a row in
  // the sidebar). Returns the events as a side effect via tab updates.
  registerExternalLoader?: (loader: (piSessionId: string) => void) => void;
};

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(),
  );
}

function extractToolText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const result = value as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((item) =>
      item && item.type === "text" && typeof item.text === "string" ? item.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

function appendDelta(
  blocks: AssistantBlock[],
  kind: "text" | "thinking",
  delta: string,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...blocks, { kind, id: newId(kind), text: delta }];
}

function upsertTool(
  blocks: AssistantBlock[],
  toolCallId: string,
  patch: (tool: ToolBlock) => ToolBlock,
  fallback: () => ToolBlock,
): AssistantBlock[] {
  const idx = blocks.findIndex((b) => b.kind === "tool" && b.id === toolCallId);
  if (idx === -1) return [...blocks, fallback()];
  const next = blocks.slice();
  next[idx] = patch(next[idx] as ToolBlock);
  return next;
}

export function makeFreshTab(): SessionTab {
  return {
    id: newId("tab"),
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}

export function ChatPane({
  paneId,
  runtimeSessionId,
  modelId,
  modelName,
  modelsLoading,
  cwd,
  projectName,
  browserToolEnabled,
  onToggleBrowserTool,
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onTabsChange,
  onActiveTabChange,
  onClose,
  registerExternalLoader,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isMultiline, setIsMultiline] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";

  const updateTab = useCallback(
    (tabId: string, patch: (tab: SessionTab) => SessionTab) => {
      onTabsChange(tabs.map((tab) => (tab.id === tabId ? patch(tab) : tab)));
    },
    [tabs, onTabsChange],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
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

      if (eventType === "message_update") {
        const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
        const updateType = ame?.type;
        if (updateType === "text_delta" && typeof ame?.delta === "string") {
          const delta = ame.delta;
          patchAssistant(tabId, assistantId, (msg) => ({
            ...msg,
            blocks: appendDelta(msg.blocks ?? [], "text", delta),
          }));
          return;
        }
        if (updateType === "thinking_delta" && typeof ame?.delta === "string") {
          const delta = ame.delta;
          patchAssistant(tabId, assistantId, (msg) => ({
            ...msg,
            blocks: appendDelta(msg.blocks ?? [], "thinking", delta),
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
          const text = JSON.stringify(toolCall.arguments ?? {}, null, 2);
          patchAssistant(tabId, assistantId, (msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              id,
              (existing) => ({ ...existing, text: existing.text || text }),
              () => ({ kind: "tool", id, name, status: "running", text }),
            ),
          }));
          return;
        }
      }

      if (eventType === "tool_execution_start") {
        const id = String(event.toolCallId || newId("tool"));
        const name = String(event.toolName || "tool");
        patchAssistant(tabId, assistantId, (msg) => ({
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
        patchAssistant(tabId, assistantId, (msg) => ({
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
              text: resultText || existing.text,
            }),
            () => ({
              kind: "tool",
              id,
              name: "tool",
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : "running",
              text: resultText,
            }),
          ),
        }));
      }
    },
    [patchAssistant],
  );

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      if (!text || !modelId || running) return;

      const tabId = activeTab.id;
      const userId = newId("user");
      const assistantId = newId("assistant");
      const userText = text;

      // Optimistic update: show the user's turn + a blank assistant message.
      onTabsChange(
        tabs.map((tab) =>
          tab.id !== tabId
            ? tab
            : {
                ...tab,
                input: "",
                error: "",
                status: "starting",
                title:
                  tab.messages.filter((m) => m.role === "user").length === 0
                    ? userText.slice(0, 40)
                    : tab.title,
                messages: [
                  ...tab.messages,
                  { id: userId, role: "user", text: userText, timestamp: nowLabel() },
                  {
                    id: assistantId,
                    role: "assistant",
                    text: "",
                    blocks: [],
                    timestamp: nowLabel(),
                  },
                ],
              },
        ),
      );
      setIsMultiline(false);
      if (textareaRef.current) textareaRef.current.style.height = "";

      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: runtimeSessionId,
            modelId,
            message: userText,
            cwd: cwd.trim() || undefined,
            piSessionId: activeTab.piSessionId,
            browserToolEnabled,
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
            const payload = JSON.parse(line.slice(6)) as
              | { type: "status"; phase: string }
              | { type: "error"; error: string }
              | { type: "pi"; event: Record<string, unknown> };
            if (payload.type === "status") {
              const phase = payload.phase;
              updateTab(tabId, (tab) => ({ ...tab, status: phase === "done" ? "idle" : phase }));
            } else if (payload.type === "error") {
              updateTab(tabId, (tab) => ({ ...tab, error: payload.error, status: "idle" }));
            } else if (payload.type === "pi") {
              const piEvent = payload.event;
              const eventId = piEvent.id;
              if (piEvent.type === "session" && typeof eventId === "string") {
                updateTab(tabId, (tab) => ({ ...tab, piSessionId: eventId }));
                onPiSessionIdChange?.(eventId);
              }
              applyPiEvent(tabId, assistantId, piEvent);
            }
          }
        }
      } catch (err) {
        updateTab(tabId, (tab) => ({
          ...tab,
          error: err instanceof Error ? err.message : "Agent request failed",
          status: "idle",
        }));
      } finally {
        updateTab(tabId, (tab) => ({ ...tab, status: "idle" }));
      }
    },
    [
      activeTab,
      modelId,
      running,
      tabs,
      onTabsChange,
      runtimeSessionId,
      cwd,
      browserToolEnabled,
      onPiSessionIdChange,
      applyPiEvent,
      updateTab,
    ],
  );

  const abortTurn = useCallback(async () => {
    if (!activeTab) return;
    const tabId = activeTab.id;
    await fetch("/api/agent/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: runtimeSessionId }),
    }).catch(() => undefined);
    updateTab(tabId, (tab) => ({ ...tab, status: "idle" }));
  }, [activeTab, runtimeSessionId, updateTab]);

  // Replay a past pi session into the active tab.
  const loadAndReplay = useCallback(
    async (piSessionId: string) => {
      if (!cwd) return;
      if (!activeTab) return;
      const tabId = activeTab.id;
      updateTab(tabId, (tab) => ({ ...tab, status: "loading", error: "" }));
      try {
        const response = await fetch(
          `/api/agent/sessions/${encodeURIComponent(piSessionId)}?cwd=${encodeURIComponent(cwd)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          events?: Record<string, unknown>[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Failed to load session");

        const replayed: ChatMessage[] = [];
        let pendingAssistantId: string | null = null;
        const ensureAssistant = () => {
          if (pendingAssistantId) return pendingAssistantId;
          const id = newId("assistant");
          replayed.push({ id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() });
          pendingAssistantId = id;
          return id;
        };
        const localPatch = (assistantId: string, patch: (msg: ChatMessage) => ChatMessage) => {
          const idx = replayed.findIndex((m) => m.id === assistantId);
          if (idx !== -1) replayed[idx] = patch(replayed[idx]);
        };

        let title: string | null = null;

        for (const event of payload.events ?? []) {
          const type = event.type;
          if (type === "message_end") {
            const msg = event.message as
              | { role?: string; content?: Array<{ type?: string; text?: string }> }
              | undefined;
            if (msg?.role === "user") {
              pendingAssistantId = null;
              const text = Array.isArray(msg.content)
                ? msg.content
                    .filter((p) => p?.type === "text" && typeof p.text === "string")
                    .map((p) => p.text)
                    .join("\n")
                : "";
              if (text) {
                if (!title) title = text.slice(0, 40);
                replayed.push({
                  id: newId("user"),
                  role: "user",
                  text,
                  timestamp: nowLabel(),
                });
              }
              continue;
            }
            if (msg?.role === "assistant" && pendingAssistantId) {
              pendingAssistantId = null;
              continue;
            }
          }

          const assistantId = ensureAssistant();
          const eventType = event.type;
          if (eventType === "message_update") {
            const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
            const updateType = ame?.type;
            if (updateType === "text_delta" && typeof ame?.delta === "string") {
              const delta = ame.delta;
              localPatch(assistantId, (msg) => ({
                ...msg,
                blocks: appendDelta(msg.blocks ?? [], "text", delta),
              }));
            } else if (updateType === "thinking_delta" && typeof ame?.delta === "string") {
              const delta = ame.delta;
              localPatch(assistantId, (msg) => ({
                ...msg,
                blocks: appendDelta(msg.blocks ?? [], "thinking", delta),
              }));
            } else if (updateType === "toolcall_end") {
              const toolCall = ame?.toolCall as
                | { id?: string; name?: string; arguments?: unknown }
                | undefined;
              if (toolCall) {
                const id = toolCall.id || newId("tool");
                const name = toolCall.name || "tool";
                const text = JSON.stringify(toolCall.arguments ?? {}, null, 2);
                localPatch(assistantId, (msg) => ({
                  ...msg,
                  blocks: upsertTool(
                    msg.blocks ?? [],
                    id,
                    (existing) => ({ ...existing, text: existing.text || text }),
                    () => ({ kind: "tool", id, name, status: "running", text }),
                  ),
                }));
              }
            }
          } else if (eventType === "tool_execution_start") {
            const id = String(event.toolCallId || newId("tool"));
            const name = String(event.toolName || "tool");
            localPatch(assistantId, (msg) => ({
              ...msg,
              blocks: upsertTool(
                msg.blocks ?? [],
                id,
                (existing) => existing,
                () => ({ kind: "tool", id, name, status: "running", text: "" }),
              ),
            }));
          } else if (eventType === "tool_execution_update" || eventType === "tool_execution_end") {
            const id = String(event.toolCallId || "");
            if (id) {
              const resultText = extractToolText(event.partialResult || event.result);
              localPatch(assistantId, (msg) => ({
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
                    text: resultText || existing.text,
                  }),
                  () => ({
                    kind: "tool",
                    id,
                    name: "tool",
                    status:
                      eventType === "tool_execution_end"
                        ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                        : "running",
                    text: resultText,
                  }),
                ),
              }));
            }
          }
        }

        updateTab(tabId, (tab) => ({
          ...tab,
          messages: replayed,
          piSessionId,
          title: title ?? tab.title,
          status: "idle",
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
    [cwd, activeTab, updateTab],
  );

  // Expose loader to the parent so the sessions sidebar can call it on click.
  useEffect(() => {
    registerExternalLoader?.(loadAndReplay);
  }, [registerExternalLoader, loadAndReplay]);

  const newTab = useCallback(() => {
    const tab = makeFreshTab();
    onTabsChange([...tabs, tab]);
    onActiveTabChange(tab.id);
  }, [tabs, onTabsChange, onActiveTabChange]);

  const closeTab = useCallback(
    (tabId: string) => {
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      if (remaining.length === 0) {
        // Closing the last tab closes the whole pane (parent handles layout
        // collapse). Replace with a fresh empty tab so the pane is never
        // tabless mid-render.
        const fresh = makeFreshTab();
        onTabsChange([fresh]);
        onActiveTabChange(fresh.id);
        onClose?.();
        return;
      }
      onTabsChange(remaining);
      if (activeTabId === tabId) {
        onActiveTabChange(remaining[remaining.length - 1].id);
      }
    },
    [tabs, activeTabId, onTabsChange, onActiveTabChange, onClose],
  );

  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className={`flex min-w-0 min-h-0 flex-1 flex-col bg-(--bg) ${
        isFocused ? "" : "opacity-95"
      }`}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-(--border) bg-(--surface) px-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <TabPill
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              onSelect={() => onActiveTabChange(tab.id)}
              onClose={() => closeTab(tab.id)}
            />
          ))}
          <button
            type="button"
            onClick={newTab}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
            title="New tab in this pane"
            aria-label="New tab in this pane"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {activeTab?.error ? (
        <div className="border-b border-(--border) bg-(--err)/10 px-4 py-2 text-xs text-(--err)">
          {activeTab.error}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-3xl">
          {activeTab && activeTab.messages.length === 0 && !running ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center text-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-(--fg)">
                What should we work on{projectName ? ` in ${projectName}` : ""}?
              </h1>
              <p className="text-xs text-(--dim)">
                Ask the agent to edit, inspect, or run something.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {(activeTab?.messages ?? [])
                .filter((m) => m.role !== "system")
                .map((message) => (
                  <TimelineMessage key={message.id} message={message} />
                ))}
              {running ? (
                <div className="flex items-center gap-2 text-xs text-(--dim)">
                  <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-(--dim)" />
                  <span>Pi is {activeTab?.status}…</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={sendMessage}
        className="shrink-0 border-t border-(--border) bg-(--bg) px-6 py-4"
      >
        <div
          className={`mx-auto max-w-3xl rounded-xl border bg-(--surface) ${
            isMultiline ? "border-(--accent)/40 ring-1 ring-(--accent)/15" : "border-(--border)"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={activeTab?.input ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              if (!activeTab) return;
              updateTab(activeTab.id, (tab) => ({ ...tab, input: value }));
              const element = event.currentTarget;
              if (!value) {
                element.style.height = "";
                setIsMultiline(false);
                return;
              }
              element.style.height = "auto";
              element.style.height = `${element.scrollHeight}px`;
              setIsMultiline(element.scrollHeight > 44);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              modelName
                ? `Ask ${modelName}…`
                : modelsLoading
                  ? "Loading models…"
                  : "No models available — check /v1/models"
            }
            className="min-h-[40px] max-h-[240px] w-full resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-6 text-(--fg) outline-none placeholder:text-(--dim)"
          />
          <div className="flex items-center gap-2 border-t border-(--border) px-2 py-1.5">
            <button
              type="button"
              onClick={onToggleBrowserTool}
              aria-pressed={browserToolEnabled}
              title={browserToolEnabled ? "Browser tool: ON — agent can drive the browser" : "Browser tool: OFF — click to let the agent navigate, click, fill, and read pages"}
              className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
                browserToolEnabled
                  ? "border-(--accent) bg-(--accent)/10 text-(--accent)"
                  : "border-transparent text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
            </button>
            <div className="flex-1" />
            {running ? (
              <button
                type="button"
                onClick={() => void abortTurn()}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-(--border) bg-(--bg) px-2 text-xs text-(--dim) hover:text-(--fg)"
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!activeTab?.input.trim() || !modelId}
                className="inline-flex h-7 items-center gap-1.5 rounded bg-(--fg) px-2.5 text-xs font-medium text-(--bg) disabled:opacity-30"
              >
                <Send className="h-3 w-3" /> Send
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

function TabPill({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: SessionTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      title={tab.title}
      className={`group flex h-7 max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs ${
        active
          ? "border-(--border) bg-(--bg) text-(--fg)"
          : "border-transparent text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
      }`}
    >
      <span className="truncate">{tab.title}</span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--surface) hover:text-(--fg) group-hover:opacity-100"
        aria-label="Close tab"
        title="Close tab"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function TimelineMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <article className="flex flex-col gap-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-(--dim)">You</div>
        <div className="whitespace-pre-wrap break-words text-sm leading-6 text-(--fg)">
          {message.text}
        </div>
      </article>
    );
  }
  const blocks = message.blocks ?? [];
  return (
    <article className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-(--dim)">Pi</div>
      {blocks.length === 0 ? (
        <div className="text-sm leading-6 text-(--dim)">…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {blocks.map((block) => {
            if (block.kind === "thinking") {
              return (
                <details key={block.id} className="text-xs">
                  <summary className="cursor-pointer list-none text-[11px] italic text-(--dim) hover:text-(--fg)">
                    Show thinking
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap border-l-2 border-(--border) pl-3 font-mono text-[11px] leading-5 text-(--dim)">
                    {block.text}
                  </pre>
                </details>
              );
            }
            if (block.kind === "text") {
              return <AssistantMarkdown key={block.id} text={block.text} />;
            }
            return (
              <details
                key={block.id}
                className="rounded border border-(--border)"
                open={block.status === "running"}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-[11px] text-(--dim) hover:text-(--fg)">
                  <span className="font-mono font-medium">{block.name}</span>
                  <span className="opacity-70">· {block.status}</span>
                </summary>
                {block.text ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap border-t border-(--border) p-2 font-mono text-[11px] leading-5 text-(--fg)">
                    {block.text}
                  </pre>
                ) : null}
              </details>
            );
          })}
        </div>
      )}
    </article>
  );
}
