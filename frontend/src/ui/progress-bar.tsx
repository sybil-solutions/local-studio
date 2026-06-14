"use client";

import { cx } from "./utils";

export function ProgressBar({
  progress,
  className,
  trackClassName,
  barClassName,
}: {
  progress: number;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
}) {
  const pct = Math.min(100, Math.max(0, progress));
  return (
    <div
      className={cx(
        "h-1 w-full overflow-hidden rounded-full bg-(--ui-fg)/15",
        className,
        trackClassName,
      )}
    >
      <div
        className={cx(
          "h-full rounded-full bg-(--ui-fg)/40 transition-all duration-300",
          barClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
