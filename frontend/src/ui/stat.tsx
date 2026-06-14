"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export function Stat({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "min-w-0 border-r border-(--ui-border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5",
        className,
      )}
    >
      <dt className="truncate font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--ui-muted)/75">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[length:var(--fs-xl)] leading-none tabular-nums text-(--ui-fg)">
        {value}
      </dd>
    </div>
  );
}
