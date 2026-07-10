"use client";

import type { CSSProperties, ReactNode } from "react";
import { X } from "@/ui/icon-registry";
import { Button } from "./button";
import { cx } from "./utils";

/**
 * Drawer — a right-anchored side panel (the recipe editor, detail editors, etc.).
 * Composable: Drawer > DrawerHeader / [tab bar] / DrawerBody / DrawerFooter.
 * Chrome (borders, heights, tokens) lives here so every drawer matches; callers
 * only supply content and actions.
 */
export function Drawer({
  children,
  width = 720,
  className,
  style,
}: {
  children: ReactNode;
  width?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <aside
      className={cx(
        "relative flex shrink-0 flex-col border-l border-(--color-popover-border) bg-(--color-popover) shadow-[-24px_0_80px_rgba(0,0,0,0.38)]",
        className,
      )}
      style={{
        width: `${width}px`,
        minWidth: "min(420px, 40%)",
        maxWidth: "min(960px, 76%)",
        ...style,
      }}
    >
      {children}
    </aside>
  );
}

export function DrawerHeader({
  title,
  badge,
  onClose,
  className,
}: {
  title: ReactNode;
  badge?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <header
      className={cx(
        "flex h-10 shrink-0 items-center gap-2 border-b border-(--color-popover-border) bg-(--color-popover-header) px-3 text-[length:var(--fs-sm)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium text-(--ui-fg)/85">{title}</span>
        {badge}
      </div>
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
        "flex h-11 shrink-0 items-center justify-between gap-3 border-t border-(--color-popover-border) bg-(--color-popover-header) px-3 text-[length:var(--fs-sm)]",
        className,
      )}
    >
      <div className="min-w-0 truncate text-(--ui-muted)/75">{status}</div>
      {children ? <div className="flex shrink-0 items-center gap-1">{children}</div> : null}
    </footer>
  );
}
