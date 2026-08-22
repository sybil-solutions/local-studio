"use client";

import { useRef, useState } from "react";
import { Menu, PanelRightFilled, PanelRightHollow, TerminalSquare } from "@/ui/icon-registry";
import { useAppStore } from "@/store";
import { MenuItem } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { setReasoningVisible, useReasoningVisible } from "@/features/agent/messages/session-prefs";
import { CloseIcon, MoreIcon } from "@/ui/icons";
import { preloadTerminalPanel } from "@/features/agent/ui/terminal-panel";

const CHAT_HEADER_MENU_CLASS = `absolute left-0 top-7 isolate z-[999] min-w-[180px] text-xs text-(--fg) opacity-100 ${POPOVER_MENU_CLASS}`;

export function AgentChatPaneHeader({
  title,
  pinned,
  rightPanelOpen,
  canFork,
  canClose,
  canExport = false,
  terminalOpen = false,
  onTogglePinned,
  onRename,
  onFork,
  onOpenTerminal,
  onExport,
  onClose,
  onToggleRightPanel,
}: {
  title: string;
  pinned: boolean;
  rightPanelOpen: boolean;
  canFork: boolean;
  canClose: boolean;
  canExport?: boolean;
  terminalOpen?: boolean;
  onTogglePinned: () => void;
  onRename: (title: string) => void;
  onFork?: () => void;
  onOpenTerminal?: () => void;
  onExport?: () => void;
  onClose?: () => void;
  onToggleRightPanel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const ref = useRef<HTMLDivElement>(null);
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen);
  useClickOutside(ref, open, () => setOpen(false));
  const reasoningVisible = useReasoningVisible();
  const RightPanelIcon = rightPanelOpen ? PanelRightFilled : PanelRightHollow;
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
    <div className="grid h-[var(--h-toolbar-pane)] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-(--border) bg-(--color-header) py-0 pl-3 pr-2 text-xs md:pl-4">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="-ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--dim) hover:bg-(--hover) hover:text-(--fg) md:hidden"
          aria-label="Open navigation menu"
          aria-controls="mobile-navigation-drawer"
        >
          <Menu className="pointer-events-none h-[18px] w-[18px]" />
        </button>
        <div ref={ref} className="relative flex min-w-0 items-center gap-1.5">
        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            // Select the whole existing name on entry so a click-to-rename can
            // be overwritten by typing straight away (issue #274).
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename();
              if (event.key === "Escape") {
                setDraftTitle(title);
                setRenaming(false);
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-sm bg-(--surface) px-1.5 py-0.5 text-[length:var(--fs-md)] font-medium text-(--fg) outline-none"
            aria-label="Rename session"
          />
        ) : (
          <button
            type="button"
            onClick={startRename}
            className="block min-w-0 truncate whitespace-nowrap rounded-sm text-left text-[length:var(--fs-md)] font-medium leading-none text-(--fg) hover:bg-(--hover) md:text-[length:var(--fs-base)]"
            title={title}
            aria-label={`Rename session: ${title}`}
          >
            {title}
          </button>
        )}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((value) => !value)}
          className={`relative z-10 -my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            open
              ? "text-(--fg) hover:bg-(--hover)"
              : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
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
            <MenuItem onClick={startRename}>Rename</MenuItem>
            <MenuItem
              onClick={() => {
                onTogglePinned();
                setOpen(false);
              }}
            >
              {pinned ? "Unpin" : "Pin"}
            </MenuItem>
            <MenuItem
              disabled={!canFork}
              onClick={() => {
                onFork?.();
                setOpen(false);
              }}
            >
              Fork
            </MenuItem>
            <MenuItem
              disabled={!canExport || !onExport}
              onClick={() => {
                onExport?.();
                setOpen(false);
              }}
            >
              Export as Markdown
            </MenuItem>
            <MenuItem
              onClick={() => {
                setReasoningVisible(!reasoningVisible);
                setOpen(false);
              }}
            >
              {reasoningVisible ? "Hide reasoning" : "Show reasoning"}
            </MenuItem>
          </div>
        ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canClose ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose?.();
            }}
            className="relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-(--hl2) hover:bg-(--hover) hover:text-(--fg)"
            aria-label="Close pane"
            title="Close pane"
          >
            <CloseIcon className="h-3 w-3 pointer-events-none" />
          </button>
        ) : null}
        {onOpenTerminal ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={preloadTerminalPanel}
            onFocus={preloadTerminalPanel}
            onClick={onOpenTerminal}
            aria-pressed={terminalOpen}
            className={`relative z-10 -my-1 hidden h-8 w-8 items-center justify-center rounded-lg md:inline-flex ${
              terminalOpen
                ? "bg-(--active) text-(--fg)"
                : "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)"
            }`}
            title={terminalOpen ? "Back to chat" : "Open terminal"}
            aria-label={terminalOpen ? "Back to chat" : "Open terminal"}
          >
            <TerminalSquare className="pointer-events-none h-3.5 w-3.5" />
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
              ? "text-(--fg) hover:bg-(--hover)"
              : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
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
