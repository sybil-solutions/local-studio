"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AttachIcon,
  CloseIcon,
  FileIcon,
  GitBranchIcon,
  GlobeIcon,
  SendIcon,
  StopIcon,
} from "@/components/icons";
import { safeJson } from "@/lib/agent/safe-json";
import { AssistantMarkdown } from "./assistant-markdown";

// Imperative handle exposed by ChatPane so the workspace can replay a past
// pi session into the focused pane without going through useEffect-driven
// prop plumbing. The workspace calls this directly from event/click handlers
// so the control flow is auditable in one place.
export type ChatPaneHandle = {
  loadAndReplay: (piSessionId: string) => Promise<void>;
};

export type ToolBlock = {
  kind: "tool";
  id: string;
  name: string;
  status: "running" | "done" | "error";
  // Streaming raw text of the tool-call arguments (assembled from toolcall_delta
  // events, then replaced by the canonical JSON at toolcall_end). For file-write
  // tools, this lets us live-render the file content as the model generates it.
  argsText?: string;
  // Parsed arguments JSON, set at toolcall_end if `argsText` is valid JSON.
  args?: Record<string, unknown>;
  // Tool execution output (separate from args so we can render both).
  resultText?: string;
  // Back-compat single-text field used by legacy renderers / replays.
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

export type TokenStats = {
  read: number;
  write: number;
  current: number;
};

export type QueuedMessage = {
  id: string;
  // "steer" interrupts the current turn between tool runs and the next LLM
  // call; "follow_up" waits until the agent completely finishes.
  mode: "steer" | "follow_up";
  text: string;
};

export type SessionTab = {
  // Stable id local to this pane, used as a React key for tabs.
  id: string;
  // In-memory PiRpcSession key. One per tab so tabs can run independent pi
  // processes instead of sharing a pane-level runtime.
  runtimeSessionId: string;
  // Pi session UUID (null = unstarted, will be assigned by pi when the first
  // turn runs).
  piSessionId: string | null;
  projectId?: string;
  cwd?: string;
  modelId?: string;
  // Display title — derived from the first user message of the session, or a
  // placeholder while empty.
  title: string;
  messages: ChatMessage[];
  status: string;
  error: string;
  input: string;
  tokenStats?: TokenStats;
  // Outgoing pending messages (steer + follow_up). Drawn as chips above the
  // input. Steers fire immediately; follow-ups wait for `agent_end`.
  queue?: QueuedMessage[];
};

type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  mode: "text" | "data-url" | "metadata";
  content: string;
};

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

