"use client";

import type { ReactNode } from "react";

/** Flat one-line context above a catalog table — no boxes, just a quiet separator. */
export function CatalogContextLine({
  primary,
  secondary,
  meta,
  actions,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ui-separator) pb-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
          {primary}
        </span>
        {secondary ? (
          <span className="min-w-0 truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {secondary}
          </span>
        ) : null}
      </div>
      {(meta ?? actions) ? (
        <div className="flex shrink-0 items-center gap-2.5">
          {meta ? (
            <span className="text-[length:var(--fs-xs)] tabular-nums text-(--ui-muted)/75">
              {meta}
            </span>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
