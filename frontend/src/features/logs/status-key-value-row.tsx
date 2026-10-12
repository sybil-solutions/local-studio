"use client";

import type { ReactNode } from "react";
import { cx } from "@/ui/utils";

/**
 * The key/value line the server status groups are built from.
 *
 * It used to sit in a generic `src/ui/list` module alongside two other row
 * languages. Every other consumer of that module has since moved to the
 * catalog table language, leaving this one page as the sole caller — so the
 * row lives with the page that draws it rather than pretending to be a shared
 * primitive.
 */
export function StatusKeyValueRow({
  label,
  value,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "ok" | "error";
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 text-[length:var(--fs-xs)]",
        className,
      )}
    >
      <dt className="text-(--ui-muted)">{label}</dt>
      <dd
        className={cx(
          "min-w-0 truncate text-right font-mono",
          tone === "ok" ? "text-(--ok)" : tone === "error" ? "text-(--err)" : "text-(--ui-fg)",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
