"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { X } from "@/ui/icon-registry";
import { Button } from "./button";
import { useDialogFocusTrap } from "./dialog-focus";
import { cx } from "./utils";

export type DrawerSide = "left" | "right";

export function Drawer({
  children,
  id,
  width = 720,
  className,
  style,
  side = "right",
  fullBleed = false,
}: {
  children: ReactNode;
  id?: string;
  width?: number;
  className?: string;
  style?: CSSProperties;
  side?: DrawerSide;
  /**
   * Fill the overlay edge to edge instead of sitting at `width`. The mobile
   * navigation drawer needs this: the panel is the whole screen on a phone, and
   * the desktop `min(420px, 40%)` floor would leave a dead strip beside it.
   */
  fullBleed?: boolean;
}) {
  // 100vw rather than 100%: the overlay's dialog wrapper is a shrink-to-fit
  // flex item, so a percentage width would resolve against the panel's own
  // content and collapse.
  const sizing: CSSProperties = fullBleed
    ? { width: "100vw", minWidth: 0, maxWidth: "100vw" }
    : { width: `${width}px`, minWidth: "min(420px, 40%)", maxWidth: "min(960px, 76%)" };

  return (
    <aside
      id={id}
      className={cx(
        "relative flex shrink-0 flex-col bg-(--color-popover)",
        side === "right"
          ? "border-l border-(--color-popover-border) shadow-[-24px_0_80px_rgba(0,0,0,0.38)]"
          : "border-r border-(--color-popover-border) shadow-[24px_0_80px_rgba(0,0,0,0.38)]",
        className,
      )}
      style={{ ...sizing, ...style }}
    >
      {children}
    </aside>
  );
}

export function DrawerOverlay({
  children,
  onClose,
  side = "right",
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  side?: DrawerSide;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap({ dialogRef, active: true, onClose, focusFirstElement: false });

  return (
    <div
      // m-0 because the overlay is rendered inline wherever it is used: drop it
      // inside a `space-y-*` stack and the sibling margin lands on this fixed
      // box, shrinking it away from the bottom of the viewport.
      className={cx(
        "fixed inset-0 z-50 m-0 flex bg-(--color-scrim) backdrop-blur-[2px]",
        side === "right" ? "justify-end" : "justify-start",
        className,
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        className="flex h-full outline-none"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}

export function DrawerHeader({
  title,
  icon,
  badge,
  actions,
  onClose,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <header
      className={cx(
        "flex h-10 shrink-0 items-center gap-2 border-b border-(--border) bg-(--color-popover-header) px-3 text-[length:var(--fs-sm)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="truncate font-medium text-(--ui-fg)/85">{title}</span>
        {badge}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      {onClose ? (
        <Button variant="icon" size="sm" onClick={onClose} aria-label="Close" title="Close">
          <X className="h-3 w-3" />
        </Button>
      ) : null}
    </header>
  );
}

export function DrawerBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("min-h-0 flex-1 overflow-y-auto p-4", className)}>{children}</div>;
}

export function DrawerFooter({
  status,
  children,
  className,
}: {
  status?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cx(
        "flex h-11 shrink-0 items-center justify-between gap-3 border-t border-(--border) bg-(--color-popover-header) px-3 text-[length:var(--fs-sm)]",
        className,
      )}
    >
      <div className="min-w-0 truncate text-(--ui-muted)/75">{status}</div>
      {children ? <div className="flex shrink-0 items-center gap-1">{children}</div> : null}
    </footer>
  );
}
