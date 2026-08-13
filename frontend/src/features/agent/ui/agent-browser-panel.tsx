"use client";

import { useCallback, useMemo, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  Activity,
  FolderTree,
  GitBranch,
  Globe2,
  MessageSquarePlus,
  PanelRight,
  PanelRightFilled,
  Plus,
  TerminalSquare,
  type LucideIcon,
} from "@/ui/icon-registry";
import { CloseIcon } from "@/ui/icons";
import { MobileSheetGrip } from "@/ui/mobile-sheet-grip";
import {
  rememberPersistentTerminalOwner,
  removePersistentTerminalOwner,
  removePersistentTerminalOwners,
  selectPersistentTerminalOwner,
  usePersistentTerminalOwners,
  type TerminalOwnersSnapshot,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import { MAX_COMPUTER_WIDTH, MIN_COMPUTER_WIDTH } from "@/features/agent/tools/persistence";
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
import { ComputerTabPanel, type SideChatTabsUpdater } from "@/features/agent/ui/computer-tab-panel";
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
  const openSideChat = useCallback(() => {
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
  }, [activeModelId, activeProject, focusedSession, handles, sideChatSeed, tools]);
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
      className={`agent-computer-panel ${tools.computer.open ? "relative flex" : "hidden"} min-h-0 shrink-0 flex-col border-l border-(--border) bg-(--color-panel)`}
      ref={registerComputerAside}
      tabIndex={-1}
      onKeyDown={handleComputerKeyDown}
      style={{
        width: `${tools.computer.width}px`,
        minWidth: MIN_COMPUTER_WIDTH,
        maxWidth: MAX_COMPUTER_WIDTH,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--fg)/8"
      />
      <MobileSheetGrip label="Close panel" onDismiss={() => tools.setComputerOpen(false)} />
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
        onClosePanel={() => tools.setComputerOpen(false)}
      />

      <ComputerTabPanel
        activeModel={activeModel}
        activeModelId={activeModelId}
        activeProject={activeProject}
        focusedSession={focusedSession}
        gitSummary={gitSummary}
        models={models}
        modelsLoading={modelsLoading}
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
  "side-chat": "Side chat",
  browser: "Browser",
  files: "Filesystem",
  diff: "Review",
  terminal: "Terminal",
};

const TAB_OPTIONS: Array<{
  tab: ComputerTab;
  label: string;
  description: string;
  icon?: LucideIcon;
}> = [
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
  {
    tab: "diff",
    label: "Review",
    description: "Diff, commit, push, and PR",
    icon: GitBranch,
  },
  {
    tab: "files",
    label: "Filesystem",
    description: "Project files and rendered previews",
    icon: FolderTree,
  },
  { tab: "terminal", label: "Terminal", description: "Project shell", icon: TerminalSquare },
];

// Compact Codex-style pill: active gets a subtle fill; inactive is text-only
// and lifts to full contrast on hover. The close × fades in on hover (and stays
// on for the active pill). Shared by the tab list and the terminal-owner rows.
function TabPill({
  icon: Icon,
  label,
  selected,
  shortcut,
  title,
  onSelect,
  onClose,
}: {
  icon?: LucideIcon;
  label: string;
  selected: boolean;
  shortcut?: string;
  title: string;
  onSelect: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={`group inline-flex h-7 min-w-0 shrink-0 items-center rounded-md transition-[background-color,color] duration-150 ${
        selected ? "bg-(--color-surface-hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
      }`}
      title={title}
    >
      <button
        type="button"
        onClick={onSelect}
        className="inline-flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 text-left"
      >
        {Icon ? <Icon className="pointer-events-none h-3.5 w-3.5 shrink-0" /> : null}
        <span className="max-w-[8rem] truncate text-[length:var(--fs-sm)]">{label}</span>
        {shortcut ? (
          <span className="text-[length:var(--fs-2xs)] text-(--dim)/70">{shortcut}</span>
        ) : null}
      </button>
      {onClose ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className={`-ml-1 mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-(--dim)/65 opacity-0 transition-[color,opacity] duration-150 hover:text-(--fg) group-hover:opacity-100 focus-visible:opacity-100 ${
            selected ? "opacity-100" : ""
          }`}
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
        >
          <CloseIcon className="pointer-events-none h-2 w-2" />
        </button>
      ) : null}
    </div>
  );
}

// A round icon-only control that matches the pill height. Used for the tools
// launcher (+) and the panel-close button on the right edge of the strip.
function HeaderIconButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color] duration-150 ${
        active ? "bg-(--color-surface-hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
      }`}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon className="pointer-events-none h-3.5 w-3.5" />
    </button>
  );
}

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
  onClosePanel,
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
  onClosePanel: () => void;
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
    <div className="relative flex h-[var(--h-toolbar-pane)] shrink-0 items-center gap-1 border-b border-(--border) bg-(--color-header) px-1.5 text-[length:var(--fs-sm)]">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-0.5 [scrollbar-width:thin]">
        {visibleTabs.map((openTab) => {
          const meta = tabMeta(openTab);
          return (
            <TabPill
              key={openTab}
              icon={meta.icon}
              label={meta.label}
              title={meta.label}
              selected={tab === openTab}
              onSelect={() =>
                openTab === "terminal" ? onOpenCurrentTerminal() : onSelectTab(openTab)
              }
              onClose={openTab === "status" ? undefined : () => onCloseTab(openTab)}
            />
          );
        })}
        {terminalState.owners.map((owner, index) => {
          const label = terminalOwnerLabel(owner, index);
          const selected = tab === "terminal" && terminalState.activeOwnerKey === owner.mountKey;
          const shortcut = index < 9 ? `⌘⌥${index + 1}` : undefined;
          return (
            <TabPill
              key={owner.mountKey}
              icon={TerminalSquare}
              label={label}
              title={shortcut ? `${label} (${shortcut})` : label}
              shortcut={shortcut}
              selected={selected}
              onSelect={() => onSelectTerminalOwner(owner.mountKey)}
              onClose={() => onCloseTerminalOwner(owner.mountKey)}
            />
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <HeaderIconButton
          icon={Plus}
          label="Show tools"
          active={tab === "tools"}
          onClick={onShowLauncher}
        />
        <HeaderIconButton
          icon={PanelRightFilled}
          label="Close controller panel"
          onClick={onClosePanel}
        />
      </div>
    </div>
  );
}
