"use client";

// Shared instrument primitives for the right panel's Status tab.
//
// The panel is a dense hairline sheet: label on the left, mono value on the
// right, one hairline per group. What it lacked was proportion — "184k / 256k"
// and "71 °C" are both just text, so nothing on the sheet showed how close to
// a limit anything was. Meter draws that as a 2px rule under the row, which
// reads at a glance without spending a single extra line of height.

import type { ReactNode } from "react";
import { cx } from "@/ui/utils";

export type MeterTone = "ok" | "warn" | "err" | "dim";

const METER_FILL: Record<MeterTone, string> = {
  ok: "bg-(--ok)",
  warn: "bg-(--warn)",
  err: "bg-(--err)",
  dim: "bg-(--fg)/35",
};

const VALUE_TONE: Record<MeterTone, string> = {
  ok: "text-(--fg)",
  warn: "text-(--warn)",
  err: "text-(--err)",
  dim: "text-(--fg)",
};

/** Fraction of a limit, as a tone. Thresholds match the composer's budget
 *  colouring so "getting full" looks the same everywhere in the app. */
export function fractionTone(fraction: number): MeterTone {
  if (!Number.isFinite(fraction) || fraction <= 0) return "dim";
  if (fraction >= 0.9) return "err";
  if (fraction >= 0.75) return "warn";
  return "ok";
}

/** Temperature has absolute meaning, not proportional: 85 °C is hot on every
 *  card, so it is banded rather than scaled against a maximum. */
export function temperatureTone(celsius: number): MeterTone {
  if (!Number.isFinite(celsius) || celsius <= 0) return "dim";
  if (celsius >= 85) return "err";
  if (celsius >= 75) return "warn";
  return "ok";
}

export function StatusGroup({
  title,
  count,
  right,
  children,
}: {
  title: string;
  count?: number;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-(--border) pt-2.5">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[length:var(--fs-xs)] font-medium uppercase tracking-wide text-(--fg)/45">
          {title}
        </span>
        {typeof count === "number" ? (
          <span className="font-mono text-[length:var(--fs-xs)] text-(--fg)/30">{count}</span>
        ) : null}
        {right ? <span className="ml-auto">{right}</span> : null}
      </div>
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

export function StatusLine({
  label,
  value,
  title,
  tone = "ok",
  /** 0..1. Omitted means no meter — most rows are plain facts. */
  fraction,
}: {
  label: string;
  value: string;
  title?: string;
  tone?: MeterTone;
  fraction?: number;
}) {
  const width = typeof fraction === "number" ? Math.max(0, Math.min(1, fraction)) * 100 : null;
  return (
    <div className="py-0.5">
      <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-3">
        <span className="truncate text-[length:var(--fs-xs)] text-(--fg)/45">{label}</span>
        <span
          className={cx(
            "min-w-0 truncate text-right font-mono text-[length:var(--fs-sm)] tabular-nums",
            VALUE_TONE[tone],
          )}
          title={title ?? value}
        >
          {value}
        </span>
      </div>
      {width === null ? null : (
        <div className="mt-1 h-px w-full bg-(--fg)/[0.07]">
          <div
            className={cx("h-px transition-[width]", METER_FILL[tone])}
            style={{ width: `${width}%` }}
          />
        </div>
      )}
    </div>
  );
}
