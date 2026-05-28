"use client";

import type { ReactNode } from "react";
import type { SortDirection, SortField } from "@/lib/types";
import { formatDurationOrUnavailable } from "@/lib/formatters";

export function SortHeader({
  field,
  currentField,
  direction,
  onClick,
  children,
  align = "left",
}: {
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
  onClick: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const isActive = currentField === field;

  return (
    <th
      className={`cursor-pointer select-none px-3 py-2 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-(--dim) transition-colors hover:text-(--fg) ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={onClick}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {children}
        {isActive && <span>{direction === "asc" ? "↑" : "↓"}</span>}
      </div>
    </th>
  );
}

export function StatusPill({ value, type }: { value: number | null; type: "success" | "latency" }) {
  if (value === null) {
    return (
      <span className="font-mono text-[12px] tabular-nums text-(--dim)">
        {type === "success" ? "0.0%" : "0ms"}
      </span>
    );
  }

  const getColor = () => {
    if (type === "success") {
      if (value >= 95) return "text-(--hl2)";
      if (value >= 90) return "text-(--hl3)";
      return "text-(--err)";
    }
    if (value < 500) return "text-(--hl2)";
    if (value < 1500) return "text-(--hl3)";
    return "text-(--err)";
  };

  return (
    <span className={`font-mono text-[12px] tabular-nums ${getColor()}`}>
      {type === "success" ? `${value.toFixed(1)}%` : formatDurationOrUnavailable(value)}
    </span>
  );
}
