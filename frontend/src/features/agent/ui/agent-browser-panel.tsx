"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import {
  Activity,
  Code2,
  FolderTree,
  GitBranch,
  Globe2,
  ListChecks,
  MessageSquarePlus,
  PanelRight,
  Plus,
  ScanSearch,
  TerminalSquare,
  type LucideIcon,
} from "@/ui/icon-registry";
import { CloseIcon } from "@/ui/icons";
import {
  rememberPersistentTerminalOwner,
  removePersistentTerminalOwner,
  removePersistentTerminalOwners,
  selectPersistentTerminalOwner,
  usePersistentTerminalOwners,
  type TerminalOwnersSnapshot,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import {
  sanitizeBrowserPaneUrl,
  sanitizeLocalFileUrl,
} from "@/features/agent/sanitize-embedded-browser-url";
import { useTools } from "@/features/agent/tools/context";
import type { ComputerTab } from "@/features/agent/tools/types";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";
import { makeFreshTab } from "@/features/agent/messages/helpers";
import type { AgentModel } from "@/features/agent/workspace/types";
import {
  terminalOwnerFor,
  terminalOwnerLabel,
  type TerminalOwner,
} from "@/features/agent/terminal-owners";
import {
  ComputerTabPanel,
  type SideChatDraft,
  type SideChatTabsUpdater,
} from "@/features/agent/ui/computer-tab-panel";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import type { WorkspaceHandles } from "@/features/agent/ui/use-workspace";

type AgentBrowserPanelHandles = Pick<
  WorkspaceHandles,
  | "registerComputerAside"
  | "startComputerResize"
  | "compactFocusedSession"
  | "updateDetachedSession"
  | "removeDetachedSession"
>;

type AgentBrowserPanelProps = {
  handles: AgentBrowserPanelHandles;
  activeProject: Project | null;
  focusedSession: Session | null;
  sessions: Session[];
  activeModelId: string;
  activeModel: AgentModel | null;
  models: AgentModel[];
  modelsLoading: boolean;
  gitSummary?: GitSummary | null;
};

function createSideChatSession(
  activeProject: Project | null,
  focusedSession: Session | null,
  activeModelId: string,
): Session {
  const tab = makeFreshTab();
  return {
    ...tab,
    title: "Side chat",
    cwd: focusedSession?.cwd ?? activeProject?.path,
    projectId: focusedSession?.projectId ?? activeProject?.id,
    modelId: focusedSession?.modelId ?? activeModelId,
  };
}

function terminalBridge() {
  return (
    window as unknown as {
      localStudioDesktop?: { terminal?: { closeOwner?: (ownerKey: string) => Promise<void> } };
    }
  ).localStudioDesktop?.terminal;
}

function closePersistedTerminalOwners(owners: readonly TerminalOwner[]) {
  const closedOwners = removePersistentTerminalOwners(owners.map((owner) => owner.mountKey));
  const bridge = terminalBridge();
  for (const owner of closedOwners) void bridge?.closeOwner?.(owner.mountKey);
}

function closePersistedTerminalOwner(ownerKey: string) {
  const owner = removePersistentTerminalOwner(ownerKey);
  if (owner) void terminalBridge()?.closeOwner?.(owner.mountKey);
}

function acceptedBrowserUrl(url: string): string | null {
  return /^file:\/\//i.test(url) ? sanitizeLocalFileUrl(url) : sanitizeBrowserPaneUrl(url);
}

export function AgentBrowserPanel({
  handles,
  activeProject,
  focusedSession,
  sessions,
  activeModelId,
  activeModel,
  models,
  modelsLoading,
  gitSummary,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  const [sideChatSeed, setSideChatSeed] = useState<Session>(() =>
    createSideChatSession(null, null, ""),
  );
  const sideChatSession =
    sessions.find((session) => session.id === sideChatSeed.id) ?? sideChatSeed;
  const { registerComputerAside, startComputerResize } = handles;
  const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
  const terminalOwner = useMemo(
    () => terminalOwnerFor(activeProject, focusedSession),
    [activeProject, focusedSession],
  );
  const terminalState = usePersistentTerminalOwners(
    tools.computer.open && tools.computer.tab === "terminal",
    terminalOwner,
  );
  const visibleTerminalState = useMemo<TerminalOwnersSnapshot>(() => {
    const owners = terminalState.owners;
    const activeOwnerKey = owners.some((owner) => owner.mountKey === terminalState.activeOwnerKey)
      ? terminalState.activeOwnerKey
      : (owners[0]?.mountKey ?? null);
    return { owners, activeOwnerKey };
  }, [terminalState]);
  const openTerminalForFocusedSession = useCallback(() => {
    if (terminalOwner) rememberPersistentTerminalOwner(terminalOwner, { select: true });
    tools.setComputerTab("terminal");
  }, [terminalOwner, tools]);
  const selectTerminalOwner = useCallback(
    (ownerKey: string) => {
      selectPersistentTerminalOwner(ownerKey);
      tools.setComputerTab("terminal");
    },
    [tools],
  );
  const closeTerminalOwner = useCallback(
    (ownerKey: string) => {
      closePersistedTerminalOwner(ownerKey);
      if (visibleTerminalState.owners.length <= 1) tools.closeComputerTab("terminal");
    },
    [visibleTerminalState.owners.length, tools],
  );
  const handleComputerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0) return;
      const owner = visibleTerminalState.owners[index];
      if (!owner) return;
      event.preventDefault();
      selectTerminalOwner(owner.mountKey);
    },
    [selectTerminalOwner, visibleTerminalState.owners],
  );
  const navigateBrowser = (value: string) => {
    const next = normalizeBrowserInput(value, focusedSession?.cwd ?? activeProject?.path ?? "");
    if (!next) return;
    const accepted = acceptedBrowserUrl(next);
    if (!accepted) return;
    tools.setBrowserUrl(accepted, accepted);
    if (/^file:\/\//i.test(accepted)) return;
    void fetch("/api/agent/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: accepted }),
    }).catch(() => undefined);
  };
  const openSideChat = useCallback(
    (draft?: SideChatDraft) => {
      if (draft) {
        const next = createSideChatSession(activeProject ?? null, focusedSession, activeModelId);
        const drafted = {
          ...next,
          title: draft.title.trim().slice(0, 80) || "Plan task",
          input: draft.input,
        };
        setSideChatSeed(drafted);
        handles.updateDetachedSession(drafted, () => drafted);
        tools.setComputerTab("side-chat");
        return;
      }
      handles.updateDetachedSession(sideChatSeed, (current) =>
        current.messages.length
          ? current
          : {
              ...current,
              status: current.status === "loading" ? "idle" : current.status,
              cwd: focusedSession?.cwd ?? activeProject?.path,
              projectId: focusedSession?.projectId ?? activeProject?.id,
              modelId: current.modelId || focusedSession?.modelId || activeModelId,
            },
      );
      tools.setComputerTab("side-chat");
    },
    [activeModelId, activeProject, focusedSession, handles, sideChatSeed, tools],
  );
  const updateSideChatTabs = useCallback(
    (nextTabsOrUpdater: SideChatTabsUpdater) => {
      handles.updateDetachedSession(sideChatSeed, (current) => {
        const nextTabs =
          typeof nextTabsOrUpdater === "function"
            ? nextTabsOrUpdater([current])
            : nextTabsOrUpdater;
        return nextTabs.at(-1) ?? current;
      });
    },
    [handles, sideChatSeed],
  );
  const renameSideChat = useCallback(
    (tabId: string, title: string) => {
      handles.updateDetachedSession(sideChatSeed, (current) =>
        current.id === tabId ? { ...current, title } : current,
      );
    },
    [handles, sideChatSeed],
  );
  const closeSideChat = useCallback(() => {
    handles.removeDetachedSession(sideChatSeed.id);
    setSideChatSeed(createSideChatSession(activeProject ?? null, focusedSession, activeModelId));
    tools.closeComputerTab("side-chat");
  }, [activeModelId, activeProject, focusedSession, handles, sideChatSeed.id, tools]);
  const closeComputerTab = useCallback(
    (closing: ComputerTab) => {
      if (closing === "side-chat") {
        closeSideChat();
        return;
      }
      if (closing === "terminal") {
        closePersistedTerminalOwners(visibleTerminalState.owners);
      }
      tools.closeComputerTab(closing);
    },
    [closeSideChat, tools, visibleTerminalState.owners],
  );
  return (
    <aside
      className={`${tools.computer.open ? "relative flex" : "hidden"} shrink-0 flex-col border-l border-(--border) bg-(--color-panel) shadow-[inset_1px_0_rgba(255,255,255,0.02)]`}
      ref={registerComputerAside}
      tabIndex={-1}
      onKeyDown={handleComputerKeyDown}
      style={{ width: `${tools.computer.width}px`, minWidth: "max(280px, 25%)", maxWidth: "65%" }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--fg)/8"
      />
      <ComputerHeader
        tab={tools.computer.tab}
        openTabs={tools.computer.tabs}
        terminalState={visibleTerminalState}
        onSelectTab={tools.setComputerTab}
        onOpenCurrentTerminal={openTerminalForFocusedSession}
        onSelectTerminalOwner={selectTerminalOwner}
        onCloseTerminalOwner={closeTerminalOwner}
        onCloseTab={closeComputerTab}
        onShowLauncher={() => tools.setComputerTab("tools")}
      />

      <ComputerTabPanel
        activeModel={activeModel}
        activeModelId={activeModelId}
        activeProject={activeProject}
        focusedSession={focusedSession}
        gitSummary={gitSummary}
        models={models}
        modelsLoading={modelsLoading}
        isElectron={isElectron}
        onCloseSideChat={closeSideChat}
        onCompactSession={handles.compactFocusedSession}
        onNavigateBrowser={navigateBrowser}
        onOpenSideChat={openSideChat}
        onOpenTerminal={openTerminalForFocusedSession}
        onRenameSideChat={renameSideChat}
        onUpdateSideChatTabs={updateSideChatTabs}
        sessions={sessions}
        sideChatSession={sideChatSession}
        tools={tools}
      />

      <PersistentTerminals
        active={tools.computer.open && tools.computer.tab === "terminal"}
        activeOwnerKey={visibleTerminalState.activeOwnerKey}
        terminals={terminalState.owners}
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
  plan: "Plan",
  inspector: "Inspector",
  terminal: "Terminal",
};

