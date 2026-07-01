"use client";

import type { Key, ReactNode } from "react";
import { cx } from "@/ui/utils";

export type FactGridItem = {
  label: ReactNode;
  value: ReactNode;
  key?: Key;
  span?: "full";
  mono?: boolean;
};

export type FactGridColumns = 1 | 2 | 3 | 4;
export type FactGridVariant = "plain" | "panel";

const columnClasses: Record<FactGridColumns, string> = {
  1: "",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

export function FactGrid({
  items,
  columns = 2,
  variant = "plain",
  className,
}: {
  items: FactGridItem[];
  columns?: FactGridColumns;
  variant?: FactGridVariant;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "grid gap-3 text-[length:var(--fs-sm)]",
        columnClasses[columns],
        variant === "panel" ? "rounded-md border border-(--ui-border) bg-(--ui-hover)/35 p-3" : "",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={item.key ?? index} className={item.span === "full" ? "md:col-span-full" : ""}>
          <div className="mb-1 text-[length:var(--fs-xs)] text-(--ui-muted)">{item.label}</div>
          <div
            className={cx(
              "break-words text-(--ui-fg) [overflow-wrap:anywhere]",
              item.mono ? "font-mono" : "",
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
