"use client";

import type { ReactNode } from "react";
import { StatusPill, type UiTone } from "./status";
import { cx } from "./utils";

export type ModelStatusTone = UiTone;

type ModelRowProps = {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
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
          <h3 className="text-[12px] font-medium text-(--ui-fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11px] text-(--ui-muted)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-(--ui-border)/55">{children}</div>
    </section>
  );
}

export function ModelRow({
  label,
  description,
  value,
  control,
  status,
  actions,
  children,
}: ModelRowProps) {
  return (
    <div className="group px-1 py-2.5 transition-colors hover:bg-(--ui-hover)/35">
      <div className="grid min-h-7 grid-cols-1 gap-2 md:grid-cols-[minmax(150px,0.44fr)_minmax(0,1fr)] md:items-center md:gap-5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-(--ui-fg)" title={label}>
            {label}
          </div>
          {description ? (
            <div className="mt-0.5 truncate text-[11px] text-(--ui-muted)" title={description}>
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {control ?? value ?? <ModelValue dim>Not reported yet</ModelValue>}
          </div>
          {status ? <div className="shrink-0">{status}</div> : null}
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      </div>
      {children ? <div className="mt-2 md:ml-[calc(150px+1.25rem)]">{children}</div> : null}
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
        "truncate text-[12px]",
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
    <StatusPill tone={tone} variant="dot" className="text-[10px]">
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
        "inline-flex h-6 items-center justify-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
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
        "h-7 w-full rounded-md border border-transparent bg-(--ui-surface) px-2.5 text-[12px] text-(--ui-fg) outline-none transition placeholder:text-(--ui-muted)/65 focus:bg-(--ui-bg) focus:ring-1 focus:ring-(--ui-info)/60",
        className,
      )}
    />
  );
}