const TAB_OPTIONS: Array<{
  tab: ComputerTab;
  label: string;
  description: string;
  icon?: LucideIcon;
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
    tab: "plan",
    label: "Plan",
    description: "Plan and to-do checklist",
    icon: ListChecks,
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
  {
    tab: "inspector",
    label: "Inspector",
    description: "Per-turn tools, files, and context",
    icon: ScanSearch,
  },
  { tab: "terminal", label: "Terminal", description: "Project shell", icon: TerminalSquare },
];

function ComputerHeader({
  tab,
  openTabs,
  terminalState,
  onSelectTab,
  onOpenCurrentTerminal,
  onSelectTerminalOwner,
  onCloseTerminalOwner,
  onCloseTab,
  onShowLauncher,
}: {
  tab: ComputerTab;
  openTabs: ComputerTab[];
  terminalState: TerminalOwnersSnapshot;
  onSelectTab: (tab: ComputerTab) => void;
  onOpenCurrentTerminal: () => void;
  onSelectTerminalOwner: (ownerKey: string) => void;
  onCloseTerminalOwner: (ownerKey: string) => void;
  onCloseTab: (tab: ComputerTab) => void;
  onShowLauncher: () => void;
}) {
  const visibleTabs = openTabs.filter(
    (openTab) =>
      openTab !== "tools" && (openTab !== "terminal" || terminalState.owners.length === 0),
  );
  const tabMeta = (candidate: ComputerTab) =>
    candidate === "status"
      ? { label: "Status", icon: Activity }
      : {
          label: TAB_LABELS[candidate],
          icon: TAB_OPTIONS.find((item) => item.tab === candidate)?.icon ?? PanelRight,
        };
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-(--border) bg-(--color-header) px-1.5 text-[length:var(--fs-sm)]">
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
                  ? "bg-(--color-surface-hover) text-(--fg)/85 hover:text-(--fg)"
                  : "text-(--dim)/75 hover:bg-(--hover) hover:text-(--fg)/75"
              }`}
              title={meta.label}
            >
              <button
                type="button"
                onClick={() =>
                  openTab === "terminal" ? onOpenCurrentTerminal() : onSelectTab(openTab)
                }
                className="inline-flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-1.5 pr-1 text-left"
              >
                {Icon ? <Icon className="pointer-events-none h-3 w-3 shrink-0" /> : null}
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
        {terminalState.owners.map((owner, index) => {
          const label = terminalOwnerLabel(owner, index);
          const selected = tab === "terminal" && terminalState.activeOwnerKey === owner.mountKey;
          const shortcut = index < 9 ? `⌘⌥${index + 1}` : undefined;
          return (
            <div
              key={owner.mountKey}
              className={`group inline-flex h-8 min-w-0 shrink-0 items-center gap-0.5 rounded-md ${
                selected
                  ? "bg-(--color-surface-hover) text-(--fg)/85 hover:text-(--fg)"
                  : "text-(--dim)/75 hover:bg-(--hover) hover:text-(--fg)/75"
              }`}
              title={shortcut ? `${label} (${shortcut})` : label}
            >
              <button
                type="button"
                onClick={() => onSelectTerminalOwner(owner.mountKey)}
                className="inline-flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-1.5 pr-1 text-left"
              >
                <TerminalSquare className="pointer-events-none h-3 w-3 shrink-0" />
                <span className="max-w-[7rem] truncate">{label}</span>
                {shortcut ? (
                  <span className="text-[length:var(--fs-2xs)] text-(--dim)/70">{shortcut}</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTerminalOwner(owner.mountKey);
                }}
                className="inline-flex h-8 w-7 items-center justify-center rounded text-(--dim)/65 hover:bg-(--hover) hover:text-(--fg)/75"
                aria-label={`Close ${label}`}
                title={`Close ${label}`}
              >
                <CloseIcon className="pointer-events-none h-2 w-2" />
              </button>
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
              ? "bg-(--color-surface-hover) text-(--fg)/85 hover:text-(--fg)"
              : "text-(--dim)/75 hover:bg-(--hover) hover:text-(--fg)/75"
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
