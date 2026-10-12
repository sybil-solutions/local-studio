"use client";

import Link from "next/link";
import { type ComponentType, type MouseEvent, type ReactNode } from "react";
import { Activity, Layers, Plus, Zap } from "@/ui/icon-registry";

export type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export const tabs = [
  { href: "/", label: "Status", icon: Activity },
  { href: "/models", label: "Models", icon: Layers },
  { href: "/agent/automations", label: "Automations", icon: Zap },
];

export function mobilePageTitle(pathname: string): string {
  if (pathname.startsWith("/agent/automations")) return "Automations";
  if (pathname.startsWith("/agent")) return "Tasks";
  if (pathname.startsWith("/settings")) return "Settings";
  const tab = tabs.find((entry) => isRouteActive(pathname, entry.href));
  return tab?.label ?? "Local Studio";
}

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/agent") {
    return pathname.startsWith("/agent") && !pathname.startsWith("/agent/automations");
  }
  if (href === "/agent/automations") return pathname.startsWith("/agent/automations");
  if (href === "/settings") return pathname.startsWith("/settings");
  return pathname.startsWith(href);
}

export function routeHidesAppSidebar(pathname: string): boolean {
  return pathname.startsWith("/setup") || pathname.startsWith("/quick");
}

export function routeOwnsMobileHeader(pathname: string): boolean {
  return pathname.startsWith("/agent");
}

export function ProjectsNavPlaceholder() {
  return (
    <div className="px-2 py-1 text-[length:var(--fs-md)] text-(--dim)">Loading projects...</div>
  );
}

export function NavNewTaskMobile({
  onClick,
}: {
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href="/agent?new=1&replace=1"
      prefetch={false}
      onClick={onClick}
      className="mb-2 flex h-11 items-center gap-3 rounded-lg border border-(--border)/70 bg-(--surface-2)/25 px-3 text-[15px] text-(--fg)/90 transition-colors active:bg-(--hover)"
    >
      <Plus className="h-5 w-5 shrink-0 opacity-80" strokeWidth={1.75} />
      <span>New task</span>
    </Link>
  );
}

export function NavItemMobile({
  href,
  label,
  Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  Icon: IconComponent;
  active: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onClick}
      className={`flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors ${
        active ? "bg-(--active) font-medium text-(--fg)" : "text-(--fg)/80 active:bg-(--hover)"
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.6} />
      <span>{label}</span>
    </Link>
  );
}

export function SidebarNavSeparator() {
  return <div className="mx-2 my-1 shrink-0 border-t border-(--border)/50" role="separator" />;
}

export function NavItemDesktop({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: IconComponent;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 ${
        active
          ? "bg-(--active) font-medium text-(--fg)"
          : "text-(--fg)/70 hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.6} />
      <span className="truncate text-[length:var(--fs-md)]">{label}</span>
    </Link>
  );
}

export function NavNewTaskDesktop({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="New task (⌘N)"
      className="group mb-1 flex h-[var(--sidebar-row-height)] w-full shrink-0 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 text-left text-(--fg)/85 hover:bg-(--hover) hover:text-(--fg)"
    >
      <Plus className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.6} />
      <span className="truncate text-[length:var(--fs-md)] font-medium">New task</span>
      <span className="ml-auto shrink-0 text-[length:var(--fs-2xs)] tabular-nums text-(--hl2) opacity-0 transition-opacity group-hover:opacity-100">
        ⌘N
      </span>
    </button>
  );
}

export function NavDestinationsStrip({
  pathname,
  onNewTask,
}: {
  pathname: string;
  onNewTask?: () => void;
}) {
  return (
    <div className="shrink-0 px-[var(--sidebar-padding-x)] pb-1 pt-0.5">
      {onNewTask ? <NavNewTaskDesktop onClick={onNewTask} /> : null}
      <div className="flex flex-col gap-px">
        {tabs.map((tab) => (
          <NavItemDesktop
            key={tab.href}
            href={tab.href}
            label={tab.label}
            Icon={tab.icon}
            active={isRouteActive(pathname, tab.href)}
          />
        ))}
      </div>
      <SidebarNavSeparator />
    </div>
  );
}

export function NavIconButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? "bg-(--active) text-(--fg)" : "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}
