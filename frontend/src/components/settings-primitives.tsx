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

const pillDotClasses: Record<StatusTone, string> = {
  default: "bg-(--dim)",
  good: "bg-(--hl2)",
  warning: "bg-(--hl3)",
  danger: "bg-(--err)",
  info: "bg-(--hl1)",
};

const pillTextClasses: Record<StatusTone, string> = {
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
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[200px_minmax(0,640px)] lg:gap-10 lg:py-8">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-(--fg)">{title}</h1>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
              aria-label={refreshLabel}
              title={refreshLabel}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <nav
            aria-label={`${title} sections`}
            className="-mx-1 overflow-x-auto pb-1 lg:mx-0 lg:overflow-visible"
          >
            <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
              {sections.map((section) => {
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSelectSection(section.id)}
                    className={`group grid h-8 grid-cols-[18px_1fr] items-center gap-2.5 rounded-md px-2.5 text-left text-[12px] transition-colors lg:w-full ${active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"}`}
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
        </aside>
        <section className="min-w-0 pb-10">
          <div className="mb-5 flex min-h-8 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-(--dim)">{eyebrow}</div>
              <h2 className="mt-1 truncate text-[20px] font-medium tracking-[-0.02em] text-(--fg)">
                {activeLabel}
              </h2>
            </div>
            <span className="shrink-0 text-[11px] text-(--dim)">{status}</span>
          </div>
          <div className="space-y-0">{children}</div>
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
  // macOS-style inset grouped list: a small label above an elevated card, with
  // the explanatory text dropped to a footnote beneath it.
  return (
    <section className="mb-6 last:mb-0">
      {title || actions ? (
        <div className="mb-1.5 flex items-end justify-between gap-3 px-3.5">
          <h3 className="text-[12px] font-semibold tracking-[-0.005em] text-(--dim)">{title}</h3>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[10px] border border-(--border) bg-(--surface) [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:left-3.5 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-(--separator) [&>*]:relative">
        {children}
      </div>
      {description ? (
        <p className="mt-1.5 px-3.5 text-[11px] leading-relaxed text-(--dim)">{description}</p>
      ) : null}
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
  // Left-inset hairline dividers are drawn by the parent card (SettingsGroup)
  // so every child — rows and custom controls alike — is separated uniformly.
  return (
    <div className="flex min-h-[40px] items-center justify-between gap-4 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-(--fg)">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[11px] leading-relaxed text-(--dim)">{description}</div>
        ) : null}
        {children ? <div className="mt-1.5">{children}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {control ?? value ?? null}
        {status ? <div className="shrink-0">{status}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
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
      className={`text-[13px] ${mono ? "font-mono text-[12px]" : ""} ${dim ? "text-(--dim)" : "text-(--fg)/80"}`}
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
      className={`inline-flex items-center gap-1.5 text-[11px] font-normal ${pillTextClasses[tone]}`}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${pillDotClasses[tone]}`} />
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
      ? "bg-(--fg)/90 text-(--bg) hover:bg-(--fg)"
      : tone === "danger"
        ? "text-(--err) hover:bg-(--err)/10"
        : "text-(--dim) hover:text-(--fg) hover:bg-(--hover)";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-normal transition-colors disabled:pointer-events-none disabled:opacity-45 ${classes}`}
    >
      {children}
    </button>
  );
}

export function SettingsInput({
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`h-7 w-full rounded-md border border-(--separator) bg-(--bg) px-2.5 text-[13px] text-(--fg) outline-none transition placeholder:text-(--dim)/50 focus:border-(--accent)/40 ${className}`}
    />
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return <div className="px-3.5 py-2.5 text-[12px] leading-relaxed text-(--dim)">{children}</div>;
}
