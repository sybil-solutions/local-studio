"use client";

import Link from "next/link";
import { type ComponentType } from "react";
import { Activity, Clock, MessageSquare, Rows2, ServerCog, TrendingUp } from "@/ui/icon-registry";

export type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export const tabs = [
  { href: "/", label: "Status", icon: Activity },
  { href: "/agent", label: "Workbench", icon: MessageSquare },
  { href: "/agent/sessions", label: "Sessions", icon: Rows2 },
  { href: "/agent/automations", label: "Automations", icon: Clock },
  { href: "/configure", label: "Configure", icon: ServerCog },
  { href: "/usage", label: "Usage", icon: TrendingUp },
];

export function mobilePageTitle(pathname: string): string {
  if (pathname.startsWith("/agent/automations")) return "Automations";
  if (pathname.startsWith("/agent/sessions")) return "Sessions";
  if (pathname.startsWith("/agent")) return "Workbench";
  if (pathname.startsWith("/logs")) return "Logs";
  const tab = tabs.find((entry) => isRouteActive(pathname, entry.href));
  return tab?.label ?? "Local Studio";
}

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/agent") {
    return (
      pathname.startsWith("/agent") &&
      !pathname.startsWith("/agent/automations") &&
      !pathname.startsWith("/agent/sessions")
    );
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings");
  }
  return pathname.startsWith(href);
}

export function routeHidesAppSidebar(pathname: string): boolean {
  return pathname.startsWith("/setup") || pathname.startsWith("/quick");
}

export function ProjectsNavPlaceholder() {
  return (
    <div className="px-2 py-1 text-[length:var(--fs-md)] text-(--dim)">Loading projects...</div>
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
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onClick}
      className={`mb-1 flex h-12 items-center gap-3 border-l-2 px-2 text-sm font-medium transition-colors ${
        active
          ? "border-(--accent) text-(--fg)"
          : "border-transparent text-(--dim) hover:text-(--fg)"
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
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
      className={`group flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 transition-colors ${
        active ? "bg-(--active) text-(--fg)" : "text-(--fg) hover:bg-(--hover)"
      }`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${active ? "opacity-90" : "opacity-70"}`}
        strokeWidth={1.75}
      />
      <span className="text-[length:var(--fs-md)] whitespace-nowrap">{label}</span>
    </Link>
  );
}
