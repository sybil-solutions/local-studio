"use client";

import Link from "next/link";
import { Spinner } from "@/ui";
import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { Archive, MoreIcon, Pin, PinOff, SquarePen, X } from "@/ui/icon-registry";
import type { SessionPref } from "@/features/agent/messages/prefs";
import { hrefWithOpenNonce, navigateToSessionHref } from "./helpers";

const SESSION_MENU_CLASS =
  "absolute right-0 top-6 isolate z-[999] min-w-[180px] rounded-2xl border border-(--color-popover-border) bg-(--color-popover) p-1.5 shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.3),0px_0px_0px_0.5px_rgba(0,0,0,0.1)]";

type SessionNavRowProps = {
  pref: SessionPref;
  label: string;
  initialDraft: string;
  age: string;
  rowClass: string;
  renameRowClass?: string;
  href?: string;
  onOpen?: (href: string) => void;
  onPatchPref: (patch: SessionPref) => void;
  onArchive?: () => void;
  onRenameCommit?: (title: string) => void;
  onRememberTitle?: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onContextMenu?: boolean;
  isRunning?: boolean;
  unseen?: boolean;
  canDoubleClickRename?: boolean;
  showClearAction?: boolean;
  renameInputClass?: string;
};

export function SessionNavRow({
  pref,
  label,
  initialDraft,
  age,
  rowClass,
  renameRowClass = rowClass,
  href,
  onOpen,
  onPatchPref,
  onArchive,
  onRenameCommit,
  onRememberTitle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu = false,
  isRunning = false,
  unseen = false,
  canDoubleClickRename = false,
  showClearAction = false,
  renameInputClass = "text-[length:var(--fs-md)]",
}: SessionNavRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));
  const startRename = () => {
    setDraft(initialDraft);
    setRenaming(true);
  };
  const finishRename = () => {
    const trimmed = draft.trim();
    onPatchPref({ title: trimmed || undefined });
    onRenameCommit?.(trimmed);
    setRenaming(false);
  };
  const handleContextMenu = onContextMenu
    ? (event: MouseEvent) => {
        event.preventDefault();
        setMenuOpen(true);
      }
    : undefined;

  if (renaming) {
    return (
      <RenameInput
        className={renameRowClass}
        draft={draft}
        inputClassName={renameInputClass}
        initialDraft={initialDraft}
        onCancel={() => {
          setDraft(initialDraft);
          setRenaming(false);
        }}
        onChange={setDraft}
        onCommit={finishRename}
      />
    );
  }

  return (
    <div
      className={`${rowClass} ${menuOpen ? "z-[900]" : "z-0"}`}
      onContextMenu={handleContextMenu}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <SessionOpenTarget
        age={age}
        canDoubleClickRename={canDoubleClickRename}
        href={href}
        isRunning={isRunning}
        unseen={unseen}
        label={label}
        onDragStart={onDragStart}
        onOpen={onOpen}
        onRememberTitle={onRememberTitle}
        onStartRename={startRename}
      />
      <div
        ref={menuRef}
        className="absolute right-1 top-1/2 z-20 flex -translate-y-1/2 shrink-0 items-center gap-0.5"
      >
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPatchPref({ pinned: !pref.pinned });
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-(--dim) transition-[opacity,color,background-color] hover:bg-(--hover) hover:text-(--fg) ${
            menuOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          }`}
          aria-label={pref.pinned ? "Unpin session" : "Pin session"}
          title={pref.pinned ? "Unpin" : "Pin"}
        >
          {pref.pinned ? (
            <PinOff className="pointer-events-none h-3.5 w-3.5" />
          ) : (
            <Pin className="pointer-events-none h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-(--dim) transition-[opacity,color,background-color] hover:bg-(--hover) hover:text-(--fg) ${
            menuOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          }`}
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className="pointer-events-none h-3.5 w-3.5" />
        </button>
        {menuOpen ? (
          <SessionOptionsMenu
            onArchive={onArchive}
            onClear={() => onPatchPref({ title: undefined, pinned: undefined })}
            onClose={() => setMenuOpen(false)}
            onPin={() => onPatchPref({ pinned: !pref.pinned })}
            onRename={startRename}
            pref={pref}
            showClearAction={showClearAction}
          />
        ) : null}
      </div>
    </div>
  );
}

