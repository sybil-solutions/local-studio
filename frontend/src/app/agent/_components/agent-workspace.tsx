"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  Bot,
  ChevronDown,
  Diff,
  FolderOpen,
  GitBranch,
  Globe,
  Home,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Square,
  Terminal,
} from "lucide-react";

type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  src: string;
};

type AgentModel = {
  id: string;
  name: string;
  provider: "vllm-studio";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
};

type ToolRecord = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  text: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  tools?: ToolRecord[];
  timestamp?: string;
};

type StreamPayload =
  | { type: "status"; phase: string; [key: string]: unknown }
  | { type: "error"; error: string }
  | { type: "pi"; event: Record<string, unknown> };

const SESSION_ID = "vllm-studio-agent";
const DEFAULT_AGENT_CWD = "/Users/sero/projects/vllm-studio";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(),
  );
}

function pathLabel(value: string) {
  const clean = value.replace(/\/+$/, "");
  return clean.split("/").filter(Boolean).pop() || clean || "/";
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

export function AgentWorkspace() {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [agentCwd, setAgentCwd] = useState(DEFAULT_AGENT_CWD);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "system",
      timestamp: nowLabel(),
      text: "T3 Code shell mounted inside vLLM Studio. The only provider is Pi coding-agent, configured from the active backend /v1/models.",
    },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelFilter, setModelFilter] = useState("");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [isMultiline, setIsMultiline] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("https://duckduckgo.com");
  const [browserInput, setBrowserInput] = useState("https://duckduckgo.com");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const webviewRef = useRef<WebviewElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isElectron = typeof window !== "undefined" && /electron/i.test(navigator.userAgent);

  const activeModel = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel],
  );
  const visibleModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query));
  }, [models, modelFilter]);
  const running = status === "running" || status === "starting";
  const toolCount = messages.reduce((sum, message) => sum + (message.tools?.length || 0), 0);

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      setLoadingModels(true);
      setError("");
      try {
        const response = await fetch("/api/agent/models", { cache: "no-store" });
        const payload = (await response.json()) as { models?: AgentModel[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Failed to load models");
        if (cancelled) return;
        const nextModels = payload.models ?? [];
        setModels(nextModels);
        setSelectedModel((current) => current || nextModels[0]?.id || "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load models");
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status]);

  function patchAssistant(id: string, patch: (message: ChatMessage) => ChatMessage) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? patch(message) : message)),
    );
  }

  function applyPiEvent(assistantId: string, event: Record<string, unknown>) {
    const eventType = event.type;
    if (eventType === "message_update") {
      const assistantMessageEvent = event.assistantMessageEvent as
        | Record<string, unknown>
        | undefined;
      const updateType = assistantMessageEvent?.type;
      if (updateType === "text_delta" && typeof assistantMessageEvent?.delta === "string") {
        const delta = assistantMessageEvent.delta;
        patchAssistant(assistantId, (message) => ({ ...message, text: message.text + delta }));
      }
      if (updateType === "thinking_delta" && typeof assistantMessageEvent?.delta === "string") {
        const delta = assistantMessageEvent.delta;
        patchAssistant(assistantId, (message) => ({
          ...message,
          thinking: (message.thinking || "") + delta,
        }));
      }
      if (updateType === "toolcall_end") {
        const toolCall = assistantMessageEvent?.toolCall as
          | { id?: string; name?: string; arguments?: unknown }
          | undefined;
        if (toolCall?.id) {
          patchAssistant(assistantId, (message) => ({
            ...message,
            tools: [
              ...(message.tools || []),
              {
                id: toolCall.id || newId("tool"),
                name: toolCall.name || "tool",
                status: "running",
                text: JSON.stringify(toolCall.arguments ?? {}, null, 2),
              },
            ],
          }));
        }
      }
    }

    if (eventType === "tool_execution_start") {
      const toolCallId = String(event.toolCallId || newId("tool"));
      const toolName = String(event.toolName || "tool");
      patchAssistant(assistantId, (message) => {
        const existing = message.tools || [];
        if (existing.some((tool) => tool.id === toolCallId)) return message;
        return {
          ...message,
          tools: [...existing, { id: toolCallId, name: toolName, status: "running", text: "" }],
        };
      });
    }

    if (eventType === "tool_execution_update" || eventType === "tool_execution_end") {
      const toolCallId = String(event.toolCallId || "");
      const resultText = extractToolText(event.partialResult || event.result);
      patchAssistant(assistantId, (message) => ({
        ...message,
        tools: (message.tools || []).map((tool) =>
          tool.id === toolCallId
            ? {
                ...tool,
                status:
                  eventType === "tool_execution_end"
                    ? ((event.isError ? "error" : "done") as ToolRecord["status"])
                    : tool.status,
                text: resultText || tool.text,
              }
            : tool,
        ),
      }));
    }

    if (eventType === "message_end") {
      const ended = event.message as
        | {
            role?: string;
            content?: Array<{ type?: string; text?: string; thinking?: string }>;
            errorMessage?: string;
          }
        | undefined;
      if (ended?.role === "assistant") {
        const finalText = Array.isArray(ended.content)
          ? ended.content
              .map((item) =>
                item.type === "text" && typeof item.text === "string" ? item.text : "",
              )
              .filter(Boolean)
              .join("\n")
          : "";
        const finalThinking = Array.isArray(ended.content)
          ? ended.content
              .map((item) =>
                item.type === "thinking" && typeof item.thinking === "string" ? item.thinking : "",
              )
              .filter(Boolean)
              .join("\n")
          : "";
        patchAssistant(assistantId, (message) => ({
          ...message,
          text: message.text || finalText || ended.errorMessage || message.text,
          thinking: message.thinking || finalThinking || message.thinking,
        }));
      }
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !selectedModel || running) return;

    const userId = newId("user");
    const assistantId = newId("assistant");
    setInput("");
    setIsMultiline(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "";
    }
    setError("");
    setStatus("starting");
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", text, timestamp: nowLabel() },
      { id: assistantId, role: "assistant", text: "", tools: [], timestamp: nowLabel() },
    ]);

    try {
      const response = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: SESSION_ID,
          modelId: selectedModel,
          message: text,
          cwd: agentCwd,
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
          const payload = JSON.parse(line.slice(6)) as StreamPayload;
          if (payload.type === "status")
            setStatus(payload.phase === "done" ? "idle" : payload.phase);
          if (payload.type === "error") {
            setError(payload.error);
            setStatus("idle");
          }
          if (payload.type === "pi") applyPiEvent(assistantId, payload.event);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent request failed");
    } finally {
      setStatus("idle");
    }
  }

  async function abortTurn() {
    await fetch("/api/agent/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID }),
    }).catch(() => undefined);
    setStatus("idle");
  }

  function normalizeBrowserInput(raw: string): string {
    const value = raw.trim();
    if (!value) return "https://duckduckgo.com";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(value) || /^localhost(:\d+)?/i.test(value)) {
      return `https://${value}`;
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  }

  function submitBrowserUrl(event: FormEvent) {
    event.preventDefault();
    const next = normalizeBrowserInput(browserInput);
    setBrowserInput(next);
    setBrowserUrl(next);
  }

  function browserBack() {
    if (isElectron && webviewRef.current) {
      webviewRef.current.goBack();
    }
  }

  function browserForward() {
    if (isElectron && webviewRef.current) {
      webviewRef.current.goForward();
    }
  }

  function browserReload() {
    if (isElectron && webviewRef.current) {
      webviewRef.current.reload();
      return;
    }
    if (iframeRef.current) {
      try {
        iframeRef.current.contentWindow?.location.reload();
      } catch {
        // Cross-origin reload via src reset
        const current = iframeRef.current.src;
        iframeRef.current.src = current;
      }
    }
  }

  function newThread() {
    setMessages([
      {
        id: newId("system"),
        role: "system",
        timestamp: nowLabel(),
        text: "New Pi agent thread. The Project directory field is applied to each Pi turn; models are still sourced from /v1/models.",
      },
    ]);
    setInput("");
    setIsMultiline(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "";
    }
    setError("");
  }

  return (
    <div className="agent-shell flex h-[100dvh] min-h-0 bg-[var(--agent-bg)] text-[var(--agent-fg)]">
      <aside className="flex w-[288px] shrink-0 flex-col border-r border-[var(--agent-border)] bg-[var(--agent-card)]">
        <div className="flex h-12 items-center gap-2 border-b border-[var(--agent-border)] px-3">
          <div className="flex size-7 items-center justify-center rounded-md border border-[var(--agent-border)] bg-[var(--agent-bg)]">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">T3 Code</div>
            <div className="truncate text-[11px] text-[var(--agent-muted)]">
              Pi provider / vLLM Studio
            </div>
          </div>
          <Link
            href="/"
            className="flex size-7 items-center justify-center rounded-md text-[var(--agent-muted)] hover:bg-[var(--agent-muted-bg)] hover:text-[var(--agent-fg)]"
            title="Back to vLLM Studio"
          >
            <Home className="size-4" />
          </Link>
        </div>

        <div className="space-y-2 border-b border-[var(--agent-border)] p-3">
          <button
            type="button"
            onClick={newThread}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-[var(--agent-primary)] px-3 text-sm font-medium text-white hover:opacity-95"
          >
            <Plus className="size-4" /> New thread
          </button>
          <label className="flex h-8 items-center gap-2 rounded-md border border-[var(--agent-border)] bg-[var(--agent-bg)] px-2 text-[var(--agent-muted)]">
            <Search className="size-3.5" />
            <input
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              placeholder="Search models"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--agent-fg)] outline-none placeholder:text-[var(--agent-muted)]"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <SectionLabel>Project</SectionLabel>
          <ThreadRow active title={pathLabel(agentCwd)} subtitle={agentCwd} icon={GitBranch} />
          <label className="mb-3 mt-2 flex items-center gap-2 rounded-md border border-[var(--agent-border)] bg-[var(--agent-bg)] px-2 py-1.5 text-[var(--agent-muted)]">
            <FolderOpen className="size-3.5 shrink-0" />
            <input
              value={agentCwd}
              onChange={(event) => setAgentCwd(event.target.value)}
              disabled={running}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[var(--agent-fg)] outline-none disabled:opacity-60"
              aria-label="Agent working directory"
            />
          </label>
          <SectionLabel className="mt-4">Threads</SectionLabel>
          <ThreadRow
            active
            title="Pi agent thread"
            subtitle={`${messages.length} messages · ${toolCount} tools`}
            icon={MessageSquare}
          />
          <ThreadRow title="Archived plans" subtitle="No synced history yet" icon={Archive} muted />
        </div>

        <div className="border-t border-[var(--agent-border)] p-3 text-xs text-[var(--agent-muted)]">
          <div className="mb-2 flex items-center justify-between">
            <span>Provider</span>
            <span className="rounded bg-[var(--agent-muted-bg)] px-1.5 py-0.5">Pi</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Models</span>
            <span>{loadingModels ? "loading" : models.length}</span>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--agent-border)] bg-[var(--agent-bg)] px-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-medium">Pi agent thread</h1>
              <span className="rounded-md border border-[var(--agent-border)] px-1.5 py-0.5 text-[11px] text-[var(--agent-muted)]">
                vLLM Studio
              </span>
              {activeModel?.reasoning ? (
                <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-700">
                  thinking
                </span>
              ) : null}
            </div>
          </div>

          <button className="agent-toolbar-button" type="button" title="Terminal drawer">
            <Terminal className="size-3.5" /> Terminal
          </button>
          <button
            className="agent-toolbar-button"
            type="button"
            onClick={() => setRightPanelOpen((value) => !value)}
            title="Diff panel"
          >
            <Diff className="size-3.5" /> Diff
          </button>
          <button className="agent-toolbar-icon" type="button" title="Settings">
            <Settings className="size-4" />
          </button>
        </header>

        {error ? (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
              <div className="mx-auto w-full max-w-3xl space-y-5">
                {messages
                  .filter((message) => message.role !== "system")
                  .map((message) => (
                    <TimelineMessage key={message.id} message={message} />
                  ))}
                {running ? <WorkingRow status={status} /> : null}
              </div>
            </div>

            <form
              onSubmit={sendMessage}
              className="shrink-0 border-t border-[var(--agent-border)] bg-[var(--agent-bg)] px-4 py-3"
            >
              <div
                className={`mx-auto max-w-3xl rounded-xl border bg-[var(--agent-card)] shadow-sm ${
                  isMultiline
                    ? "border-[var(--agent-primary)]/50 ring-1 ring-[var(--agent-primary)]/40"
                    : "border-[var(--agent-border)]"
                }`}
              >
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => {
                    const value = event.target.value;
                    setInput(value);
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
                    activeModel
                      ? `Ask ${activeModel.name} to edit, inspect, or run commands...`
                      : "Load a /v1/models entry first..."
                  }
                  className="min-h-[40px] max-h-[240px] w-full resize-none overflow-y-auto rounded-t-xl bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-[var(--agent-muted)]"
                />
                <div className="flex items-center gap-2 border-t border-[var(--agent-border)] px-2 py-2">
                  <select
                    className="h-8 max-w-[260px] rounded-md border border-[var(--agent-border)] bg-[var(--agent-bg)] px-2 text-xs outline-none"
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                    disabled={loadingModels || running}
                  >
                    {visibleModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => void abortTurn()}
                    disabled={!running}
                    className="agent-compose-button disabled:opacity-40"
                  >
                    <Square className="size-3.5" /> Stop
                  </button>
                  <button
                    type="submit"
                    disabled={!input.trim() || !selectedModel || running}
                    className="flex h-8 items-center gap-2 rounded-md bg-[var(--agent-primary)] px-3 text-sm font-medium text-white disabled:opacity-40"
                  >
                    <Send className="size-3.5" /> Send
                  </button>
                </div>
              </div>
            </form>
          </section>

          {rightPanelOpen ? (
            <aside className="hidden w-[480px] shrink-0 border-l border-[var(--agent-border)] bg-[var(--agent-card)] xl:flex xl:flex-col">
              <div className="flex h-12 items-center justify-between border-b border-[var(--agent-border)] px-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="size-4" /> Browser
                </div>
                <button
                  className="agent-toolbar-icon"
                  type="button"
                  onClick={() => setRightPanelOpen(false)}
                >
                  <ChevronDown className="size-4 rotate-[-90deg]" />
                </button>
              </div>
              <form
                onSubmit={submitBrowserUrl}
                className="flex shrink-0 items-center gap-1 border-b border-[var(--agent-border)] bg-[var(--agent-bg)] px-2 py-2"
              >
                <button
                  type="button"
                  onClick={browserBack}
                  className="agent-toolbar-icon"
                  title="Back"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={browserForward}
                  className="agent-toolbar-icon"
                  title="Forward"
                >
                  <ArrowRight className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={browserReload}
                  className="agent-toolbar-icon"
                  title="Reload"
                >
                  <RotateCcw className="size-4" />
                </button>
                <input
                  value={browserInput}
                  onChange={(event) => setBrowserInput(event.target.value)}
                  spellCheck={false}
                  placeholder="Search or enter URL"
                  className="min-w-0 flex-1 rounded-md border border-[var(--agent-border)] bg-[var(--agent-bg)] px-2 py-1 font-mono text-[11px] text-[var(--agent-fg)] outline-none placeholder:text-[var(--agent-muted)]"
                  aria-label="Browser address"
                />
                <button
                  type="submit"
                  className="h-7 rounded-md bg-[var(--agent-primary)] px-2 text-xs font-medium text-white hover:opacity-95"
                >
                  Go
                </button>
              </form>
              <div className="min-h-0 flex-1 bg-white">
                {isElectron ? (
                  <webview
                    ref={(node) => {
                      webviewRef.current = (node as unknown as WebviewElement) ?? null;
                    }}
                    src={browserUrl}
                    allowpopups={true}
                    className="size-full"
                    style={{ width: "100%", height: "100%", display: "flex" }}
                  />
                ) : (
                  <iframe
                    ref={iframeRef}
                    src={browserUrl}
                    className="size-full"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    title="Agent browser"
                  />
                )}
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-[var(--agent-muted)] ${className}`}
    >
      {children}
    </div>
  );
}

function ThreadRow({
  title,
  subtitle,
  icon: Icon,
  active = false,
  muted = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left ${
        active ? "bg-[var(--agent-muted-bg)]" : "hover:bg-[var(--agent-muted-bg)]"
      } ${muted ? "opacity-60" : ""}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-[var(--agent-muted)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-[var(--agent-muted)]">{subtitle}</span>
      </span>
    </button>
  );
}

function TimelineMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  return (
    <article className="group grid grid-cols-[32px_1fr] gap-3">
      <div className="flex size-8 items-center justify-center rounded-full border border-[var(--agent-border)] bg-[var(--agent-card)] text-[var(--agent-muted)]">
        {isUser ? (
          <MessageSquare className="size-4" />
        ) : isSystem ? (
          <Settings className="size-4" />
        ) : (
          <Bot className="size-4" />
        )}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs text-[var(--agent-muted)]">
          <span className="font-medium text-[var(--agent-fg)]">
            {isUser ? "You" : isSystem ? "System" : "Pi"}
          </span>
          {message.timestamp ? <span>{message.timestamp}</span> : null}
        </div>
        <div className="chat-markdown whitespace-pre-wrap text-sm leading-6">
          {message.text || (!isUser && !isSystem ? "…" : "")}
        </div>
        {message.thinking ? (
          <details className="mt-3 rounded-md border border-[var(--agent-border)] bg-[var(--agent-card)] px-3 py-2 text-xs text-[var(--agent-muted)]">
            <summary className="cursor-pointer">Thinking</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-5">
              {message.thinking}
            </pre>
          </details>
        ) : null}
        {message.tools?.length ? (
          <div className="mt-3 space-y-2">
            {message.tools.map((tool) => (
              <details
                key={tool.id}
                className="rounded-md border border-[var(--agent-border)] bg-[var(--agent-card)]"
                open={tool.status === "running"}
              >
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                  <Terminal className="size-3.5 text-[var(--agent-muted)]" />
                  <span className="font-medium">{tool.name}</span>
                  <span className="text-[var(--agent-muted)]">{tool.status}</span>
                </summary>
                {tool.text ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap border-t border-[var(--agent-border)] p-3 font-mono text-[11px] leading-5">
                    {tool.text}
                  </pre>
                ) : null}
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function WorkingRow({ status }: { status: string }) {
  return (
    <div className="grid grid-cols-[32px_1fr] gap-3 text-sm text-[var(--agent-muted)]">
      <div className="flex size-8 items-center justify-center rounded-full border border-[var(--agent-border)] bg-[var(--agent-card)]">
        <Loader2 className="size-4 animate-spin" />
      </div>
      <div className="pt-1.5">Pi agent is {status}…</div>
    </div>
  );
}
