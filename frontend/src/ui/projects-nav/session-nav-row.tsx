"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { CloseIcon, EyeOffIcon, MoreIcon, PinIcon } from "@/ui/icons";
import type { SessionPref } from "@/lib/agent/session/prefs";

const SESSION_MENU_CLASS =
  "absolute right-0 top-5 isolate z-[999] min-w-[150px] rounded-md border border-[#3a3a3a] bg-[#202020] p-1 text-xs text-(--fg) opacity-100 shadow-[0_12px_32px_rgba(0,0,0,0.85)]";

function hrefWithOpenNonce(href: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}open=${Date.now().toString(36)}`;
}

type SessionNavRowProps = {
  pref: SessionPref;
  label: string;
  initialDraft: string;
  age: string;
  rowClass: string;
  renameRowClass?: string;
  href?: string;
  onOpen?: () => void;
  onPatchPref: (patch: SessionPref) => void;
  onArchive?: () => void;
  onRenameCommit?: (title: string) => void;
  onRememberTitle?: () => void;
  onDragStart: (event: DragEvent) => void;
  onContextMenu?: boolean;
  isRunning?: boolean;
  canDoubleClickRename?: boolean;
  showClearAction?: boolean;
  menuIconClass?: string;
  renameInputClass?: string;
  menuItemsWithIcons?: boolean;
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
  onContextMenu = false,
  isRunning = false,
  canDoubleClickRename = false,
  showClearAction = false,
  menuIconClass = "h-3 w-3",
  renameInputClass = "text-[length:var(--fs-md)]",
  menuItemsWithIcons = false,
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
    >
      <SessionPinButton
        pinned={Boolean(pref.pinned)}
        onToggle={() => onPatchPref({ pinned: !pref.pinned })}
      />
      <SessionOpenTarget
        age={age}
        canDoubleClickRename={canDoubleClickRename}
        href={href}
        isRunning={isRunning}
        label={label}
        onDragStart={onDragStart}
        onOpen={onOpen}
        onRememberTitle={onRememberTitle}
        onStartRename={startRename}
      />
      <div ref={menuRef} className="absolute right-1 top-1/2 z-20 -translate-y-1/2 shrink-0">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-(--hover)/95 text-(--dim) shadow-[0_0_14px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-[opacity,color] hover:text-(--fg) ${
            menuOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          }`}
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className={`pointer-events-none ${menuIconClass}`} />
        </button>
        {menuOpen ? (
          <SessionOptionsMenu
            menuItemsWithIcons={menuItemsWithIcons}
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
  label: string;
  onDragStart: (event: DragEvent) => void;
  onOpen?: () => void;
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
  const content = <SessionRowContent age={age} isRunning={isRunning} label={label} />;

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
          router.push(hrefWithOpenNonce(href));
        }}
        onDragStart={onDragStart}
        className="flex min-w-0 flex-1 items-center gap-1"
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
      onClick={onOpen}
      aria-label={label}
      className="flex min-w-0 flex-1 items-center gap-1 text-left"
      {...openProps}
    >
      {content}
    </button>
  );
}

function SessionRowContent({
  age,
  isRunning,
  label,
}: {
  age: string;
  isRunning: boolean;
  label: string;
}) {
  return (
    <>
      {isRunning ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-(--accent)" aria-hidden />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[length:var(--fs-xs)] font-normal leading-4 text-(--fg)/78 transition-colors group-hover:text-(--fg)/95">
        {label}
      </span>
      {age ? (
        <span className="shrink-0 pl-1.5 pr-1 font-mono text-[length:var(--fs-2xs)] text-(--dim)">
          {age}
        </span>
      ) : null}
    </>
  );
}

function SessionOptionsMenu({
  menuItemsWithIcons,
  onArchive,
  onClear,
  onClose,
  onPin,
  onRename,
  pref,
  showClearAction,
}: {
  menuItemsWithIcons: boolean;
  onArchive?: () => void;
  onClear: () => void;
  onClose: () => void;
  onPin: () => void;
  onRename: () => void;
  pref: SessionPref;
  showClearAction: boolean;
}) {
  const showClear = showClearAction && (pref.title || pref.pinned);

  return (
    <div className={SESSION_MENU_CLASS} role="menu">
      <SessionMenuItem
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </SessionMenuItem>
      <SessionMenuItem
        onClick={() => {
          onClose();
          onPin();
        }}
      >
        <PinLabel menuItemsWithIcons={menuItemsWithIcons} pinned={Boolean(pref.pinned)} />
      </SessionMenuItem>
      {onArchive ? (
        <SessionMenuItem
          onClick={() => {
            onClose();
            onArchive();
          }}
        >
          <ArchiveLabel menuItemsWithIcons={menuItemsWithIcons} />
        </SessionMenuItem>
      ) : null}
      {showClear ? (
        <SessionMenuItem
          onClick={() => {
            onClose();
            onClear();
          }}
        >
          <span className="inline-flex items-center gap-2 text-(--err)">
            <CloseIcon className="h-4 w-4" /> Clear
          </span>
        </SessionMenuItem>
      ) : null}
    </div>
  );
}

function PinLabel({
  menuItemsWithIcons,
  pinned,
}: {
  menuItemsWithIcons: boolean;
  pinned: boolean;
}) {
  if (!menuItemsWithIcons) return pinned ? "Unpin" : "Pin";
  return (
    <span className="inline-flex items-center gap-2">
      <PinIcon className="h-4 w-4" /> {pinned ? "Unpin" : "Pin"}
    </span>
  );
}

function ArchiveLabel({ menuItemsWithIcons }: { menuItemsWithIcons: boolean }) {
  if (!menuItemsWithIcons) return "Archive";
  return (
    <span className="inline-flex items-center gap-2">
      <EyeOffIcon className="h-4 w-4" /> Archive
    </span>
  );
}

function SessionPinButton({
  pinned,
  onToggle,
  disabled = false,
}: {
  pinned: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onToggle();
      }}
      disabled={disabled}
      className={`pointer-events-none absolute left-1.5 top-1/2 z-20 inline-flex h-5 w-5 shrink-0 -translate-y-1/2 scale-90 items-center justify-center rounded-md bg-(--hover)/95 opacity-0 shadow-[0_0_14px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-[opacity,transform,color] duration-300 ease-out hover:text-(--fg) group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:scale-100 focus-visible:opacity-100 disabled:opacity-20 ${pinned ? "text-(--accent)" : "text-(--fg)/78"}`}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin session" : "Pin session"}
      title={pinned ? "Unpin session" : "Pin session"}
    >
      <PinIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function SessionMenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-sm px-2 py-1 text-left text-xs text-(--fg) hover:bg-[#242424]"
    >
      {children}
    </button>
  );
}
