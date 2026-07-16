"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export function ListRow({
  label,
  description,
  value,
  control,
  status,
  actions,
  children,
  className,
  variant = "settings",
}: {
  label: string;
  description?: ReactNode;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  variant?: "settings" | "resource";
}) {
  const primaryValue = control ?? value;

  if (variant === "resource") {
    return (
      <div className={cx("px-4 py-3.5 transition-colors hover:bg-(--ui-hover)/35", className)}>
        <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <div
                className="min-w-0 break-words text-[length:var(--fs-base)] font-medium leading-snug text-(--ui-fg)"
                title={label}
              >
                {label}
              </div>
            </div>
            {description ? (
              <div className="line-clamp-2 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
                {description}
              </div>
            ) : null}
          </div>
          {status || actions ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end sm:pt-0.5">
              {status ? <div className="shrink-0">{status}</div> : null}
              {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
            </div>
          ) : null}
        </div>
        {primaryValue ? <div className="mt-2 min-w-0 text-(--ui-muted)">{primaryValue}</div> : null}
        {children ? (
          <div className="mt-2 min-w-0 space-y-1.5 border-t border-(--ui-separator)/70 pt-2 text-[length:var(--fs-sm)] leading-relaxed">
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cx("px-4 py-3 transition-colors hover:bg-(--ui-hover)/35", className)}>
      <div className="grid min-h-7 grid-cols-1 gap-1.5 md:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)] md:items-center md:gap-5">
        <div className="min-w-0">
          <div
            className="truncate text-[length:var(--fs-base)] font-medium text-(--ui-fg)"
            title={label}
          >
            {label}
          </div>
          {description ? (
            <div className="mt-0.5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {primaryValue ? <div className="min-w-0 flex-1">{primaryValue}</div> : null}
          {status ? <div className="shrink-0">{status}</div> : null}
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      </div>
      {children ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)] md:gap-5">
          <div className="hidden md:block" />
          <div className="min-w-0">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function RowValue({
  children,
  mono = false,
  dim = false,
  truncate = false,
  wrap = false,
  className,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
  className?: string;
}) {
  const value =
    children === null || children === undefined || children === "" ? "Not set" : children;
  return (
    <div
      className={cx(
        "text-[length:var(--fs-base)]",
        mono ? "font-mono text-[length:var(--fs-md)]" : "",
        dim ? "text-(--ui-muted)" : "text-(--ui-fg)/80",
        truncate ? "min-w-0 truncate" : "",
        wrap && !truncate ? "min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]" : "",
        className,
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {value}
    </div>
  );
}

export type RowFact = {
  label: string;
  value: ReactNode;
  mono?: boolean;
  title?: string;
  truncate?: boolean;
};

export function RowFacts({ items, className }: { items: RowFact[]; className?: string }) {
  return (
    <dl
      className={cx(
        "grid min-w-0 grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[6rem_minmax(0,1fr)]",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-[length:var(--fs-xs)] font-medium uppercase text-(--ui-muted)/70">
            {item.label}
          </dt>
          <dd
            className={cx(
              "min-w-0 text-[length:var(--fs-sm)] text-(--ui-fg)/80",
              item.mono ? "font-mono" : "",
              item.truncate ? "truncate" : "break-words",
            )}
            title={item.title ?? (typeof item.value === "string" ? item.value : undefined)}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type RowDetailTone = "muted" | "warning" | "danger";
type RowDetailSize = "inherit" | "sm" | "md";

const rowDetailToneClass: Record<RowDetailTone, string> = {
  muted: "text-(--ui-muted)",
  warning: "text-(--ui-warning)",
  danger: "text-(--ui-danger)/80",
};

const rowDetailSizeClass: Record<RowDetailSize, string> = {
  inherit: "",
  sm: "text-[length:var(--fs-sm)]",
  md: "text-[length:var(--fs-md)]",
};

export function RowDetailLine({
  children,
  tone = "muted",
  size = "inherit",
  mono = false,
  truncate = false,
  clamp = false,
  title,
  className,
}: {
  children: ReactNode;
  tone?: RowDetailTone;
  size?: RowDetailSize;
  mono?: boolean;
  truncate?: boolean;
  clamp?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <p
      className={cx(
        rowDetailToneClass[tone],
        rowDetailSizeClass[size],
        mono ? "font-mono" : "",
        truncate ? "truncate" : "",
        clamp ? "line-clamp-3 whitespace-pre-wrap" : "",
        className,
      )}
      title={title ?? (typeof children === "string" ? children : undefined)}
    >
      {children}
    </p>
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 py-2.5 text-[length:var(--fs-md)] leading-relaxed text-(--ui-muted)">
      {children}
    </div>
  );
}

export function KeyValueRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 text-xs", className)}>
      <dt className="text-(--ui-muted)">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-(--ui-fg)">{value}</dd>
    </div>
  );
}
