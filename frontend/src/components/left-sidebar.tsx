"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Gauge,
  ChevronLeft,
  ChevronRight,
  Microchip,
  HardDrive,
  Search as SearchIcon,
  Globe,
  Settings,
  PanelLeftClose,
  Menu,
  PanelLeftOpen,
  Square,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store";
import { ProjectsNavSection } from "@/components/projects-nav-section";
import { SessionsCommand } from "@/components/sessions-command";
import { ACTIVE_AGENT_SESSIONS_EVENT } from "@/lib/agent/workspace/events";

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
  { href: "/", label: "Status", icon: Gauge },
  { href: "/usage", label: "Usage", icon: Microchip },
  { href: "/recipes", label: "Models", icon: HardDrive },
  { href: "/server", label: "Server", icon: Globe },
];

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 340;
const SIDEBAR_DEFAULT_WIDTH = 248;

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "/discover";
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings") || pathname.startsWith("/configs");
  }
  return pathname.startsWith(href);
}

/**
 * Left navigation rail. Desktop keeps a compact rail. Mobile/PWA uses a top
 * app bar with a hamburger drawer instead of a bottom tab bar, keeping the
 * viewport clear for dense telemetry and agent panes.
 */
export function LeftSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { desktopSidebarPinnedOpen, setDesktopSidebarPinnedOpen, sidebarWidth, setSidebarWidth } =
    useAppStore(
      useShallow((s) => ({
        desktopSidebarPinnedOpen: s.desktopSidebarPinnedOpen,
        setDesktopSidebarPinnedOpen: s.setDesktopSidebarPinnedOpen,
        sidebarWidth: s.sidebarWidth,
        setSidebarWidth: s.setSidebarWidth,
      })),
    );
  const isExpanded = desktopSidebarPinnedOpen;
  const clampedSidebarWidth = clampSidebarWidth(sidebarWidth);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionDetail[]>([]);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const subscribeMobileMenuEscape = useCallback(
    (_notify: () => void) => {
      if (!mobileMenuOpen) return () => {};
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setMobileMenuOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    },
    [mobileMenuOpen],
  );

  const subscribeSearchHotkey = useCallback((_notify: () => void) => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const subscribeActiveSessions = useCallback((_notify: () => void) => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveSessionDetail[] }>).detail;
      setActiveSessions(Array.isArray(detail?.sessions) ? detail.sessions : []);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
  }, []);

  const subscribeResizeCleanup = useCallback((_notify: () => void) => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  useSyncExternalStore(subscribeMobileMenuEscape, getLeftSidebarSnapshot, getLeftSidebarSnapshot);
  useSyncExternalStore(subscribeSearchHotkey, getLeftSidebarSnapshot, getLeftSidebarSnapshot);
  useSyncExternalStore(subscribeActiveSessions, getLeftSidebarSnapshot, getLeftSidebarSnapshot);
  useSyncExternalStore(subscribeResizeCleanup, getLeftSidebarSnapshot, getLeftSidebarSnapshot);

  const startSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isExpanded) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = clampedSidebarWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setSidebarResizing(true);

      const cleanup = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", cleanup);
        resizeCleanupRef.current = null;
        setSidebarResizing(false);
      };
      const onMouseMove = (moveEvent: MouseEvent) => {
        setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
      };

      resizeCleanupRef.current?.();
      resizeCleanupRef.current = cleanup;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", cleanup);
    },
    [clampedSidebarWidth, isExpanded, setSidebarWidth],
  );

  if (pathname.startsWith("/setup")) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {!isExpanded ? (
        <button
          onClick={() => setDesktopSidebarPinnedOpen(true)}
          className="fixed left-3 top-3 z-50 hidden h-8 w-8 items-center justify-center rounded-md bg-(--sidebar-bg)/70 text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg) md:flex"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
      ) : null}
      <aside
        className={`relative hidden md:flex sticky top-0 h-[100dvh] border-r border-(--border) bg-(--sidebar-bg) flex-col shrink-0 z-40 overflow-hidden ${
          sidebarResizing ? "" : "transition-[width] duration-150 ease-out"
        } ${isExpanded ? "" : "w-0 border-r-0"}`}
        style={{
          width: isExpanded ? `${clampedSidebarWidth}px` : 0,
        }}
        aria-hidden={!isExpanded}
      >
        {isExpanded ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Resize sidebar"
            onMouseDown={startSidebarResize}
            className={`absolute right-0 top-0 z-[60] h-full w-2 translate-x-1 cursor-col-resize transition-colors ${
              sidebarResizing ? "bg-(--accent)/25" : "hover:bg-(--accent)/20"
            }`}
          />
        ) : null}
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            isExpanded ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {isExpanded ? (
            <>
              {/* Header with window controls + nav arrows */}
              <div className="sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between px-1.5 bg-(--sidebar-bg)">
                <button
                  onClick={() => setDesktopSidebarPinnedOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => window.history.back()}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                    title="Go back"
                    aria-label="Go back"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => window.history.forward()}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                    title="Go forward"
                    aria-label="Go forward"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Primary nav */}
              <nav className="flex-1 min-h-0 flex flex-col px-1 py-0.5 overflow-y-auto overflow-x-hidden">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="mb-1.5 flex h-7 items-center gap-2.5 rounded-md px-2 text-(--dim)/70 transition-colors hover:bg-(--hover) hover:text-(--fg)/90"
                  title="Search sessions (⌘K)"
                >
                  <SearchIcon className="h-[15px] w-[15px] shrink-0 opacity-50" strokeWidth={1.5} />
                  <span className="flex-1 truncate text-left text-[13px] font-normal">Search</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-(--dim)/50 bg-transparent rounded border border-(--border)/30">
                    ⌘K
                  </kbd>
                </button>

                <div className="mb-0.5 mt-3 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--dim)/60">
                  Workspace
                </div>
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

              <div className="shrink-0 px-1 py-2">
                <Link
                  href="/settings"
                  title="Settings"
                  className={`group relative flex h-7 shrink-0 items-center gap-2.5 rounded-md px-2 text-(--dim)/80 transition-colors hover:bg-(--hover) hover:text-(--fg)/90 ${
                    isRouteActive(pathname, "/settings") ? "bg-(--hover) text-(--fg)" : ""
                  }`}
                >
                  <Settings className="h-[15px] w-[15px] shrink-0 opacity-50" strokeWidth={1.5} />
                  <span className="whitespace-nowrap text-[13px] font-normal">Settings</span>
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </aside>

      {/* Mobile/PWA: top app bar + hamburger drawer (no footer nav). */}
      <div className="mobile-pwa-topbar md:hidden fixed left-0 right-0 top-0 z-40 border-b border-(--border)/70 bg-(--bg) px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[13px] font-semibold tracking-tight text-(--fg)">
            Status
          </span>
        </Link>
        <div className="flex items-center gap-2">
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
      <main className="mobile-pwa-main flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-(--agent-bg) md:pt-0">
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
        className="mobile-pwa-drawer absolute right-0 top-0 flex h-full w-[min(22rem,88vw)] flex-col border-l border-(--border) bg-(--bg)"
      >
        <div className="mobile-pwa-drawer-header flex shrink-0 items-center justify-between gap-3 border-b border-(--border) px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-(--fg)">Navigation</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center text-(--dim) hover:text-(--fg)"
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
          <NavItemMobile
            href="/settings"
            label="Settings"
            Icon={Settings}
            active={isRouteActive(pathname, "/settings")}
            onClick={onClose}
          />
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
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
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
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  expanded: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`group relative flex h-7 items-center gap-2.5 rounded-md px-2 transition-colors shrink-0 ${
        active
          ? "bg-(--hover) text-(--fg)"
          : "text-(--dim)/80 hover:bg-(--hover) hover:text-(--fg)/90"
      }`}
    >
      <Icon className="w-[15px] h-[15px] shrink-0 opacity-50" strokeWidth={1.5} />
      <span
        className={`text-[13px] font-normal whitespace-nowrap transition-opacity duration-100 ${
          expanded ? "opacity-100" : "opacity-0"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}

const getLeftSidebarSnapshot = (): number => 0;