function randomIdSegment(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${randomIdSegment(8)}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(),
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isTextLike(file: File) {
  if (file.type.startsWith("text/")) return true;
  return /\.(md|markdown|txt|json|csv|tsv|log|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|sh|sql)$/i.test(
    file.name,
  );
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function createAttachment(file: File): Promise<ChatAttachment> {
  const id = newId("file");
  if (isTextLike(file) && file.size <= 350_000) {
    return {
      id,
      name: file.name,
      type: file.type || "text/plain",
      size: file.size,
      mode: "text",
      content: await readFileAsText(file),
    };
  }
  if (file.size <= 1_500_000) {
    return {
      id,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      mode: "data-url",
      content: await readFileAsDataUrl(file),
    };
  }
  return {
    id,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    mode: "metadata",
    content: "File is too large to inline; only metadata is attached.",
  };
}

function attachmentPrompt(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return "";
  return attachments
    .map((file, index) => {
      const header = `Attachment ${index + 1}: ${file.name} (${file.type}, ${formatFileSize(file.size)})`;
      if (file.mode === "text") return `${header}\n\`\`\`\n${file.content}\n\`\`\``;
      if (file.mode === "data-url") return `${header}\nData URL:\n${file.content}`;
      return `${header}\n${file.content}`;
    })
    .join("\n\n");
}

function extractToolText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const result = value as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((item) => (item && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

function numberFromRecord(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function piSessionIdFromEvent(event: Record<string, unknown>): string | null {
  if (event.type !== "session") return null;
  for (const key of ["id", "sessionId", "session_id"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function usageFromEvent(event: Record<string, unknown>): TokenStats | null {
  if (event.type !== "message" && event.type !== "message_end") return null;
  const message = asRecord(event.message);
  if (!message || message.role !== "assistant") return null;
  const usage =
    message.usage && typeof message.usage === "object" && !Array.isArray(message.usage)
      ? (message.usage as Record<string, unknown>)
      : null;
  if (!usage) return null;
  const read = numberFromRecord(usage, ["input", "prompt_tokens", "input_tokens"]);
  const write = numberFromRecord(usage, ["output", "completion_tokens", "output_tokens"]);
  const total = numberFromRecord(usage, ["totalTokens", "total_tokens", "total"]);
  const current = total || read + write;
  if (read <= 0 && write <= 0 && current <= 0) return null;
  return { read, write, current };
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.round(tokens)));
}

type StreamingToolCallSnapshot = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
};

function contentPartAt(
  messageLike: unknown,
  contentIndex: unknown,
): Record<string, unknown> | null {
  const message = asRecord(messageLike);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return null;
  if (typeof contentIndex === "number") return asRecord(content[contentIndex]);
  for (let idx = content.length - 1; idx >= 0; idx -= 1) {
    const part = asRecord(content[idx]);
    if (part?.type === "toolCall") return part;
  }
  return null;
}

function toolCallSnapshotFromUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
  message?: unknown,
): StreamingToolCallSnapshot | null {
  if (!assistantMessageEvent) return null;
  const explicit = asRecord(assistantMessageEvent.toolCall);
  const part =
    explicit ??
    contentPartAt(assistantMessageEvent.partial, assistantMessageEvent.contentIndex) ??
    contentPartAt(message, assistantMessageEvent.contentIndex);
  const idValue = part?.id ?? assistantMessageEvent.toolCallId;
  const id = typeof idValue === "string" && idValue.trim() ? idValue.trim() : "";
  if (!id) return null;
  const nameValue = part?.name ?? assistantMessageEvent.toolName;
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : "tool";
  const args = asRecord(part?.arguments) ?? undefined;
  return { id, name, args };
}

function toolCallDeltaFromUpdate(
  assistantMessageEvent: Record<string, unknown> | undefined,
): string {
  const value = assistantMessageEvent?.delta ?? assistantMessageEvent?.argumentsDelta;
  return typeof value === "string" ? value : "";
}

function stringifyToolArgs(args: Record<string, unknown> | undefined): string | undefined {
  return args && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;
}

export function sessionTitleFromPrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 48) || "New session";
}

function messageText(
  content: string | Array<Record<string, unknown>> | undefined,
  separator = "\n",
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join(separator);
}

function blocksFromMessageContent(content: string | Array<Record<string, unknown>> | undefined) {
  if (typeof content === "string") {
    return content ? [{ kind: "text" as const, id: newId("text"), text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: AssistantBlock[] = [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      blocks.push({ kind: "text", id: newId("text"), text: part.text });
    } else if (part?.type === "thinking" && typeof part.thinking === "string") {
      blocks.push({ kind: "thinking", id: newId("thinking"), text: part.thinking });
    } else if (part?.type === "toolCall") {
      const argsText = JSON.stringify(part.arguments ?? {}, null, 2);
      const args =
        part.arguments && typeof part.arguments === "object"
          ? (part.arguments as Record<string, unknown>)
          : undefined;
      blocks.push({
        kind: "tool",
        id: typeof part.id === "string" ? part.id : newId("tool"),
        name: typeof part.name === "string" ? part.name : "tool",
        status: "running",
        argsText,
        args,
        text: argsText,
      });
    }
  }
  return blocks;
}

export function replaySessionEvents(events: Record<string, unknown>[]) {
  const replayed: ChatMessage[] = [];
  let pendingAssistantId: string | null = null;
  let title: string | null = null;

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
  const assistantWithTool = (toolCallId: string) => {
    for (let idx = replayed.length - 1; idx >= 0; idx -= 1) {
      const message = replayed[idx];
      if (
        message.role === "assistant" &&
        (message.blocks ?? []).some((block) => block.kind === "tool" && block.id === toolCallId)
      ) {
        return message.id;
      }
    }
    return null;
  };

  for (const event of events) {
    const type = event.type;
    if (type === "message" || type === "message_end") {
      const msg = event.message as
        | {
            role?: string;
            content?: string | Array<Record<string, unknown>>;
            toolCallId?: string;
            toolName?: string;
            isError?: boolean;
          }
        | undefined;
      if (msg?.role === "user") {
        pendingAssistantId = null;
        const text = messageText(msg.content);
        if (text) {
          if (!title) title = sessionTitleFromPrompt(text);
          replayed.push({ id: newId("user"), role: "user", text, timestamp: nowLabel() });
        }
        continue;
      }
      if (msg?.role === "assistant") {
        pendingAssistantId = null;
        const blocks = blocksFromMessageContent(msg.content);
        replayed.push({
          id: newId("assistant"),
          role: "assistant",
          text: blocks
            .filter((block): block is TextBlock => block.kind === "text")
            .map((block) => block.text)
            .join("\n"),
          blocks,
          timestamp: nowLabel(),
        });
        continue;
      }
      if (msg?.role === "toolResult") {
        const id = msg.toolCallId || String(event.toolCallId || "");
        if (id) {
          const resultText = messageText(msg.content);
          const assistantId = assistantWithTool(id) ?? ensureAssistant();
          localPatch(assistantId, (message) => ({
            ...message,
            blocks: upsertTool(
              message.blocks ?? [],
              id,
              (existing) => ({
                ...existing,
                status: msg.isError ? "error" : "done",
                text: resultText || existing.text,
              }),
              () => ({
                kind: "tool",
                id,
                name: msg.toolName || "tool",
                status: msg.isError ? "error" : "done",
                text: resultText,
              }),
            ),
          }));
        }
        continue;
      }
    }

    const eventType = event.type;
    if (
      eventType !== "message_update" &&
      eventType !== "tool_execution_start" &&
      eventType !== "tool_execution_update" &&
      eventType !== "tool_execution_end"
    ) {
      continue;
    }

    const assistantId = ensureAssistant();
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
      } else if (updateType === "toolcall_start") {
        const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
        if (!snapshot) continue;
        localPatch(assistantId, (msg) => ({
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
      } else if (updateType === "toolcall_delta") {
        const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
        const delta = toolCallDeltaFromUpdate(ame);
        if (!snapshot || (!delta && !snapshot.args)) continue;
        localPatch(assistantId, (msg) => ({
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
      } else if (updateType === "toolcall_end") {
        const toolCall = ame?.toolCall as
          | { id?: string; name?: string; arguments?: unknown }
          | undefined;
        if (toolCall) {
          const id = toolCall.id || newId("tool");
          const name = toolCall.name || "tool";
          const argsText = JSON.stringify(toolCall.arguments ?? {}, null, 2);
          const argsObj =
            toolCall.arguments && typeof toolCall.arguments === "object"
              ? (toolCall.arguments as Record<string, unknown>)
              : undefined;
          localPatch(assistantId, (msg) => ({
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
              resultText: resultText || existing.resultText,
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
    }
  }

  return { messages: replayed, title };
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
    runtimeSessionId: newId("rt"),
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
  onRegisterHandle,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;

  const updateTab = useCallback(
    (tabId: string, patch: (tab: SessionTab) => SessionTab) => {
      onTabsChange((currentTabs) =>
        currentTabs.map((tab) => (tab.id === tabId ? patch(tab) : tab)),
      );
    },
    [onTabsChange],
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
      const usage = usageFromEvent(event);
      if (usage) {
        updateTab(tabId, (tab) => ({ ...tab, tokenStats: usage }));
      }

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
        if (updateType === "toolcall_start") {
          const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
          if (!snapshot) return;
          patchAssistant(tabId, assistantId, (msg) => ({
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
          patchAssistant(tabId, assistantId, (msg) => ({
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
          patchAssistant(tabId, assistantId, (msg) => ({
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
    [patchAssistant],
  );

  // Send a control-mode message (steer / follow_up) without reading the SSE
  // stream — pi delivers the queued message and continues emitting events on
  // the original prompt's stream. Returns true on success.
  const sendControlMessage = useCallback(
    async (mode: "steer" | "follow_up", text: string, runtime: string): Promise<boolean> => {
      if (!text.trim() || !modelId) return false;
      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: runtime,
            modelId,
            message: text,
            cwd: cwd.trim() || undefined,
            mode,
            browserToolEnabled,
          }),
        });
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Agent request failed: ${response.status}`);
        }
        // Drain the short SSE stream so the connection closes cleanly.
        const reader = response.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        return true;
      } catch {
        return false;
      }
    },
    [modelId, cwd, browserToolEnabled],
  );

  const submitPrompt = useCallback(
    async (rawText: string) => {
      if (!activeTab) return;
      const text = rawText.trim();
      if ((!text && attachments.length === 0) || !modelId || readingAttachments) return;

      const tabId = activeTab.id;
      const userId = newId("user");
      const assistantId = newId("assistant");
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      const attachedText = attachmentPrompt(attachments);
      const attachmentSummary =
        attachments.length > 0
          ? `Attached: ${attachments.map((file) => file.name).join(", ")}`
          : "";
      const userText = text || attachmentSummary;
      const displayText = [text, attachmentSummary].filter(Boolean).join("\n\n");
      const promptText = [text, attachedText].filter(Boolean).join("\n\n");

      // Optimistic update: show the user's turn + a blank assistant message.
      updateTab(tabId, (tab) => ({
        ...tab,
        modelId: tab.modelId || modelId,
        input: "",
        error: "",
        status: "starting",
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
      try {
        const response = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: runtime,
            modelId,
            message: promptText,
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
              | { type: "status"; phase: string; piSessionId?: string | null }
              | { type: "error"; error: string }
              | { type: "pi"; event: Record<string, unknown> };
            if (payload.type === "status") {
              const phase = payload.phase;
              updateTab(tabId, (tab) => ({
                ...tab,
                piSessionId: payload.piSessionId || tab.piSessionId,
                status: phase === "done" ? "idle" : phase,
              }));
              if (payload.piSessionId) onPiSessionIdChange?.(payload.piSessionId);
            } else if (payload.type === "error") {
              updateTab(tabId, (tab) => ({ ...tab, error: payload.error, status: "idle" }));
            } else if (payload.type === "pi") {
              const piEvent = payload.event;
              const eventId = piSessionIdFromEvent(piEvent);
              if (eventId) {
                updateTab(tabId, (tab) => ({ ...tab, piSessionId: eventId }));
                onPiSessionIdChange?.(eventId);
              }
              if (piEvent.type === "agent_end") {
                agentEnded = true;
                onPiSessionIdChange?.(eventId ?? activeTab.piSessionId ?? "");
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

      // Drain queued messages once the agent finished its run.
      if (agentEnded) {
        const queued = (activeTab.queue ?? []).slice();
        if (queued.length > 0) {
          // Pop the first queued message and replay it as a fresh prompt. Any
          // remaining items stay in the queue and chain through subsequent
          // submitPrompt calls.
          const [next, ...rest] = queued;
          updateTab(tabId, (tab) => ({ ...tab, queue: rest }));
          // Schedule on the next tick so React commits the optimistic
          // update before we kick off the next prompt.
          setTimeout(() => void submitPromptRef.current?.(next.text), 0);
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
      updateTab,
    ],
  );

  // Stable ref so the queue-drain inside submitPrompt can re-enter without
  // forming a useCallback cycle.
  const submitPromptRef = useRef<(text: string) => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    submitPromptRef.current = submitPrompt;
  }, [submitPrompt]);

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      if ((!text && attachments.length === 0) || !modelId || readingAttachments) return;

      // While running, Enter sends a steering message instead of a fresh prompt.
      if (running) {
        if (!text) return;
        const ok = await sendControlMessage(
          "steer",
          text,
          activeTab.runtimeSessionId || runtimeSessionId,
        );
        if (ok) {
          updateTab(activeTab.id, (tab) => ({ ...tab, input: "" }));
        }
        return;
      }
      await submitPrompt(text);
    },
    [
      activeTab,
      attachments.length,
      modelId,
      readingAttachments,
      running,
      runtimeSessionId,
      sendControlMessage,
      submitPrompt,
      updateTab,
    ],
  );

  // Tab-key behavior: queue the current input as a follow-up. If the agent is
  // running, also fire a steer() so pi has the message in its own queue
  // (one-at-a-time). Local queue state mirrors what's pending so we can show
  // chips and drain on agent_end.
  const queueMessage = useCallback(async () => {
    if (!activeTab) return;
    const text = activeTab.input.trim();
    if (!text || !modelId) return;
    const tabId = activeTab.id;
    const runtime = activeTab.runtimeSessionId || runtimeSessionId;
    const mode: "steer" | "follow_up" = running ? "follow_up" : "follow_up";
    const queuedId = newId("queue");
    updateTab(tabId, (tab) => ({
      ...tab,
      input: "",
      queue: [...(tab.queue ?? []), { id: queuedId, mode, text }],
    }));
    if (running) {
      // Hand it to pi as a follow_up so the agent sees it after it finishes.
      void sendControlMessage(mode, text, runtime);
    }
  }, [activeTab, modelId, running, runtimeSessionId, sendControlMessage, updateTab]);

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
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !activeTab) return;
      setReadingAttachments(true);
      try {
        const next = await Promise.all(Array.from(files).map((file) => createAttachment(file)));
        setAttachments((current) => [...current, ...next]);
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
    [activeTab, updateTab],
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

        const { messages, title } = replaySessionEvents(payload.events ?? []);
        const tokenStats = [...(payload.events ?? [])]
          .reverse()
          .map(usageFromEvent)
          .find((stats): stats is TokenStats => Boolean(stats));

        updateTab(tabId, (tab) => ({
          ...tab,
          messages,
          piSessionId,
          title: title ?? tab.title,
          tokenStats: tokenStats ?? tab.tokenStats,
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
    [cwd, activeTabId, updateTab],
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

  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-(--bg)"
    >
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
        className={`min-h-0 flex-1 overflow-y-auto px-6 py-8 ${showEmptyPrompt ? "flex" : ""}`}
      >
        <div className={`mx-auto w-full max-w-3xl ${showEmptyPrompt ? "flex flex-1" : ""}`}>
          {showEmptyPrompt ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h1 className="text-xl font-semibold tracking-tight text-(--fg)">
                What should we work on{projectName ? ` in ${projectName}` : ""}?
              </h1>
              <p className="text-xs text-(--dim)">
                Ask the agent to edit, inspect, or run something.
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
                  <span>Pi is {activeTab?.status}…</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={sendMessage} className="shrink-0 bg-(--bg) px-6 pb-3 pt-1.5">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-(--border)/50 bg-(--surface)">
          {(activeTab?.queue ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-b border-(--border)/50 px-2 py-1.5">
              {(activeTab?.queue ?? []).map((item) => (
                <span
                  key={item.id}
                  className="inline-flex max-w-[260px] items-center gap-1 rounded border border-(--accent)/60 bg-(--accent)/10 px-1.5 py-0.5 text-[11px] text-(--fg)"
                  title={`Queued (${item.mode}): ${item.text}`}
                >
                  <span className="rounded border border-(--accent)/40 px-1 text-[9px] uppercase text-(--accent)">
                    {item.mode === "steer" ? "steer" : "queue"}
                  </span>
                  <span className="truncate">{item.text}</span>
                  <button
                    type="button"
                    onClick={() => removeQueued(item.id)}
                    className="rounded p-0.5 text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
                    aria-label="Remove queued message"
                    title="Remove queued message"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-b border-(--border)/50 px-2 py-1.5">
              {attachments.map((file) => (
                <span
                  key={file.id}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded border border-(--border)/70 bg-(--bg) px-1.5 py-0.5 text-[11px] text-(--dim)"
                  title={`${file.name} · ${file.type} · ${formatFileSize(file.size)}`}
                >
                  <FileIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 opacity-70">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) => current.filter((item) => item.id !== file.id))
                    }
                    className="rounded p-0.5 hover:bg-(--surface) hover:text-(--fg)"
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
              setIsMultiline(element.scrollHeight > 38);
            }}
            onKeyDown={(event) => {
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
                    : `Ask ${modelName} (Enter) · queue with Tab`
            }
            className="min-h-[34px] max-h-[160px] w-full resize-none overflow-y-auto bg-transparent px-2.5 py-1.5 text-sm leading-5 text-(--fg) outline-none placeholder:text-(--dim)"
          />
          <div className="flex items-center gap-1.5 px-2 pb-2">
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
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-(--dim) hover:bg-(--bg) hover:text-(--fg) disabled:opacity-30"
              aria-label="Attach files"
              title="Attach files"
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
              className={`inline-flex h-6 w-6 items-center justify-center rounded border ${
                browserToolEnabled
                  ? "border-(--accent) bg-(--accent)/10 text-(--accent)"
                  : "border-transparent text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
              } shrink-0`}
            >
              <GlobeIcon className="h-3.5 w-3.5" />
            </button>
            <div className="flex-1" />
            {running ? (
              <>
                {activeTab?.input.trim() ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void queueMessage()}
                      className="inline-flex h-6 items-center gap-1 rounded border border-(--border) bg-(--bg) px-2 text-[11px] text-(--dim) hover:text-(--fg)"
                      title="Queue (Tab)"
                    >
                      Queue
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-6 items-center gap-1 rounded border border-(--accent) bg-(--accent)/10 px-2 text-[11px] text-(--accent) hover:bg-(--accent)/20"
                      title="Steer (Enter): interrupt current turn and send"
                    >
                      <SendIcon className="h-3 w-3" /> Steer
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => void abortTurn()}
                  className="inline-flex h-6 items-center gap-1.5 rounded border border-(--border) bg-(--bg) px-2 text-xs text-(--dim) hover:text-(--fg)"
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
                className="inline-flex h-6 w-6 items-center justify-center rounded text-(--fg) hover:bg-(--bg) disabled:opacity-30"
                aria-label="Send"
                title="Send (Enter) · Queue (Tab)"
              >
                <SendIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex min-h-9 items-center gap-2 border-t border-(--border)/50 bg-(--bg)/45 px-2 py-1.5 text-xs">
            {projectSelector ? (
              projectSelector
            ) : cwd ? (
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--dim)">
                {cwd}
              </span>
            ) : null}
            {gitBranch ? (
              <span className="inline-flex min-w-0 shrink items-center gap-1 rounded border border-(--border) bg-(--surface) px-1.5 py-0.5 font-mono text-[10px] text-(--dim)">
                <GitBranchIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{gitBranch}</span>
              </span>
            ) : gitSummary && !gitSummary.isRepo ? (
              <button
                type="button"
                onClick={onInitGit}
                className="inline-flex shrink-0 items-center rounded border border-(--border) bg-(--surface) px-1.5 py-0.5 text-[10px] text-(--dim) hover:text-(--fg)"
              >
                Init git
              </button>
            ) : null}
            {gitSummary?.isRepo ? (
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px]">
                <span className="text-emerald-400">+{gitSummary.additions}</span>
                <span className="text-red-400">-{gitSummary.deletions}</span>
                {gitSummary.statusCount > 0 ? (
                  <span className="text-(--dim)">· {gitSummary.statusCount} files</span>
                ) : null}
              </span>
            ) : null}
            <div className="min-w-0 flex-1" />
            {modelSelector}
          </div>
        </div>
        <div className="mx-auto mt-1 flex max-w-3xl items-center justify-end gap-2 font-mono text-[10px] text-(--dim)">
          <span>R {formatTokenCount(activeTab?.tokenStats?.read ?? 0)}</span>
          <span>W {formatTokenCount(activeTab?.tokenStats?.write ?? 0)}</span>
          <span>
            {formatTokenCount(activeTab?.tokenStats?.current ?? 0)}/
            {formatTokenCount(contextWindow)}
          </span>
        </div>
      </form>
    </section>
  );
}

export function SessionTabsBar({
  paneId,
  tabs,
  activeTabId,
  onActiveTabChange,
  onTabsChange,
  onRenameTab,
}: {
  paneId: string;
  tabs: SessionTab[];
  activeTabId: string;
  onActiveTabChange: (tabId: string) => void;
  onTabsChange: (tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[])) => void;
  onRenameTab: (tabId: string, title: string) => void;
}) {
  const closeTab = useCallback(
    (tabId: string) => {
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      if (remaining.length === 0) {
        const fresh = makeFreshTab();
        onTabsChange([fresh]);
        onActiveTabChange(fresh.id);
        return;
      }
      onTabsChange(remaining);
      if (activeTabId === tabId) onActiveTabChange(remaining[remaining.length - 1].id);
    },
    [tabs, activeTabId, onTabsChange, onActiveTabChange],
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <TabPill
          key={tab.id}
          tab={tab}
          paneId={paneId}
          active={tab.id === activeTabId}
          onSelect={() => onActiveTabChange(tab.id)}
          onClose={() => closeTab(tab.id)}
          onRename={(title) => onRenameTab(tab.id, title)}
        />
      ))}
    </div>
  );
}

function TabPill({
  tab,
  paneId,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  tab: SessionTab;
  paneId: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(tab.title);

  const finishRename = useCallback(() => {
    const next = draft.trim();
    if (next) onRename(next.slice(0, 80));
    setRenaming(false);
  }, [draft, onRename]);

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={(event) => {
        if (tab.piSessionId) {
          event.dataTransfer.setData("application/x-vllm-session", tab.piSessionId);
        }
        event.dataTransfer.setData(
          "application/x-vllm-agent-session",
          JSON.stringify({
            piSessionId: tab.piSessionId,
            projectId: tab.projectId,
            cwd: tab.cwd,
            paneId,
            tabId: tab.id,
            title: tab.title,
          }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onSelect}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setDraft(tab.title);
        setRenaming(true);
      }}
      title={tab.title}
      className={`group flex h-7 max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs ${
        active
          ? "border-(--border) bg-(--bg) text-(--fg)"
          : "border-transparent text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
      }`}
    >
      {renaming ? (
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(tab.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 bg-transparent outline-none"
        />
      ) : (
        <span className="truncate">{tab.title}</span>
      )}
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
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function TimelineMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <article className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl bg-(--surface) px-3.5 py-2 text-sm leading-6 text-(--fg)">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--dim)">
            You
          </div>
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
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
      <details className="rounded border border-(--border)" open>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-[11px] text-(--dim) hover:text-(--fg)">
          <span className="font-mono font-medium text-(--fg)">{block.name}</span>
          {filePath ? (
            <span className="truncate font-mono text-[11px] text-(--accent)">{filePath}</span>
          ) : null}
          {lang ? (
            <span className="rounded border border-(--border) px-1 py-0.5 text-[9px] uppercase text-(--dim)">
              {lang}
            </span>
          ) : null}
          <span className="ml-auto opacity-70">{block.status}</span>
          {isHtml ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowPreview((value) => !value);
              }}
              className="rounded border border-(--border) px-1.5 py-0.5 text-[10px] text-(--fg) hover:bg-(--surface)"
            >
              {showPreview ? "Source" : "Preview"}
            </button>
          ) : null}
        </summary>
        {isHtml && showPreview ? (
          <iframe
            sandbox=""
            srcDoc={body}
            className="h-72 w-full border-t border-(--border) bg-white"
            title={filePath ?? "preview"}
          />
        ) : (
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-(--border) p-2 font-mono text-[11px] leading-5 text-(--fg)">
            {body}
          </pre>
        )}
        {block.resultText ? (
          <div className="border-t border-(--border) bg-(--bg)/40 px-2 py-1 font-mono text-[10px] text-(--dim)">
            {block.resultText}
          </div>
        ) : null}
      </details>
    );
  }

  // Generic fallback (shells, reads, searches, browser tools, etc.).
  const display = block.resultText || block.argsText || block.text;
  return (
    <details className="rounded border border-(--border)" open={block.status === "running"}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-[11px] text-(--dim) hover:text-(--fg)">
        <span className="font-mono font-medium">{block.name}</span>
        <span className="opacity-70">· {block.status}</span>
      </summary>
      {display ? (
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap border-t border-(--border) p-2 font-mono text-[11px] leading-5 text-(--fg)">
          {display}
        </pre>
      ) : null}
    </details>
  );
}
