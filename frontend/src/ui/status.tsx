"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export type UiTone = "default" | "good" | "warning" | "danger" | "info";
export type StatusPillVariant = "dot" | "badge";

const dotClasses: Record<UiTone, string> = {
  default: "bg-(--ui-muted)",
  good: "bg-(--ui-success)",
  warning: "bg-(--ui-warning)",
  danger: "bg-(--ui-danger)",
  info: "bg-(--ui-info)",
};

const textClasses: Record<UiTone, string> = {
  default: "text-(--ui-muted)",
  good: "text-(--ui-success)",
  warning: "text-(--ui-warning)",
  danger: "text-(--ui-danger)",
  info: "text-(--ui-info)",
};

const badgeClasses: Record<UiTone, string> = {
  default: "bg-(--ui-surface) text-(--ui-muted)",
  good: "bg-(--ui-success)/10 text-(--ui-success)",
  warning: "bg-(--ui-warning)/10 text-(--ui-warning)",
  danger: "bg-(--ui-danger)/10 text-(--ui-danger)",
  info: "bg-(--ui-info)/10 text-(--ui-info)",
};

export function StatusDot({ tone = "default", className }: { tone?: UiTone; className?: string }) {
  return <span className={cx("h-[5px] w-[5px] rounded-full", dotClasses[tone], className)} />;
}

export function StatusPill({
  tone = "default",
  variant = "dot",
  children,
  className,
}: {
  tone?: UiTone;
  variant?: StatusPillVariant;
  children: ReactNode;
  className?: string;
}) {
  if (variant === "badge") {
    return (
      <span
        className={cx(
          "inline-flex h-5 items-center rounded-full px-2 text-[length:var(--fs-xs)] font-medium",
          badgeClasses[tone],
          className,
        )}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] font-normal",
        textClasses[tone],
        className,
      )}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}
