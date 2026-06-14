"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "mb-3 font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--ui-muted)/75",
        className,
      )}
    >
      {children}
    </div>
  );
}
