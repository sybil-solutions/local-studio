"use client";

import { useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, TerminalSquare } from "@/ui/icon-registry";
import { MenuItem } from "@/ui";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { setReasoningVisible } from "@/features/agent/messages/reasoning-pref";
import { useReasoningVisible } from "@/features/agent/messages/use-reasoning-visible";
import { CloseIcon, MoreIcon } from "@/ui/icons";
import { preloadTerminalPanel } from "@/features/agent/ui/terminal-panel";

const CHAT_HEADER_MENU_CLASS =
  "absolute left-0 top-7 isolate z-[999] min-w-[180px] rounded-2xl border border-(--color-popover-border) bg-(--color-popover) p-1.5 text-xs text-(--fg) opacity-100 shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.3),0px_0px_0px_0.5px_rgba(0,0,0,0.1)]";

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
  useClickOutside(ref, open, () => setOpen(false));
  const reasoningVisible = useReasoningVisible();
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
    <div className="grid h-[var(--h-toolbar-pane)] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-(--border) bg-(--color-header) py-0 pl-4 pr-2 text-xs">
      <div ref={ref} className="relative flex min-w-0 items-center gap-1.5">
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
            className="h-7 min-w-0 flex-1 rounded-sm bg-(--surface) px-1.5 py-0.5 text-[length:var(--fs-md)] font-medium text-(--fg) outline-none"
            aria-label="Rename session"
          />
        ) : (
          <span
            className="block min-w-0 truncate whitespace-nowrap text-[length:var(--fs-base)] font-medium leading-none text-(--fg)"
            title={title}
          >
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
            className={`relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-lg ${
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
