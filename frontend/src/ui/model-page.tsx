"use client";

import type { ReactNode } from "react";
import { StatusPill, type UiTone } from "./status";
import { cx } from "./utils";

export type ModelStatusTone = UiTone;
export type ModelRowHighlight = "none" | "success";

export type ModelSummaryItem = {
  label: string;
  value: ReactNode;
};

type ModelRowProps = {
  label: string;
  description?: string;
  leading?: ReactNode;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  highlight?: ModelRowHighlight;
  className?: string;
  onClick?: () => void;
};

export function ModelSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="flex min-h-9 items-end justify-between gap-4 border-b border-(--ui-border)/75 pb-2">
        <div className="min-w-0">
          <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-(--ui-border)/55">{children}</div>
    </section>
  );
}

export function ModelActiveSummary({
  title,
  subtitle,
  leading,
  status,
  actions,
  details,
  progress,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  details?: ModelSummaryItem[];
  progress?: ReactNode;
}) {
  return (
    <div className="px-1 py-2">
      <div className="grid min-h-7 grid-cols-1 gap-2 md:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)] md:items-center md:gap-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading ? <span className="shrink-0 opacity-80">{leading}</span> : null}
          <div className="min-w-0">
            <div className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
              Active model
            </div>
            <div className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
              Controller-loaded recipe
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0 truncate font-mono text-[length:var(--fs-md)] text-(--ui-fg)"
                title={typeof title === "string" ? title : undefined}
              >
                {title}
              </div>
              {status ? <div className="shrink-0">{status}</div> : null}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
              {subtitle ? (
                <span
                  className="max-w-full truncate"
                  title={typeof subtitle === "string" ? subtitle : undefined}
                >
                  {subtitle}
                </span>
              ) : null}
              {details?.map((item) => (
                <span key={String(item.label)} className="shrink-0">
                  {item.label} <span className="text-(--ui-fg)">{item.value}</span>
                </span>
              ))}
            </div>
            {progress ? (
              <div className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{progress}</div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ModelRow({
  label,
  description,
  leading,
  value,
  control,
  status,
  actions,
  children,
  highlight = "none",
  className,
  onClick,
}: ModelRowProps) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={cx(
        "group px-1 py-2",
        interactive
          ? "cursor-pointer rounded-md transition-colors hover:bg-(--ui-hover)/35 focus:outline-none focus:ring-1 focus:ring-(--ui-info)/45"
          : "",
        highlight === "success" ? "model-row-shine" : "",
        className,
      )}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="grid min-h-7 grid-cols-1 gap-2 md:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)] md:items-center md:gap-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading ? <span className="shrink-0">{leading}</span> : null}
          <div className="min-w-0">
            <div
              className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)"
              title={label}
            >
              {label}
            </div>
            {description ? (
              <div
                className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--ui-muted)"
                title={description}
              >
                {description}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div
            className="min-w-0 flex-1"
            onClick={control && interactive ? (event) => event.stopPropagation() : undefined}
          >
            {control ?? value ?? <ModelValue dim>Not reported yet</ModelValue>}
          </div>
          {status ? (
            <div
              className="shrink-0"
              onClick={interactive ? (event) => event.stopPropagation() : undefined}
            >
              {status}
            </div>
          ) : null}
          {actions ? (
            <div
              className="flex shrink-0 items-center gap-1"
              onClick={interactive ? (event) => event.stopPropagation() : undefined}
            >
              {actions}
            </div>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-2 md:ml-[calc(180px+1.25rem)]">{children}</div> : null}
    </div>
  );
}

export function ModelValue({
  children,
  mono = false,
  dim = false,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={cx(
        "truncate text-[length:var(--fs-md)]",
        mono ? "font-mono" : "",
        dim ? "text-(--ui-muted)" : "text-(--ui-fg)",
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {children || "Not set"}
    </div>
  );
}

export function ModelStatus({
  tone = "default",
  children,
}: {
  tone?: ModelStatusTone;
  children: ReactNode;
}) {
  return (
    <StatusPill tone={tone} variant="dot" className="text-[length:var(--fs-xs)]">
      {children}
    </StatusPill>
  );
}

export function ModelButton({
  children,
  onClick,
  disabled,
  title,
  tone = "default",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
}) {
  const classes =
    tone === "primary"
      ? "text-(--ui-fg) hover:bg-(--ui-hover)"
      : tone === "danger"
        ? "text-(--ui-danger) hover:bg-(--ui-danger)/10"
        : "text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex h-6 items-center justify-center gap-1.5 rounded-md px-1.5 text-[length:var(--fs-sm)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
        classes,
      )}
    >
      {children}
    </button>
  );
}

export function ModelInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cx(
        "h-7 w-full rounded-md border border-transparent bg-(--ui-surface) px-2.5 text-[length:var(--fs-md)] text-(--ui-fg) outline-none transition placeholder:text-(--ui-muted)/65 focus:bg-(--ui-bg) focus:ring-1 focus:ring-(--ui-info)/60",
        className,
      )}
    />
  );
}
