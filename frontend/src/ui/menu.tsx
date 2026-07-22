import type { ComponentType, ReactNode } from "react";

type MenuItemIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export type MenuItemProps = {
  Icon?: MenuItemIcon;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

export function MenuItem({
  Icon,
  danger = false,
  disabled = false,
  onClick,
  children,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={
        Icon
          ? `flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[length:var(--fs-base)] transition-colors ${
              danger
                ? "text-(--err) hover:bg-(--err)/10"
                : "text-(--fg) hover:bg-(--color-menu-hover)"
            }`
          : "block w-full rounded-[10px] px-2.5 py-2 text-left text-[length:var(--fs-base)] text-(--fg) hover:bg-(--color-menu-hover) disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      }
    >
      {Icon ? (
        <Icon className={`h-4 w-4 shrink-0 ${danger ? "" : "opacity-70"}`} strokeWidth={1.5} />
      ) : null}
      {Icon ? <span className="truncate">{children}</span> : children}
    </button>
  );
}