function RenameInput({
  className,
  draft,
  inputClassName,
  initialDraft,
  onCancel,
  onChange,
  onCommit,
}: {
  className: string;
  draft: string;
  inputClassName: string;
  initialDraft: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className={className}>
      <input
        autoFocus
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
          if (event.key === "Escape") {
            onChange(initialDraft);
            onCancel();
          }
        }}
        className={`min-w-0 flex-1 bg-transparent ${inputClassName} text-(--fg) outline-none`}
      />
    </div>
  );
}

function SessionOpenTarget({
  age,
  canDoubleClickRename,
  href,
  isRunning,
  unseen,
  label,
  onDragStart,
  onOpen,
  onRememberTitle,
  onStartRename,
}: {
  age: string;
  canDoubleClickRename: boolean;
  href?: string;
  isRunning: boolean;
  unseen: boolean;
  label: string;
  onDragStart: (event: DragEvent) => void;
  onOpen?: (href: string) => void;
  onRememberTitle?: () => void;
  onStartRename: () => void;
}) {
  const router = useRouter();
  const openProps = canDoubleClickRename
    ? {
        onDoubleClick: (event: MouseEvent) => {
          event.preventDefault();
          onStartRename();
        },
      }
    : {};
  const content = (
    <SessionRowContent age={age} isRunning={isRunning} unseen={unseen} label={label} />
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={label}
        draggable
        onClick={(event) => {
          onRememberTitle?.();
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          const targetHref = hrefWithOpenNonce(href);
          onOpen?.(targetHref);
          navigateToSessionHref(router, targetHref);
        }}
        onDragStart={onDragStart}
        className="flex min-w-0 flex-1 items-center gap-1 pr-14"
        {...openProps}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={() => {
        onRememberTitle?.();
        onOpen?.("");
      }}
      aria-label={label}
      className="flex min-w-0 flex-1 items-center gap-1 pr-14 text-left"
      {...openProps}
    >
      {content}
    </button>
  );
}

function SessionRowContent({
  age,
  isRunning,
  unseen,
  label,
}: {
  age: string;
  isRunning: boolean;
  unseen: boolean;
  label: string;
}) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate text-[length:var(--fs-md)] font-normal leading-5">
        {label}
      </span>
      {isRunning ? (
        <Spinner
          size="xs"
          className="mr-1 shrink-0 text-(--link) transition-opacity group-hover:opacity-0"
        />
      ) : unseen ? (
        <span
          className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-(--link) transition-opacity group-hover:opacity-0"
          aria-label="Unseen activity"
          title="Unseen activity"
        />
      ) : null}
    </>
  );
}

function SessionOptionsMenu({
  onArchive,
  onClear,
  onClose,
  onPin,
  onRename,
  pref,
  showClearAction,
}: {
  onArchive?: () => void;
  onClear: () => void;
  onClose: () => void;
  onPin: () => void;
  onRename: () => void;
  pref: SessionPref;
  showClearAction: boolean;
}) {
  const showClear = showClearAction && (pref.title || pref.pinned);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div className={SESSION_MENU_CLASS} role="menu">
      <SessionMenuItem Icon={pref.pinned ? PinOff : Pin} onClick={run(onPin)}>
        {pref.pinned ? "Unpin" : "Pin"}
      </SessionMenuItem>
      <SessionMenuItem Icon={SquarePen} onClick={run(onRename)}>
        Rename
      </SessionMenuItem>
      {onArchive ? (
        <SessionMenuItem Icon={Archive} onClick={run(onArchive)}>
          Archive
        </SessionMenuItem>
      ) : null}
      {showClear ? (
        <>
          <div className="mx-1 my-1 h-px bg-(--border)" />
          <SessionMenuItem Icon={X} danger onClick={run(onClear)}>
            Clear
          </SessionMenuItem>
        </>
      ) : null}
    </div>
  );
}

function SessionMenuItem({
  Icon,
  danger = false,
  onClick,
  children,
}: {
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[length:var(--fs-base)] transition-colors ${
        danger ? "text-(--err) hover:bg-(--err)/10" : "text-(--fg) hover:bg-(--color-menu-hover)"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${danger ? "" : "opacity-70"}`} strokeWidth={1.5} />
      <span className="truncate">{children}</span>
    </button>
  );
}
