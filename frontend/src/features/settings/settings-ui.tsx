"use client";

import { useState, type ReactNode } from "react";
import {
  AppPage,
  Button,
  Input,
  RefreshIconButton,
  SectionNav,
  ListRow,
  RowValue,
  EmptySafeNotice,
  StatusPill,
  type SectionNavItem,
  type UiTone,
} from "@/ui";
import { ChevronDown } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";

export type SettingsSectionId = string;
export type StatusTone = UiTone;
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> =
  SectionNavItem<Id>;

type LayoutProps<Id extends SettingsSectionId = SettingsSectionId> = {
  sections: SettingsSectionDef<Id>[];
  activeSection: Id;
  title: string;
  status?: ReactNode;
  loading: boolean;
  onReload: () => void;
  onSelectSection: (section: Id) => void;
  eyebrow?: string;
  refreshLabel?: string;
  showRefresh?: boolean;
  width?: "default" | "wide";
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
  eyebrow,
  refreshLabel = `Refresh ${title.toLowerCase()}`,
  showRefresh = true,
  width = "default",
  children,
}: LayoutProps<Id>) {
  const active = sections.find((section) => section.id === activeSection);
  const layoutWidth =
    width === "wide"
      ? "max-w-[96rem] lg:grid-cols-[176px_minmax(0,70rem)]"
      : "max-w-[72rem] lg:grid-cols-[176px_minmax(0,48rem)]";

  return (
    <AppPage>
      <div
        className={cx(
          "mx-auto grid w-full grid-cols-1 gap-6 px-4 py-5 sm:px-6 lg:justify-center lg:gap-10 lg:py-8",
          layoutWidth,
        )}
      >
        <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
          <div className="mb-5 hidden items-center justify-between gap-3 px-2 lg:flex">
            <h1 className="text-[length:var(--fs-xl)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h1>
            {showRefresh ? (
              <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
            ) : null}
          </div>
          <SectionNav
            label={`${title} sections`}
            items={sections}
            activeItem={activeSection}
            onSelectItem={onSelectSection}
          />
        </aside>
        <section className="min-w-0 pb-12">
          <header className="mb-8 flex min-h-8 items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow ? (
                <div className="mb-1 text-[length:var(--fs-xs)] uppercase tracking-[0.14em] text-(--ui-muted)">
                  {eyebrow}
                </div>
              ) : null}
              <h2 className="text-[length:var(--fs-2xl)] font-normal tracking-[-0.015em] text-(--ui-fg)">
                {active?.label ?? title}
              </h2>
              {active?.description ? (
                <p className="mt-1 max-w-[42rem] text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
                  {active.description}
                </p>
              ) : null}
            </div>
            {status || showRefresh ? (
              <div className="flex shrink-0 items-center gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                {status}
                {showRefresh ? (
                  <span className="lg:hidden">
                    <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
                  </span>
                ) : null}
              </div>
            ) : null}
          </header>
          <div>{children}</div>
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
  collapsible,
  defaultOpen,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const showBody = collapsible ? open : true;

  return (
    <section className="mb-10 last:mb-0">
      <div className="mb-3 flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="group flex items-center gap-1.5 text-(--ui-fg)"
            >
              <ChevronDown
                className={cx(
                  "h-3.5 w-3.5 text-(--ui-muted) transition-transform",
                  open ? "" : "-rotate-90",
                )}
                aria-hidden
              />
              <h3 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em]">{title}</h3>
            </button>
          ) : (
            <h3 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h3>
          )}
          {description ? (
            <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {showBody ? (
        <div className="border-y border-(--ui-separator) [&>*+*]:border-t [&>*+*]:border-(--ui-separator)">
          {children}
        </div>
      ) : null}
    </section>
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
  wrap = false,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
}) {
  return (
    <RowValue mono={mono} dim={dim} truncate={truncate} wrap={wrap}>
      {children}
    </RowValue>
  );
}

export type SettingsFactRow = {
  label: string;
  value: ReactNode;
  key?: string | number;
  description?: ReactNode;
  variant?: "settings" | "resource";
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
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
          variant={row.variant}
          label={row.label}
          description={row.description}
          value={
            <SettingsValue mono={row.mono} dim={row.dim} truncate={row.truncate} wrap={row.wrap}>
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
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
  "aria-label"?: string;
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      size="sm"
      variant={tone === "primary" ? "primary" : tone === "danger" ? "danger" : "ghost"}
    >
      {children}
    </Button>
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

export function SettingsInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  className = "",
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cx("h-8", className)}
    />
  );
}

export { EmptySafeNotice, StatusPill };
