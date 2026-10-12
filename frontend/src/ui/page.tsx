"use client";

import { forwardRef, type ReactNode } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { cx } from "./utils";
import { Tabs, type TabItem } from "./tabs";

export type SectionNavItem<Id extends string = string> = {
  id: Id;
  label: string;
  description: string;
  icon: ReactNode;
};

export const AppPage = forwardRef<HTMLElement, { children: ReactNode; className?: string }>(
  function AppPage({ children, className }, ref) {
    return (
      <main
        ref={ref}
        className={cx(
          "min-h-full overflow-y-auto overflow-x-hidden bg-(--ui-bg) text-(--ui-fg) [scrollbar-gutter:stable]",
          className,
        )}
      >
        {children}
      </main>
    );
  },
);

export type PageWidth = "sm" | "md" | "lg" | "xl";

const pageWidthClasses: Record<PageWidth, string> = {
  sm: "max-w-[64rem]",
  md: "max-w-[86rem]",
  lg: "max-w-[92rem]",
  xl: "max-w-[118rem]",
};

export function PageContainer({
  width = "md",
  children,
  className,
}: {
  width?: PageWidth;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-5",
        pageWidthClasses[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  status,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
      <div className="min-w-0">
        {/* The phone topbar already names this surface, so showing the title
            again here is the second of two chromes. Keep it for screen readers
            and for desktop, where there is no topbar. */}
        <h2 className="sr-only truncate text-[length:var(--fs-3xl)] font-medium tracking-[-0.02em] text-(--ui-fg) md:not-sr-only">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[length:var(--fs-md)] text-(--ui-muted)">{description}</p>
        ) : null}
      </div>
      {(actions ?? status) ? (
        <div className="flex shrink-0 items-center gap-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
          {status}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function TabbedPage<T extends string = string>({
  title,
  description,
  actions,
  width = "sm",
  compact = false,
  tabs,
  activeTab,
  onSelectTab,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  width?: PageWidth;
  /** Tighter header rhythm for data-heavy pages like Models. */
  compact?: boolean;
  tabs: TabItem<T>[];
  activeTab: T;
  onSelectTab: (tab: T) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AppPage>
      <PageContainer
        width={width}
        className={cx(compact ? "pt-4 sm:pt-5" : "pt-6 sm:pt-8", className)}
      >
        <PageHeader title={title} description={description} actions={actions} />
        <div className={cx(compact ? "mt-4" : "mt-7", "border-b border-(--ui-separator)")}>
          <Tabs items={tabs} activeTab={activeTab} onSelectTab={onSelectTab} className="-mb-px" />
        </div>
        <div className={compact ? "mt-5" : "mt-8"}>{children}</div>
      </PageContainer>
    </AppPage>
  );
}

export function RefreshIconButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--ui-muted) transition-[transform,color,background-color] hover:bg-(--ui-hover) hover:text-(--ui-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35 active:translate-y-px disabled:opacity-50"
      aria-label={label}
      title={label}
    >
      <RefreshCw className={cx("h-3.5 w-3.5", loading ? "animate-spin" : "")} />
    </button>
  );
}
