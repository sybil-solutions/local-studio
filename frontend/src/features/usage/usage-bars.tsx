"use client";

import { cx } from "@/ui/utils";

/**
 * The page's only chart, and it is deliberately a row of divs.
 *
 * Everything else on Usage is an unbounded count, which belongs in a column of
 * a table where it can be read exactly. Two things are genuinely shapes rather
 * than numbers — when in the day the box is busy, and whether a model's traffic
 * is growing — and both are answered by relative bar heights, so they get bars.
 * Doing it with a charting library would buy axes and tooltips we do not want
 * and a bundle we would have to pay for on every page load.
 */
export type UsageBar = {
  key: string;
  /** Shown under the bar when `labels` is on; kept to two or three glyphs. */
  label: string;
  value: number;
  /** The full sentence, on hover — this is where the exact numbers live. */
  title: string;
};

export function UsageBarRow({
  bars,
  labels = false,
  heightClass = "h-24",
}: {
  bars: readonly UsageBar[];
  labels?: boolean;
  heightClass?: string;
}) {
  const peak = bars.reduce((max, bar) => Math.max(max, bar.value), 0);
  return (
    <div className="min-w-0">
      <div className={cx("flex items-end gap-[2px]", heightClass)}>
        {bars.map((bar) => (
          <div
            key={bar.key}
            title={bar.title}
            className="flex h-full flex-1 items-end"
            aria-label={bar.title}
          >
            <div
              className={cx(
                "w-full rounded-[2px] transition-colors",
                bar.value > 0 ? "bg-(--accent)/45 hover:bg-(--accent)/70" : "bg-(--ui-surface-2)",
              )}
              // A zero bar still draws a 2px floor: an empty hour is data, and a
              // gap in the row reads as a rendering failure instead.
              style={{ height: peak > 0 ? `${Math.max(2, (bar.value / peak) * 100)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      {labels ? (
        <div className="mt-1.5 flex gap-[2px]">
          {bars.map((bar, index) => (
            <span
              key={bar.key}
              className="flex-1 text-center text-[length:var(--fs-2xs)] tabular-nums text-(--dim)/60"
            >
              {index % 3 === 0 ? bar.label : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
