"use client";

import { useCallback, useState } from "react";
import {
  Activity,
  Code2,
  FolderTree,
  GitBranch,
  Globe2,
  MessageSquarePlus,
  PanelRight,
  Plug,
  Plus,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { CloseIcon } from "@/components/icons";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { useTools } from "@/lib/agent/tools/context";
import type { ComputerTab } from "@/lib/agent/tools/types";
import type { Project } from "@/lib/agent/projects/types";
import type { Session } from "@/lib/agent/sessions/types";
import { makeFreshTab, newRuntimeId } from "@/lib/agent/session/helpers";
import type { AgentModel } from "@/lib/agent/workspace/types";
import { AgentBrowser, type AgentBrowserHandle } from "./agent-browser";
import { ChatPane } from "./chat-pane";
import { ComputerStatusPanel } from "./computer-status-panel";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import { PluginsPanel } from "./plugins-panel";
import { TerminalPanel } from "./terminal-panel";
import type { WorkspaceHandles } from "./use-workspace";

type AgentBrowserPanelHandles = Pick<
  WorkspaceHandles,
  | "registerComputerAside"
  | "startComputerResize"
  | "registerBrowserHandle"
  | "runBrowserCommand"
  | "compactFocusedSession"
>;

type AgentBrowserPanelProps = {
  handles: AgentBrowserPanelHandles;
  activeProject: Project | null;
  focusedSession: Session | null;
  sessions: Session[];
  activeModelId: string;
  activeModel: AgentModel | null;
  gitSummary?: {
    isRepo: boolean;
    branch?: string | null;
    additions: number;
    deletions: number;
    statusCount: number;
  } | null;
};

function createSideChatSession(
  activeProject: Project | null,
  focusedSession: Session | null,
  activeModelId: string,
): Session {
  const tab = makeFreshTab();
  return {
    ...tab,
    runtimeSessionId: newRuntimeId(),
    title: "Side chat",
    cwd: activeProject?.path ?? focusedSession?.cwd,
    projectId: activeProject?.id ?? focusedSession?.projectId,
    modelId: focusedSession?.modelId ?? activeModelId,
  };
}

export function AgentBrowserPanel({
  handles,
  activeProject,
  focusedSession,
  sessions,
  activeModelId,
  activeModel,
  gitSummary,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  const [sideChatSession, setSideChatSession] = useState<Session>(() =>
    createSideChatSession(null, null, ""),
  );
  const { registerComputerAside, startComputerResize, registerBrowserHandle, runBrowserCommand } =
    handles;
  const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
  const navigateBrowser = (value: string) => {
    const next = normalizeBrowserInput(value, activeProject?.path ?? "");
    if (!next) return;
    tools.setBrowserUrl(next, next);
    void runBrowserCommand("navigate", { url: next });
  };
  const openSideChat = useCallback(() => {
    setSideChatSession((current) =>
      current.messages.length
        ? current
        : {
            ...current,
            cwd: activeProject?.path ?? focusedSession?.cwd,
            projectId: activeProject?.id ?? focusedSession?.projectId,
            modelId: current.modelId || focusedSession?.modelId || activeModelId,
          },
    );
    tools.setComputerTab("side-chat");
  }, [activeModelId, activeProject, focusedSession, tools]);
  const updateSideChatTabs = useCallback(
    (nextTabsOrUpdater: Session[] | ((tabs: Session[]) => Session[])) => {
      setSideChatSession((current) => {
        const nextTabs =
          typeof nextTabsOrUpdater === "function"
            ? nextTabsOrUpdater([current])
            : nextTabsOrUpdater;
        return nextTabs.at(-1) ?? current;
      });
    },
    [],
  );
  const renameSideChat = useCallback((tabId: string, title: string) => {
    setSideChatSession((current) => (current?.id === tabId ? { ...current, title } : current));
  }, []);
  const closeSideChat = useCallback(() => {
    setSideChatSession(createSideChatSession(activeProject ?? null, focusedSession, activeModelId));
    tools.closeComputerTab("side-chat");
  }, [activeModelId, activeProject, focusedSession, tools]);
  if (!tools.computer.open) return null;

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
      ref={registerComputerAside}
      style={{ width: `${tools.computer.width}px`, minWidth: "max(280px, 25%)", maxWidth: "65%" }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
      />
      <ComputerHeader
        tab={tools.computer.tab}
        openTabs={tools.computer.tabs}
        onSelectTab={tools.setComputerTab}
        onCloseTab={(closing) =>
          closing === "side-chat" ? closeSideChat() : tools.closeComputerTab(closing)
        }
        onShowLauncher={() => tools.setComputerTab("tools")}
      />

      {tools.computer.tab === "status" ? (
        <ComputerStatusPanel
          activeProject={activeProject}
          activeModel={activeModel}
          focusedSession={focusedSession}
          sessions={sessions}
          gitSummary={gitSummary}
          onCompactSession={handles.compactFocusedSession}
        />
      ) : tools.computer.tab === "tools" ? (
        <ComputerLauncherPanel
          activeTab={tools.computer.tab}
          onSelectTab={tools.setComputerTab}
          onStartSideChat={openSideChat}
        />
      ) : tools.computer.tab === "canvas" ? (
        <CanvasPanel />
      ) : tools.computer.tab === "side-chat" ? (
        <ChatPane
          paneId="computer-side-chat"
          runtimeSessionId={sideChatSession.runtimeSessionId}
          modelId={sideChatSession.modelId ?? focusedSession?.modelId ?? activeModelId}
          modelName={activeModel?.name ?? null}
          modelsLoading={false}
          contextWindow={activeModel?.contextWindow ?? 0}
          cwd={sideChatSession.cwd ?? activeProject?.path ?? focusedSession?.cwd ?? ""}
          projectName={activeProject?.name ?? null}
          browserToolEnabled={false}
          onToggleBrowserTool={() => tools.setComputerTab("browser")}
          canvasEnabled={false}
          onToggleCanvas={tools.toggleCanvas}
          isFocused
          onFocus={() => undefined}
          tabs={[sideChatSession]}
          activeTabId={sideChatSession.id}
          onTabsChange={updateSideChatTabs}
          onRenameSession={renameSideChat}
          onClose={closeSideChat}
          rightPanelOpen
          onToggleRightPanel={() => tools.setComputerOpen(false)}
          showHeader={false}
        />
      ) : tools.computer.tab === "browser" ? (
        <AgentBrowser
          ref={registerBrowserHandle}
          url={tools.browser.url}
          inputValue={tools.browser.input}
          onInputChange={tools.setBrowserInput}
          onNavigate={navigateBrowser}
          onLocationChange={(next) => tools.setBrowserUrl(next, next)}
          onClose={() => tools.setComputerOpen(false)}
          isElectron={isElectron}
        />
      ) : tools.computer.tab === "files" ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <FilesystemPanel cwd={activeProject?.path ?? null} />
          </div>
        </section>
      ) : tools.computer.tab === "diff" ? (
        <GitDiffPanel cwd={activeProject?.path ?? null} />
      ) : tools.computer.tab === "plugins" ? (
        <PluginsPanel />
      ) : (
        <TerminalPanel cwd={activeProject?.path ?? null} />
      )}
    </aside>
  );
}

const TAB_LABELS: Record<ComputerTab, string> = {
  status: "Status",
  tools: "Tools",
  canvas: "Canvas",
  "side-chat": "Side chat",
  browser: "Browser",
  files: "Filesystem",
  diff: "Git",
  terminal: "Terminal",
  plugins: "Plugins",
};

const TAB_OPTIONS: Array<{
  tab: ComputerTab;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    tab: "canvas",
    label: "Canvas",
    description: "Shared scratchboard for human and model",
    icon: Code2,
  },
  {
    tab: "side-chat",
    label: "Side chat",
    description: "Focused side conversation",
    icon: MessageSquarePlus,
  },
  {
    tab: "browser",
    label: "Browser",
    description: "Web, localhost, and file previews",
    icon: Globe2,
  },
  { tab: "diff", label: "Git", description: "Diffs, branch, commit, and push", icon: GitBranch },
  {
    tab: "files",
    label: "Filesystem",
    description: "Project files and rendered previews",
    icon: FolderTree,
  },
  { tab: "terminal", label: "Terminal", description: "Project shell", icon: TerminalSquare },
  {
    tab: "plugins",
    label: "Plugins",
    description: "Install and manage Pi extensions, skills, prompts, themes",
    icon: Plug,
  },
];

