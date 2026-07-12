"use client";

import Link from "next/link";
import { type ComponentType } from "react";
import {
  Gauge,
  Microchip,
  HardDrive,
  Globe,
  Wrench,
  MessageSquare,
  Plug,
} from "@/ui/icon-registry";

export type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export const tabs = [
  { href: "/", label: "Status", icon: Gauge },
  { href: "/agent", label: "Workbench", icon: MessageSquare },
  { href: "/recipes", label: "Models", icon: HardDrive },
  { href: "/configure", label: "Configure", icon: Wrench },
  { href: "/usage", label: "Usage", icon: Microchip },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/server", label: "Server", icon: Globe },
];

export function mobilePageTitle(pathname: string): string {
  if (pathname.startsWith("/agent")) return "Workbench";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/logs")) return "Logs";
  const tab = tabs.find((entry) => isRouteActive(pathname, entry.href));
  return tab?.label ?? "Local Studio";
}

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings");
  }
  return pathname.startsWith(href);
}

export function routeHidesAppSidebar(pathname: string): boolean {
  return (
    pathname.startsWith("/setup") ||
    pathname.startsWith("/download") ||
    pathname.startsWith("/agents") ||
    pathname.startsWith("/quick") ||
    pathname.startsWith("/landing") ||
    pathname.startsWith("/docs")
  );
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
      className={`group flex h-8 items-center gap-2.5 rounded-md px-2.5 transition-colors shrink-0 ${
        active
          ? "bg-(--color-surface-hover) font-medium text-(--fg)"
          : "text-(--fg)/90 hover:bg-(--color-surface-hover) hover:text-(--fg)"
      }`}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${active ? "text-(--fg)/85" : "opacity-60"}`}
        strokeWidth={1.75}
      />
      <span className="text-[length:var(--fs-lg)] whitespace-nowrap">{label}</span>
    </Link>
  );
}
