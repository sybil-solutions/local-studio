"use client";

import type { ReactNode } from "react";

export type ModelStatusTone = "default" | "good" | "warning" | "danger" | "info";

type ModelRowProps = {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

const statusClasses: Record<ModelStatusTone, string> = {
  default: "bg-(--surface) text-(--dim)",
  good: "bg-(--hl2)/10 text-(--hl2)",
  warning: "bg-(--hl3)/10 text-(--hl3)",
  danger: "bg-(--err)/10 text-(--err)",
  info: "bg-(--hl1)/10 text-(--hl1)",
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
      <div className="flex min-h-9 items-end justify-between gap-4 border-b border-(--border)/75 pb-2">
        <div className="min-w-0">
          <h3 className="text-[12px] font-medium text-(--fg)">{title}</h3>
          {description ? <p className="mt-0.5 text-[11px] text-(--dim)">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-(--border)/55">{children}</div>
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
    <div className="my-1 rounded-md bg-(--surface)/70 px-2 py-3">
      <div className="grid min-h-7 grid-cols-1 gap-2 md:grid-cols-[minmax(150px,0.44fr)_minmax(0,1fr)] md:items-center md:gap-5">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-(--fg)" title={label}>
            {label}
          </div>
          {description ? (
            <div className="mt-0.5 truncate text-[11px] text-(--dim)" title={description}>
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
      className={`truncate text-[12px] ${mono ? "font-mono" : ""} ${dim ? "text-(--dim)" : "text-(--fg)"}`}
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
    <span
      className={`inline-flex h-5 items-center rounded-[5px] px-1.5 text-[10px] font-medium ${statusClasses[tone]}`}
    >
      {children}
    </span>
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
      ? "bg-(--surface) text-(--fg) hover:bg-(--surface-2)"
      : tone === "danger"
        ? "text-(--err) hover:bg-(--err)/10"
        : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${classes}`}
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
      className={`h-7 w-full rounded-md border border-transparent bg-(--surface) px-2.5 text-[12px] text-(--fg) outline-none transition placeholder:text-(--dim)/65 focus:bg-(--bg) focus:ring-1 focus:ring-(--hl1)/60 ${className}`}
    />
  );
}
