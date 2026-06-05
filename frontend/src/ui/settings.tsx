"use client";

import type { ReactNode } from "react";
import { AppPage, PageHeader, RefreshIconButton, SectionNav, type SectionNavItem } from "./page";
import { ListGroup, ListRow, RowValue, EmptySafeNotice } from "./list";
import { StatusPill, type UiTone } from "./status";
import { cx } from "./utils";

export type SettingsSectionId = string;
export type StatusTone = UiTone;
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> =
  SectionNavItem<Id>;

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
  description?: ReactNode;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  variant?: "settings" | "resource";
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
    <AppPage>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[200px_minmax(0,640px)] lg:gap-10 lg:py-8">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h1 className="text-[length:var(--fs-xl)] font-semibold tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h1>
            <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
          </div>
          <SectionNav
            label={`${title} sections`}
            items={sections}
            activeItem={activeSection}
            onSelectItem={onSelectSection}
          />
        </aside>
        <section className="min-w-0 pb-10">
          <PageHeader eyebrow={eyebrow} title={activeLabel} status={status} />
          <div className="space-y-0">{children}</div>
        </section>
      </div>
    </AppPage>
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
    <ListGroup title={title} description={description} actions={actions}>
      {children}
    </ListGroup>
  );
}

export function SettingsRow(props: RowProps) {
  return <ListRow {...props} />;
}

export function SettingsValue({
  children,
  mono = false,
  dim = false,
  truncate = false,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
}) {
  return (
    <RowValue mono={mono} dim={dim} truncate={truncate}>
      {children}
    </RowValue>
  );
}

export type SettingsFactRow = {
  label: string;
  value: ReactNode;
  key?: string | number;
  description?: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  status?: { label: ReactNode; tone?: StatusTone };
  actions?: ReactNode;
  children?: ReactNode;
};

export function SettingsFactRows({ rows }: { rows: SettingsFactRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <SettingsRow
          key={row.key ?? row.label}
          label={row.label}
          description={row.description}
          value={
            <SettingsValue mono={row.mono} dim={row.dim} truncate={row.truncate}>
              {row.value}
            </SettingsValue>
          }
          status={
            row.status ? (
              <StatusPill tone={row.status.tone}>{row.status.label}</StatusPill>
            ) : undefined
          }
          actions={row.actions}
        >
          {row.children}
        </SettingsRow>
      ))}
    </>
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
      ? "bg-(--ui-fg)/90 text-(--ui-bg) hover:bg-(--ui-fg)"
      : tone === "danger"
        ? "text-(--ui-danger) hover:bg-(--ui-danger)/10"
        : "text-(--ui-muted) hover:text-(--ui-fg) hover:bg-(--ui-hover)";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[length:var(--fs-sm)] font-normal transition-colors disabled:pointer-events-none disabled:opacity-45",
        classes,
      )}
    >
      {children}
    </button>
  );
}

const noticeClasses: Record<UiTone, string> = {
  default: "border-(--ui-border) bg-(--ui-hover)/40 text-(--ui-muted)",
  good: "border-(--ui-success)/30 bg-(--ui-success)/10 text-(--ui-success)",
  warning: "border-(--ui-warning)/30 bg-(--ui-warning)/10 text-(--ui-warning)",
  danger: "border-(--ui-danger)/30 bg-(--ui-danger)/10 text-(--ui-danger)",
  info: "border-(--ui-info)/30 bg-(--ui-info)/10 text-(--ui-info)",
};

export function SettingsNotice({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: UiTone;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-md border px-3 py-2 text-[length:var(--fs-sm)] leading-relaxed",
        noticeClasses[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsActions({
  children,
  flush = false,
  className,
}: {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex justify-end gap-1", flush ? "" : "px-3.5 py-2", className)}>
      {children}
    </div>
  );
}

type SettingsControlTone = "accent" | "info";

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
      className={cx(
        "h-7 w-full rounded-md border border-(--ui-separator) bg-(--ui-bg) px-2.5 text-[length:var(--fs-base)] text-(--ui-fg) outline-none transition placeholder:text-(--ui-muted)/50 focus:border-(--ui-accent)/40",
        className,
      )}
    />
  );
}

export function SettingsTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className = "",
  focusTone = "accent",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  focusTone?: SettingsControlTone;
}) {
  const focusClass =
    focusTone === "info" ? "focus:border-(--ui-info)/50" : "focus:border-(--ui-accent)/40";

  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cx(
        "w-full resize-none rounded-md border border-(--ui-separator) bg-(--ui-bg) px-2.5 py-1.5 text-[length:var(--fs-base)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/50",
        focusClass,
        className,
      )}
    />
  );
}

export { EmptySafeNotice, StatusPill };
