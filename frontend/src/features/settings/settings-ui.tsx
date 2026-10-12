"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AppPage,
  Button,
  buttonClasses,
  Input,
  RefreshIconButton,
  StatusPill,
  type SectionNavItem,
  type UiTone,
} from "@/ui";
import { ChevronDown } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import { SettingsSectionNav, type SettingsNavGroup } from "./settings-section-nav";

export type SettingsSectionId = string;
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> =
  SectionNavItem<Id>;

type LayoutProps<Id extends SettingsSectionId = SettingsSectionId> = {
  sectionGroups: SettingsNavGroup<Id>[];
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
};

export function SettingsLayout<Id extends SettingsSectionId = SettingsSectionId>({
  sectionGroups,
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
  const active = sectionGroups
    .flatMap((group) => group.items)
    .find((section) => section.id === activeSection);
  const pageRef = useRef<HTMLElement>(null);
  const layoutWidth =
    width === "wide"
      ? "max-w-[92rem] lg:grid-cols-[11.5rem_minmax(0,68rem)]"
      : "max-w-[68rem] lg:grid-cols-[11.5rem_minmax(0,46rem)]";

  const selectSection = (section: Id) => {
    pageRef.current?.scrollTo({ top: 0, behavior: "instant" });
    onSelectSection(section);
  };

  return (
    <AppPage ref={pageRef}>
      <div
        className={cx(
          "mx-auto grid w-full grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:justify-center lg:gap-6 lg:py-5",
          layoutWidth,
        )}
      >
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start lg:border-r lg:border-(--ui-separator)/50 lg:pr-5">
          <div className="mb-3 hidden items-center justify-between gap-3 lg:flex">
            <h1 className="px-2 text-[length:var(--fs-md)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h1>
            {showRefresh ? (
              <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
            ) : null}
          </div>
          <SettingsSectionNav
            label={`${title} sections`}
            groups={sectionGroups}
            activeItem={activeSection}
            onSelectItem={selectSection}
          />
        </aside>
        <section className="min-w-0 pb-10">
          <header className="mb-5 flex min-h-[4.75rem] items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {eyebrow ? (
                <div className="mb-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{eyebrow}</div>
              ) : null}
              <h2 className="min-h-[1.75rem] text-[length:var(--fs-xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
                {active?.label ?? title}
              </h2>
              {active?.description ? (
                <p className="mt-1 min-h-[2.5rem] max-w-[38rem] text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted) line-clamp-2">
                  {active.description}
                </p>
              ) : (
                <div className="mt-1 min-h-[2.5rem]" aria-hidden />
              )}
            </div>
            {status || showRefresh ? (
              <div className="flex min-w-[6.5rem] shrink-0 items-center justify-end gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                {status ? <span className="truncate text-right">{status}</span> : null}
                {showRefresh ? (
                  <span className="lg:hidden">
                    <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
                  </span>
                ) : null}
              </div>
            ) : null}
          </header>
          <div className="min-h-[20rem]">{children}</div>
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
    <section className="mb-6 last:mb-0">
      <div className="mb-2 flex items-start justify-between gap-4 px-1">
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
              <h3 className="text-[length:var(--fs-base)] font-medium tracking-[-0.01em]">
                {title}
              </h3>
            </button>
          ) : (
            <h3 className="text-[length:var(--fs-base)] font-medium tracking-[-0.01em] text-(--ui-fg)">
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
        <div className="border-y border-(--ui-separator) [&>*+*]:border-t [&>*+*]:border-(--ui-separator)/80">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The settings label/value row.
 *
 * This used to be a pass-through to a generic `ListRow` in `src/ui`, kept there
 * from when several surfaces shared a row language. Those surfaces now speak
 * the catalog table language instead, so the generic layer had exactly one
 * caller wrapping it in another component of the same shape. The markup lives
 * here now, where the only page that renders it can be read in one file.
 */
export function SettingsRow({
  label,
  description,
  value,
  control,
  status,
  actions,
  children,
}: RowProps) {
  const primaryValue = control ?? value;

  return (
    <div className="rounded-md px-2 py-2 transition-colors hover:bg-(--ui-hover)/30">
      <div className="grid min-h-7 grid-cols-1 gap-1.5 md:grid-cols-[minmax(168px,0.3fr)_minmax(0,1fr)] md:items-center md:gap-4">
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
        <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(168px,0.3fr)_minmax(0,1fr)] md:gap-4">
          <div className="hidden md:block" />
          <div className="min-w-0">{children}</div>
        </div>
      ) : null}
    </div>
  );
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
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {value}
    </div>
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
  wrap?: boolean;
  status?: { label: ReactNode; tone?: UiTone };
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

export function SettingsLink({
  href,
  children,
  tone = "default",
  "aria-label": ariaLabel,
}: {
  href: string;
  children: ReactNode;
  tone?: "default" | "primary" | "danger";
  "aria-label"?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      style={
        tone === "primary"
          ? { color: "var(--color-primary-foreground)" }
          : tone === "danger"
            ? { color: "var(--destructive-foreground)" }
            : undefined
      }
      className={buttonClasses(
        tone === "primary" ? "primary" : tone === "danger" ? "danger" : "ghost",
        "sm",
      )}
    >
      {children}
    </a>
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

export { StatusPill };
