"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

export type SettingsSectionId = string;
export type StatusTone = "default" | "good" | "warning" | "danger" | "info";
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> = {
  id: Id;
  label: string;
  description: string;
  icon: ReactNode;
};

type LayoutProps<Id extends SettingsSectionId = SettingsSectionId> = {
  sections: SettingsSectionDef<Id>[];
  activeSection: Id;
  title: string;
  status: string;
  loading: boolean;
  onReload: () => void;
  onSelectSection: (section: Id) => void;
  eyebrow?: string;
  refreshLabel?: string;
  children: ReactNode;
};

type RowProps = {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

const pillClasses: Record<StatusTone, string> = {
  default: "text-(--dim)",
  good: "text-(--hl2)",
  warning: "text-(--hl3)",
  danger: "text-(--err)",
  info: "text-(--hl1)",
};

export function SettingsLayout<Id extends SettingsSectionId = SettingsSectionId>({
  sections,
  activeSection,
  title,
  status,
  loading,
  onReload,
  onSelectSection,
  eyebrow = title,
  refreshLabel = `Refresh ${title.toLowerCase()}`,
  children,
}: LayoutProps<Id>) {
  const activeLabel = sections.find((section) => section.id === activeSection)?.label ?? title;
  return (
    <main className="min-h-full overflow-y-auto overflow-x-hidden bg-(--bg) text-(--fg)">
      <div className="mx-auto w-full max-w-[880px] px-3 py-4 sm:px-5 lg:py-6">
        <header className="mb-4 pb-2">
          <div className="flex min-h-8 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] text-(--dim)">{eyebrow}</div>
              <h1 className="mt-1 truncate text-[18px] font-semibold tracking-[-0.015em] text-(--fg)">
                {activeLabel}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-(--dim)">{status}</span>
              <button
                type="button"
                onClick={onReload}
                disabled={loading}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-(--dim) transition-colors hover:text-(--fg) disabled:opacity-50"
                aria-label={refreshLabel}
                title={refreshLabel}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <nav aria-label={`${title} sections`} className="-mx-1 mt-3 overflow-x-auto pb-1">
            <div className="flex min-w-max items-center gap-1">
              {sections.map((section) => {
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSelectSection(section.id)}
                    className={`group grid h-7 grid-cols-[16px_1fr] items-center gap-1.5 px-1.5 text-left text-[12px] transition-colors ${
                      active
                        ? "text-(--fg) underline decoration-(--dim) underline-offset-4"
                        : "text-(--dim) hover:text-(--fg)"
                    }`}
                    title={section.description}
                  >
                    <span className="flex h-4 w-4 items-center justify-center opacity-80">
                      {section.icon}
                    </span>
                    <span className="truncate">{section.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </header>
        <section className="min-w-0 pb-10">
          <div className="space-y-6">{children}</div>
        </section>
      </div>
    </main>
  );
}

export function SettingsGroup({
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
    <section className="pt-1">
      <div className="flex min-h-10 items-start justify-between gap-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-(--fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-4 text-(--dim)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  value,
  control,
  status,
  actions,
  children,
}: RowProps) {
  return (
    <div className="py-2">
      <div className="flex min-h-8 flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 text-[12px] font-medium text-(--fg)">{label}</div>
          {status || actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {status}
              {actions}
            </div>
          ) : null}
        </div>
        {description ? (
          <div className="text-[11px] leading-4 text-(--dim)">{description}</div>
        ) : null}
        <div className="min-w-0">
          {control ?? value ?? <SettingsValue dim>Not reported yet</SettingsValue>}
        </div>
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function SettingsValue({
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
      className={`whitespace-normal break-words text-[12px] leading-4 ${mono ? "break-all font-mono" : ""} ${dim ? "text-(--dim)" : "text-(--fg)"}`}
      title={typeof children === "string" ? children : undefined}
    >
      {children || "Not set"}
    </div>
  );
}

export function StatusPill({
  tone = "default",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-5 items-center text-[10px] font-semibold uppercase tracking-[0.08em] ${pillClasses[tone]}`}
    >
      {children}
    </span>
  );
}

export function SettingsButton({
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
      ? "bg-(--fg) text-(--bg) hover:opacity-90"
      : tone === "danger"
        ? "text-(--err) hover:bg-(--err)/10"
        : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-7 items-center justify-center gap-1.5 px-2 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${classes}`}
    >
      {children}
    </button>
  );
}

export function SettingsInput({
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
      className={`h-8 w-full border-0 border-b border-(--border)/70 bg-transparent px-0.5 text-[12px] text-(--fg) outline-none transition placeholder:text-(--dim)/65 focus:border-(--hl1) ${className}`}
    />
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return (
    <div className="py-1 text-[11px] leading-4 text-(--dim)">
      {children}
    </div>
  );
}