function ComputerHeader({
  tab,
  openTabs,
  onSelectTab,
  onCloseTab,
  onShowLauncher,
}: {
  tab: ComputerTab;
  openTabs: ComputerTab[];
  onSelectTab: (tab: ComputerTab) => void;
  onCloseTab: (tab: ComputerTab) => void;
  onShowLauncher: () => void;
}) {
  // The launcher ("tools") is reached via the Plus button, so it never
  // appears as a row entry. Status IS a real row tab again.
  const visibleTabs = openTabs.filter((openTab) => openTab !== "tools");
  const tabMeta = (candidate: ComputerTab) =>
    candidate === "status"
      ? { label: "Status", icon: Activity }
      : {
          label: TAB_LABELS[candidate],
          icon: TAB_OPTIONS.find((item) => item.tab === candidate)?.icon ?? PanelRight,
        };
  return (
    <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-(--border) px-1.5 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
        {visibleTabs.map((openTab) => {
          const meta = tabMeta(openTab);
          const Icon = meta.icon;
          const canClose = openTab !== "status";
          return (
            <div
              key={openTab}
              className={`group inline-flex h-8 min-w-0 shrink-0 items-center gap-0.5 rounded-md ${
                tab === openTab
                  ? "text-(--fg)/70 hover:bg-(--surface) hover:text-(--fg)/85"
                  : "text-(--dim)/75 hover:bg-(--surface) hover:text-(--fg)/75"
              }`}
              title={meta.label}
            >
              <button
                type="button"
                onClick={() => onSelectTab(openTab)}
                className="inline-flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-1.5 pr-1 text-left"
              >
                <Icon className="pointer-events-none h-3 w-3 shrink-0" />
                <span className="max-w-[7rem] truncate">{meta.label}</span>
              </button>
              {canClose ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(openTab);
                  }}
                  className="inline-flex h-8 w-7 items-center justify-center rounded text-(--dim)/65 hover:bg-(--hover) hover:text-(--fg)/75"
                  aria-label={`Close ${meta.label}`}
                  title={`Close ${meta.label}`}
                >
                  <CloseIcon className="pointer-events-none h-2 w-2" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onShowLauncher}
          className={`relative z-10 -my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
            tab === "tools"
              ? "text-(--fg)/70 hover:bg-(--surface) hover:text-(--fg)/85"
              : "text-(--dim)/75 hover:bg-(--surface) hover:text-(--fg)/75"
          }`}
          title="Show tools"
          aria-label="Show tools"
          aria-pressed={tab === "tools"}
        >
          <Plus className="pointer-events-none h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ComputerLauncherPanel({
  activeTab,
  onSelectTab,
  onStartSideChat,
}: {
  activeTab: ComputerTab;
  onSelectTab: (tab: ComputerTab) => void;
  onStartSideChat: () => void;
}) {
  const cards = [
    {
      key: "files",
      title: "Files",
      description: "Browse project files",
      icon: FolderTree,
      onClick: () => onSelectTab("files"),
    },
    {
      key: "side-chat",
      title: "Side chat",
      description: "Start a side conversation",
      icon: MessageSquarePlus,
      onClick: onStartSideChat,
    },
    {
      key: "browser",
      title: "Browser",
      description: "Open a website",
      icon: Globe2,
      onClick: () => onSelectTab("browser"),
    },
    {
      key: "diff",
      title: "Review",
      description: "View code changes",
      icon: GitBranch,
      onClick: () => onSelectTab("diff"),
    },
    {
      key: "terminal",
      title: "Terminal",
      description: "Start an interactive shell",
      icon: TerminalSquare,
      onClick: () => onSelectTab("terminal"),
    },
    {
      key: "plugins",
      title: "Plugins",
      description: "Install Pi extensions, skills, prompts, themes",
      icon: Plug,
      onClick: () => onSelectTab("plugins"),
    },
  ] as const;
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--bg) px-5 py-7">
      <div className="mx-auto flex max-w-[30rem] flex-col gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const selected = card.key !== "side-chat" && activeTab === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              className={`group flex min-h-24 flex-col items-center justify-center rounded-xl border px-5 py-5 text-center transition-colors ${
                selected
                  ? "border-(--border) bg-(--surface) text-(--fg)/80"
                  : "border-transparent bg-black/20 text-(--fg)/75 hover:border-(--border) hover:bg-(--surface)/70"
              }`}
            >
              <Icon className="mb-3 h-5 w-5 text-(--dim)/70 transition-colors group-hover:text-(--fg)/75" />
              <span className="text-[15px] font-semibold tracking-tight">{card.title}</span>
              <span className="mt-1.5 text-[13px] text-(--dim)">{card.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CanvasPanel() {
  const tools = useTools();
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <Code2 className="h-3.5 w-3.5 text-(--accent)/70" />
        <span className="font-medium text-(--fg)">Canvas</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-(--dim)">
          Shared scratchboard for the human and model
        </span>
        <button
          type="button"
          onClick={tools.toggleCanvas}
          className={`h-6 rounded px-2 text-[11px] ${
            tools.computer.canvasEnabled
              ? "bg-(--accent)/15 text-(--accent)/75"
              : "bg-(--surface) text-(--dim)/75 hover:text-(--fg)/75"
          }`}
        >
          {tools.computer.canvasEnabled ? "On" : "Off"}
        </button>
      </div>
      <textarea
        value={tools.computer.canvasText}
        onChange={(event) => tools.setCanvasText(event.target.value)}
        placeholder="Scratch notes, live plan, links, state, or anything the model should keep in view..."
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12px] leading-6 text-(--fg) outline-none placeholder:text-(--dim)"
        spellCheck={false}
      />
    </section>
  );
}
