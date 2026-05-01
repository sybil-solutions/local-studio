"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Database,
  HardDrive,
  Server,
  Settings,
  Sun,
  Moon,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store";
import { useSidebarStatus } from "@/hooks/use-sidebar-status";
import { useModelLifecycle } from "@/hooks/use-model-lifecycle";
import { ProjectsNavSection } from "@/components/projects-nav-section";
import { ModelStopConfirm } from "@/components/model-stop-confirm";

const tabs = [
  { href: "/", label: "Status", icon: BarChart3 },
  { href: "/usage", label: "Usage", icon: Database },
  { href: "/recipes", label: "Models", icon: HardDrive },
  { href: "/logs", label: "Server", icon: Server },
  { href: "/configs", label: "Settings", icon: Settings },
];

function LogoMark() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="w-6 h-6 shrink-0 text-(--fg)"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <rect x="6" y="6" width="36" height="36" />
      <rect x="14" y="13.5" width="5" height="5" />
      <rect x="21" y="21" width="6" height="6" fill="currentColor" stroke="none" />
      <rect x="29" y="13.5" width="5" height="5" />
      <rect x="29" y="29.5" width="5" height="5" />
      <rect x="14" y="29.5" width="5" height="5" />
      <line x1="16.5" y1="16" x2="24" y2="24" />
      <line x1="31.5" y1="16" x2="24" y2="24" />
      <line x1="16.5" y1="32" x2="24" y2="24" />
      <line x1="31.5" y1="32" x2="24" y2="24" />
      <line x1="16.5" y1="16" x2="31.5" y2="32" />
      <line x1="31.5" y1="16" x2="16.5" y2="32" />
    </svg>
  );
}

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "/discover";
  }
  return pathname.startsWith(href);
}

/**
 * Left navigation rail. Collapsed to 56px by default, expands to 208px on
 * hover. Mobile (<768px) flips to a 56px bottom tab bar with a 40px top
 * strip for logo/theme/status.
 */
