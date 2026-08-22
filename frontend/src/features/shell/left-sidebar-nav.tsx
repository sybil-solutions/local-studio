"use client";

import Link from "next/link";
import { type ComponentType, type MouseEvent } from "react";
import {
  AutomationsIcon,
  ConfigureIcon,
  IntegrationsIcon,
  ModelsIcon,
  StatusIcon,
  UsageIcon,
} from "@/ui/icon-registry";

export type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

// Sessions has no nav row: the Search command palette is the session list.
//
// Integrations sits between Automations and Configure because the rail reads
// top to bottom as widening scope: what is running, what it can run, what runs
// on its own, what it can reach outside this machine, and only then the
// machine's own settings.
export const tabs = [
  { href: "/", label: "Status", icon: StatusIcon },
  { href: "/models", label: "Models", icon: ModelsIcon },
  { href: "/agent/automations", label: "Automations", icon: AutomationsIcon },
  { href: "/integrations", label: "Integrations", icon: IntegrationsIcon },
  { href: "/configure", label: "Configure", icon: ConfigureIcon },
  { href: "/usage", label: "Usage", icon: UsageIcon },
];

export function mobilePageTitle(pathname: string): string {
  if (pathname.startsWith("/agent/automations")) return "Automations";
  if (pathname.startsWith("/agent")) return "Tasks";
  if (pathname.startsWith("/logs")) return "Logs";
  const tab = tabs.find((entry) => isRouteActive(pathname, entry.href));
  return tab?.label ?? "Local Studio";
}

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/agent") {
    return pathname.startsWith("/agent") && !pathname.startsWith("/agent/automations");
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings");
  }
  return pathname.startsWith(href);
}

export function routeHidesAppSidebar(pathname: string): boolean {
  return pathname.startsWith("/setup");
}

// Exactly one thing may name the current surface on a phone. Agent routes draw
// their own full-width header — the chat pane and the automations list both
// have a bar with the hamburger in it — so the app topbar would be a second
// stacked row there. Everywhere else the topbar is the only chrome.
//
// Deliberately not `isRouteActive(pathname, "/agent")`: that predicate excludes
// /agent/automations so the Automations nav row stays lit, which is the wrong
// question to ask about chrome ownership.
export function routeOwnsMobileHeader(pathname: string): boolean {
  return pathname.startsWith("/agent");
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
      className={`group flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 transition-colors ${
        active ? "bg-(--active) text-(--fg)" : "text-(--fg)/85 hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${active ? "opacity-90" : "opacity-70"}`}
        strokeWidth={1.6}
      />
      <span className="text-[length:var(--fs-md)] whitespace-nowrap">{label}</span>
    </Link>
  );
}
