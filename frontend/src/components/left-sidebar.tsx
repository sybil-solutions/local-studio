"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bot,
  Database,
  HardDrive,
  Search as SearchIcon,
  Server,
  Settings,
  Sun,
  Moon,
  Square,
  PanelLeftClose,
  Menu,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store";
import { useSidebarStatus } from "@/hooks/use-sidebar-status";
import { useModelLifecycle } from "@/hooks/use-model-lifecycle";
import { ProjectsNavSection } from "@/components/projects-nav-section";
import { ModelStopConfirm } from "@/components/model-stop-confirm";
import { SessionsCommand } from "@/components/sessions-command";

// Custom event used by ProjectsNavSection to broadcast the set of currently
// running agent panes/tabs. We listen for it here so the search palette can
// surface "Running now" entries even when the project tree is collapsed.
const ACTIVE_AGENT_SESSIONS_EVENT = "vllm-studio.agent.activeSessions";

type ActiveSessionDetail = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  active?: boolean;
  updatedAt: string;
};

const tabs = [
  { href: "/", label: "Status", icon: BarChart3 },
  { href: "/usage", label: "Usage", icon: Database },
  { href: "/agent", label: "Agent", icon: Bot },
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
 * Left navigation rail. Desktop keeps a compact rail. Mobile/PWA uses a top
 * app bar with a hamburger drawer instead of a bottom tab bar, keeping the
 * viewport clear for dense telemetry and agent panes.
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionDetail[]>([]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  // Global Cmd/Ctrl+K opens the session search palette.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Mirror active sessions broadcast by the agent workspace so the palette
  // can show what's running even when the user is on a non-agent route.
  useEffect(() => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveSessionDetail[] }>).detail;
      setActiveSessions(Array.isArray(detail?.sessions) ? detail.sessions : []);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
  }, []);

  if (pathname.startsWith("/setup")) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <aside
        className={`hidden md:flex sticky top-0 h-[100dvh] transition-[width] duration-150 ease-out border-r border-(--border) bg-(--rail) flex-col shrink-0 z-40 overflow-hidden ${
          isExpanded ? "w-[var(--sidebar-w)]" : "w-[var(--sidebar-w-collapsed)]"
        }`}
      >
        {/* Logo */}
        <Link href="/" className="h-11 flex items-center gap-2.5 px-3 shrink-0" title="vLLM Studio">
          <LogoMark />
          <span
            className={`text-[13px] font-semibold tracking-tight whitespace-nowrap text-(--fg) transition-opacity duration-100 ${
              isExpanded ? "opacity-100" : "opacity-0"
            }`}
          >
            vLLM Studio
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="flex-1 min-h-0 flex flex-col px-2 py-1 overflow-y-auto overflow-x-hidden">
          {isExpanded ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="mb-1 flex h-7 items-center gap-2 rounded-md bg-(--surface) px-2 text-(--dim) transition-colors hover:bg-(--surface-2) hover:text-(--fg)"
              title="Search sessions (⌘K)"
            >
              <SearchIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate text-left text-[12px]">Search sessions</span>
              <kbd className="rounded bg-(--surface-2) px-1 py-0.5 text-[9.5px] font-mono text-(--dim)">
                ⌘K
              </kbd>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="mb-1 flex h-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
              title="Search sessions (⌘K)"
              aria-label="Search sessions"
            >
              <SearchIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {isExpanded ? (
            <div className="px-2 pb-1 pt-2 text-[length:var(--text-section)] font-medium uppercase tracking-[var(--section-tracking)] text-(--dim)">
              Workspace
            </div>
          ) : null}
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
        <div className="p-2 shrink-0">
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

      {/* Mobile/PWA: top app bar + hamburger drawer (no footer nav). */}
      <div className="mobile-pwa-topbar md:hidden fixed left-0 right-0 top-0 z-40 border-b border-(--border)/70 bg-(--bg) px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <LogoMark />
          <span className="truncate text-[13px] font-semibold tracking-tight text-(--fg)">
            vLLM Studio
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <StopButtonMobile />
          <ThemeToggleMobile />
          <StatusRowMobile />
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex !h-8 !min-h-8 !w-8 !min-w-8 items-center justify-center rounded-md border-0 bg-transparent text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg)"
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <MobileNavigationDrawer pathname={pathname} onClose={() => setMobileMenuOpen(false)} />
      ) : null}

      <SessionsCommand
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        activeSessions={activeSessions}
      />

      {/* Main content */}
      <main className="mobile-pwa-main flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-(--bg) md:pt-0">
        {children}
      </main>
    </div>
  );
}

function MobileNavigationDrawer({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Close navigation menu"
        onClick={onClose}
      />
      <aside
        id="mobile-navigation-drawer"
        className="mobile-pwa-drawer absolute right-0 top-0 flex h-full w-[min(22rem,88vw)] flex-col border-l border-(--border) bg-(--bg) shadow-2xl"
      >
        <div className="mobile-pwa-drawer-header flex shrink-0 items-center justify-between gap-3 border-b border-(--border) px-4">
          <div className="flex min-w-0 items-center gap-2">
            <LogoMark />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-(--fg)">vLLM Studio</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-(--dim)">PWA menu</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded border border-(--border) text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-(--dim)">
            Navigation
          </div>
          {tabs.map((tab) => (
            <NavItemMobile
              key={tab.href}
              href={tab.href}
              label={tab.label}
              Icon={tab.icon}
              active={isRouteActive(pathname, tab.href)}
              onClick={onClose}
            />
          ))}
          <div className="my-3 border-t border-(--border)" />
          <ProjectsNavSection expanded />
        </nav>
      </aside>
    </div>
  );
}

function NavItemMobile({
  href,
  label,
  Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`mb-1 flex h-12 items-center gap-3 rounded px-3 text-sm font-medium transition-colors ${
        active
          ? "bg-(--surface) text-(--fg)"
          : "text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </Link>
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
      className={`h-7 flex items-center gap-2.5 px-2 rounded-md transition-colors shrink-0 ${
        active ? "bg-(--active) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span
        className={`text-[12.5px] font-medium whitespace-nowrap transition-opacity duration-100 ${
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

function StopButtonMobile() {
  const status = useSidebarStatus();
  const { stop } = useModelLifecycle();
  if (!status.inferenceOnline) return null;
  return (
    <ModelStopConfirm
      onStop={stop}
      trigger={({ open, stopping }) => (
        <button
          onClick={open}
          disabled={stopping}
          className="flex !h-8 !min-h-8 !w-8 !min-w-8 items-center justify-center rounded-md text-(--err) hover:bg-(--err)/10 disabled:opacity-40"
          title="Stop model"
          aria-label="Stop model"
        >
          <Square className="h-4 w-4" fill="currentColor" />
        </button>
      )}
    />
  );
}

function ThemeToggleMobile() {
  const { themeId, setThemeId } = useAppStore(
    useShallow((s) => ({ themeId: s.themeId, setThemeId: s.setThemeId })),
  );
  const isDark = themeId === "omlx-dark";
  const Icon = isDark ? Sun : Moon;
  return (
    <button
      onClick={() => setThemeId(isDark ? "omlx-light" : "omlx-dark")}
      className="flex !h-8 !min-h-8 !w-8 !min-w-8 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg)"
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <Icon className="h-4 w-4" />
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
