"use client";

import type { ReactNode } from "react";
import { cx } from "@/ui/utils";

export interface MetricSegment {
  label: string;
  value: number;
  color: string;
}

export interface MiniBarDatum {
  label: string;
  value: number;
}

const clampedPercent = (value: number): number => Math.max(0, Math.min(100, value));

const visiblePercent = (value: number): number => {
  const percent = clampedPercent(value);
  return Math.max(percent, percent > 0 ? 3 : 0);
};

export function MetricMeter({
  value,
  percent,
  tone = "neutral",
  className,
}: {
  value: string;
  percent: number;
  tone?: "neutral" | "bad";
  className?: string;
}) {
  const color = tone === "bad" ? "bg-(--err)" : "bg-(--hl2)";
  return (
    <div className={cx("ml-auto flex w-28 flex-col items-end gap-1", className)}>
      <span className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)">{value}</span>
      <span className="h-1 w-full bg-(--surface)">
        <span
          className={cx("block h-full", color)}
          style={{ width: `${visiblePercent(percent)}%` }}
        />
      </span>
    </div>
  );
}

export function MetricPanel({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 font-mono">
        <span className="text-[length:var(--fs-2xs)] uppercase tracking-[0.16em] text-(--dim)">
          {title}
        </span>
        <span className="text-[length:var(--fs-sm)] tabular-nums text-(--fg)">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function StackedMetricBar({
  segments,
  total,
  formatValue,
}: {
  segments: MetricSegment[];
  total: number;
  formatValue: (value: number) => string;
}) {
  const safeTotal = Math.max(total, 1);
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden bg-(--surface)">
        {segments.map((segment) => (
          <span
            key={segment.label}
            style={{
              width: `${clampedPercent((segment.value / safeTotal) * 100)}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-[length:var(--fs-xs)] text-(--dim)">
        {segments.map((segment) => (
          <div key={segment.label} className="min-w-0">
            <span className="uppercase tracking-[0.12em]">{segment.label}</span>{" "}
            <span className="tabular-nums text-(--fg)">{formatValue(segment.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniBarChart({ bars, max }: { bars: MiniBarDatum[]; max: number }) {
  const safeMax = Math.max(max, 1);
  return (
    <div className="grid h-24 grid-cols-3 items-end gap-2 border-b border-(--border)/40 pb-2">
      {bars.map((bar) => (
        <div key={bar.label} className="flex h-full min-w-0 flex-col justify-end gap-1">
          <span
            className="mx-auto w-full bg-(--hl3)"
            style={{ height: `${visiblePercent((bar.value / safeMax) * 100)}%` }}
          />
          <span className="truncate text-center font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.1em] text-(--dim)">
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  );
}
