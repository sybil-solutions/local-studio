"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  Code2,
  FolderTree,
  GitBranch,
  Globe2,
  MessageSquarePlus,
  PanelRight,
  Plus,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { CloseIcon } from "@/ui/icons";
import { clearPersistentTerminalOwners } from "@/hooks/agent/use-persistent-terminal-owners";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { sanitizePublicBrowserUrl } from "@/lib/sanitize-embedded-browser-url";
import { useTools } from "@/lib/agent/tools/context";
import type { ComputerTab } from "@/lib/agent/tools/types";
import type { Project } from "@/lib/agent/projects/types";
import type { Session } from "@/lib/agent/sessions/types";
import { makeFreshTab, newRuntimeId } from "@/lib/agent/session/helpers";
import type { AgentModel } from "@/lib/agent/workspace/types";
import { uniqueTerminalKeys, type TerminalOwner } from "@/lib/agent/terminal-owners";
import { ComputerTabPanel, type SideChatTabsUpdater } from "./computer-tab-panel";
import { PersistentTerminals } from "./persistent-terminals";
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

function terminalOwnerFor(
  activeProject: Project | null,
  focusedSession: Session | null,
): TerminalOwner | null {
  if (focusedSession) {
    const sessionKey = `session:${focusedSession.id}`;
    const piKey = focusedSession.piSessionId ? `pi:${focusedSession.piSessionId}` : null;
    return {
      mountKey: sessionKey,
      matchKeys: uniqueTerminalKeys([sessionKey, piKey ?? ""]),
      cwd: activeProject?.path ?? focusedSession.cwd ?? null,
    };
  }
  if (!activeProject) return null;
  const projectKey = `project:${activeProject.id}`;
  return { mountKey: projectKey, matchKeys: [projectKey], cwd: activeProject.path };
}

function closePersistedTerminalOwners() {
  const closedOwners = clearPersistentTerminalOwners();
  const terminalBridge = (
    window as unknown as {
      vllmStudioDesktop?: { terminal?: { closeOwner?: (ownerKey: string) => Promise<void> } };
    }
  ).vllmStudioDesktop?.terminal;
  for (const owner of closedOwners) void terminalBridge?.closeOwner?.(owner.mountKey);
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
  const terminalOwner = useMemo(
    () => terminalOwnerFor(activeProject, focusedSession),
    [activeProject, focusedSession],
  );
  const navigateBrowser = (value: string) => {
    const next = normalizeBrowserInput(value, activeProject?.path ?? "");
    if (!next) return;
    if (!sanitizePublicBrowserUrl(next)) {
      tools.setBrowserUrl(next, next);
    }
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
  const updateSideChatTabs = useCallback((nextTabsOrUpdater: SideChatTabsUpdater) => {
    setSideChatSession((current) => {
      const nextTabs =
        typeof nextTabsOrUpdater === "function" ? nextTabsOrUpdater([current]) : nextTabsOrUpdater;
      return nextTabs.at(-1) ?? current;
    });
  }, []);
  const renameSideChat = useCallback((tabId: string, title: string) => {
    setSideChatSession((current) => (current?.id === tabId ? { ...current, title } : current));
  }, []);
  const closeSideChat = useCallback(() => {
    setSideChatSession(createSideChatSession(activeProject ?? null, focusedSession, activeModelId));
    tools.closeComputerTab("side-chat");
  }, [activeModelId, activeProject, focusedSession, tools]);
  const closeComputerTab = useCallback(
    (closing: ComputerTab) => {
      if (closing === "side-chat") {
        closeSideChat();
        return;
      }
      if (closing === "terminal") {
        closePersistedTerminalOwners();
      }
      tools.closeComputerTab(closing);
    },
    [closeSideChat, tools],
  );
  return (
    <aside
      className={`${tools.computer.open ? "relative flex" : "hidden"} shrink-0 flex-col border-l border-(--border) bg-(--agent-bg)`}
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
        onCloseTab={closeComputerTab}
        onShowLauncher={() => tools.setComputerTab("tools")}
      />

      <ComputerTabPanel
        activeModel={activeModel}
        activeModelId={activeModelId}
        activeProject={activeProject}
        focusedSession={focusedSession}
        gitSummary={gitSummary}
        isElectron={isElectron}
        onCloseSideChat={closeSideChat}
        onCompactSession={handles.compactFocusedSession}
        onNavigateBrowser={navigateBrowser}
        onOpenSideChat={openSideChat}
        onRenameSideChat={renameSideChat}
        onUpdateSideChatTabs={updateSideChatTabs}
        registerBrowserHandle={registerBrowserHandle}
        sessions={sessions}
        sideChatSession={sideChatSession}
        tools={tools}
      />

      <PersistentTerminals
        active={tools.computer.open && tools.computer.tab === "terminal"}
        owner={terminalOwner}
      />
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
    <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-(--border) px-1.5 text-[length:var(--fs-sm)]">
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