export function LeftSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { desktopSidebarPinnedOpen, setDesktopSidebarPinnedOpen } = useAppStore(
    useShallow((s) => ({
      desktopSidebarPinnedOpen: s.desktopSidebarPinnedOpen,
      setDesktopSidebarPinnedOpen: s.setDesktopSidebarPinnedOpen,
    })),
  );
  const isExpanded = desktopSidebarPinnedOpen;

  if (pathname.startsWith("/setup")) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <aside
        className={`hidden md:flex sticky top-0 h-[100dvh] transition-[width] duration-150 ease-out border-r border-(--border) bg-(--bg) flex-col shrink-0 z-40 overflow-hidden ${
          isExpanded ? "w-52" : "w-14"
        }`}
      >
        {/* Logo */}
        <Link
          href="/"
          className="h-14 flex items-center gap-3 px-3 border-b border-(--border) shrink-0"
          title="vLLM Studio"
        >
          <LogoMark />
          <span
            className={`text-sm font-bold tracking-tight whitespace-nowrap text-(--fg) transition-opacity duration-100 ${
              isExpanded ? "opacity-100" : "opacity-0"
            }`}
          >
            vLLM Studio
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="flex-1 min-h-0 flex flex-col py-2 overflow-y-auto overflow-x-hidden">
          {tabs.map((tab) => (
            <NavItemDesktop
              key={tab.href}
              href={tab.href}
              label={tab.label}
              Icon={tab.icon}
              active={isRouteActive(pathname, tab.href)}
              expanded={isExpanded}
            />
          ))}
          <ProjectsNavSection expanded={isExpanded} />
        </nav>

        {/* Footer controls */}
        <div className="border-t border-(--border) p-2 shrink-0">
          <div className="flex items-center justify-between gap-1">
            <button
              onClick={() => setDesktopSidebarPinnedOpen(!desktopSidebarPinnedOpen)}
              className="flex h-9 w-9 items-center justify-center text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg)"
              title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            >
              {isExpanded ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
            <StopButtonDesktop />
            <ThemeToggleDesktop />
            <StatusRowDesktop />
          </div>
        </div>
      </aside>

      {/* Mobile: top strip */}
      <div className="md:hidden absolute top-0 left-0 right-0 h-10 px-3 border-b border-(--border) bg-(--bg) z-40 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="text-xs font-bold tracking-tight text-(--fg)">vLLM Studio</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggleMobile />
          <StatusRowMobile />
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-(--bg) pt-10 pb-14 md:pt-0 md:pb-0">
        {children}
      </main>

      {/* Mobile: bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 border-t border-(--border) bg-(--bg) z-40 flex items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isRouteActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? "text-(--fg) bg-(--surface)" : "text-(--dim)"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ---------- Desktop variants use the `group-hover` collapsed state ---------- */

function NavItemDesktop({
  href,
  label,
  Icon,
  active,
  expanded,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  expanded: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`h-10 flex items-center gap-3 px-3 transition-colors ${
        active
          ? "bg-(--surface) text-(--fg)"
          : "text-(--dim) hover:text-(--fg) hover:bg-(--surface)"
      } shrink-0`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span
        className={`text-sm font-medium whitespace-nowrap transition-opacity duration-100 ${
          expanded ? "opacity-100" : "opacity-0"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}

function ThemeToggleDesktop() {
  const { themeId, setThemeId } = useAppStore(
    useShallow((s) => ({ themeId: s.themeId, setThemeId: s.setThemeId })),
  );
  const isDark = themeId === "omlx-dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Light mode" : "Dark mode";
  return (
    <button
      onClick={() => setThemeId(isDark ? "omlx-light" : "omlx-dark")}
      className="flex h-9 w-9 items-center justify-center text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg)"
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function StopButtonDesktop() {
  const status = useSidebarStatus();
  const { stop } = useModelLifecycle();
  if (!status.inferenceOnline) {
    return <div className="h-9 w-9" />;
  }
  return (
    <ModelStopConfirm
      onStop={stop}
      trigger={({ open, stopping }) => (
        <button
          onClick={open}
          disabled={stopping}
          className="flex h-9 w-9 items-center justify-center text-(--err) transition-colors hover:bg-(--err)/10 disabled:opacity-40"
          title="Stop model"
          aria-label="Stop model"
        >
          <Square className="h-4 w-4" fill="currentColor" />
        </button>
      )}
    />
  );
}

function StatusRowDesktop() {
  const status = useSidebarStatus();
  const color = status.inferenceOnline ? "bg-(--fg)" : status.online ? "bg-(--dim)" : "bg-(--err)";
  const label = status.inferenceOnline ? "inference" : status.online ? "controller" : "offline";

  return (
    <div className="flex h-9 w-9 items-center justify-center" title={label} aria-label={label}>
      <div className={`h-1.5 w-1.5 ${color}`} />
    </div>
  );
}

/* ---------- Mobile strip variants (always visible) ---------- */

function ThemeToggleMobile() {
  const { themeId, setThemeId } = useAppStore(
    useShallow((s) => ({ themeId: s.themeId, setThemeId: s.setThemeId })),
  );
  const isDark = themeId === "omlx-dark";
  const Icon = isDark ? Sun : Moon;
  return (
    <button
      onClick={() => setThemeId(isDark ? "omlx-light" : "omlx-dark")}
      className="p-1.5 text-(--dim) hover:text-(--fg) transition-colors"
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function StatusRowMobile() {
  const status = useSidebarStatus();
  const color = status.inferenceOnline ? "bg-(--fg)" : status.online ? "bg-(--dim)" : "bg-(--err)";
  const label = status.inferenceOnline ? "inference" : status.online ? "controller" : "offline";
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <div className={`h-1.5 w-1.5 ${color}`} />
    </div>
  );
}
