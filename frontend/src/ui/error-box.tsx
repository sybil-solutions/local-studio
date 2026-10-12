"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "@/ui/icon-registry";
import { cx } from "./utils";

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cx(
        "flex items-start gap-2 rounded-[var(--rad-md)] border border-(--ui-border) bg-(--color-surface) px-3 py-2.5 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-fg)/85",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--ui-danger)" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
