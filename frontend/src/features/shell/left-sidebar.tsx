"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useRef,
  useState,
  type ComponentType,
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
  Wrench,
  MessageSquare,
  Plug,
} from "@/ui/icon-registry";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ACTIVE_AGENT_SESSIONS_EVENT } from "@/lib/workspace-events";

type ActiveSessionDetail = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  focused?: boolean;
  updatedAt: string;
};

type ProjectsNavSectionComponent = ComponentType<{ expanded: boolean }>;

type SessionsCommandComponent = ComponentType<{
  open: boolean;
  onClose: () => void;
  activeSessions: ActiveSessionDetail[];
}>;

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

const tabs = [
  { href: "/", label: "Status", icon: Gauge },
  { href: "/agent", label: "Workbench", icon: MessageSquare },
  { href: "/recipes", label: "Models", icon: HardDrive },
  { href: "/configure", label: "Configure", icon: Wrench },
  { href: "/usage", label: "Usage", icon: Microchip },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/server", label: "Server", icon: Globe },
];

const SIDEBAR_MIN_WIDTH = 188;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 224;

let projectsNavSectionPromise: Promise<ProjectsNavSectionComponent> | null = null;
let sessionsCommandPromise: Promise<SessionsCommandComponent> | null = null;

function loadProjectsNavSection(): Promise<ProjectsNavSectionComponent> {
  projectsNavSectionPromise ??= import("@/features/agent/ui/projects-nav-section").then(
    (mod) => mod.ProjectsNavSection,
  );
  return projectsNavSectionPromise;
}

function loadSessionsCommand(): Promise<SessionsCommandComponent> {
  sessionsCommandPromise ??= import("@/features/agent/ui/sessions-command").then(
    (mod) => mod.SessionsCommand,
  );
  return sessionsCommandPromise;
}

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function mobilePageTitle(pathname: string): string {
  if (pathname.startsWith("/agent")) return "Workbench";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/logs")) return "Logs";
  const tab = tabs.find((entry) => isRouteActive(pathname, entry.href));
  return tab?.label ?? "Local Studio";
}

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings");
  }
  return pathname.startsWith(href);
}

function routeHidesAppSidebar(pathname: string): boolean {
  return (
    pathname.startsWith("/setup") ||
    pathname.startsWith("/download") ||
    pathname.startsWith("/agents") ||
    pathname.startsWith("/quick") ||
    pathname.startsWith("/landing") ||
    pathname.startsWith("/docs")
  );
}

function ProjectsNavPlaceholder() {
  return (
    <div className="px-2 py-1 text-[length:var(--fs-md)] text-(--dim)">Loading projects...</div>
  );
}

export function LeftSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hidesAppSidebar = routeHidesAppSidebar(pathname);
  const projectsNavImmediate = pathname.startsWith("/agent");
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
  const [projectsNavReady, setProjectsNavReady] = useState(projectsNavImmediate);
  const [ProjectsNavSection, setProjectsNavSection] = useState<ProjectsNavSectionComponent | null>(
    null,
  );
  const [SessionsCommand, setSessionsCommand] = useState<SessionsCommandComponent | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useMountSubscription(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useMountSubscription(() => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveSessionDetail[] }>).detail;
      setActiveSessions(Array.isArray(detail?.sessions) ? detail.sessions : []);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
  }, []);

  useMountSubscription(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  useMountSubscription(() => {
    if (projectsNavReady || hidesAppSidebar) return;
    if (projectsNavImmediate || mobileMenuOpen) {
      setProjectsNavReady(true);
    }
  }, [hidesAppSidebar, mobileMenuOpen, projectsNavImmediate, projectsNavReady]);

  useMountSubscription(() => {
    if (!projectsNavReady || ProjectsNavSection) return;
    let cancelled = false;
    void loadProjectsNavSection().then((Component) => {
      if (!cancelled) setProjectsNavSection(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [ProjectsNavSection, projectsNavReady]);

  useMountSubscription(() => {
    if (!searchOpen || SessionsCommand) return;
    let cancelled = false;
    void loadSessionsCommand().then((Component) => {
      if (!cancelled) setSessionsCommand(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [SessionsCommand, searchOpen]);

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

  if (hidesAppSidebar) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {!isExpanded ? (
        <div className="fixed left-0 top-0 z-50 hidden h-9 w-10 items-center justify-center md:flex">
          <button
            onClick={() => setDesktopSidebarPinnedOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim)/70 transition-colors hover:bg-(--hover) hover:text-(--fg)"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <aside
        onPointerEnter={() => {
          if (!hidesAppSidebar && !projectsNavReady) setProjectsNavReady(true);
        }}
        onFocusCapture={() => {
          if (!hidesAppSidebar && !projectsNavReady) setProjectsNavReady(true);
        }}
        className={`relative hidden md:flex sticky top-0 h-[100dvh] border-r border-(--border) bg-(--sidebar-bg) flex-col shrink-0 z-40 overflow-hidden shadow-[inset_-1px_0_rgba(255,255,255,0.02)] ${
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
            className={`absolute right-0 top-0 z-[60] h-full w-2 cursor-col-resize transition-colors ${
              sidebarResizing ? "bg-(--fg)/10" : "hover:bg-(--fg)/8"
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
              <div className="sticky top-0 z-50 flex h-10 shrink-0 items-center gap-1 bg-(--sidebar-bg) px-1.5">
                <button
                  onClick={() => setDesktopSidebarPinnedOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
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

              <nav className="flex-1 min-h-0 flex flex-col px-3 py-0.5 overflow-y-auto overflow-x-hidden">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="mb-1 flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-(--fg)/90 transition-colors hover:bg-(--color-surface-hover) hover:text-(--fg)"
                  title="Search sessions (⌘K)"
                >
                  <SearchIcon className="h-4 w-4 shrink-0 opacity-60" strokeWidth={1.5} />
                  <span className="flex-1 truncate text-left text-[length:var(--fs-lg)] font-normal">
                    Search
                  </span>
                </button>

                <div className="mb-1 mt-5 px-2.5 text-[length:var(--fs-md)] font-normal text-(--dim)">
                  Workspace
                </div>
                {tabs.map((tab) => (
                  <NavItemDesktop
                    key={tab.href}
                    href={tab.href}
                    label={tab.label}
                    Icon={tab.icon}
                    active={isRouteActive(pathname, tab.href)}
                  />
                ))}
                {projectsNavReady ? (
                  ProjectsNavSection ? (
                    <ProjectsNavSection expanded={isExpanded} />
                  ) : (
                    <ProjectsNavPlaceholder />
                  )
                ) : null}
              </nav>

              <div className="shrink-0 px-3 py-2">
                <Link
                  href="/settings"
                  prefetch={false}
                  title="Settings"
                  className={`group flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 transition-colors ${
                    isRouteActive(pathname, "/settings")
                      ? "bg-(--color-surface-hover) font-medium text-(--fg)"
                      : "text-(--fg)/90 hover:bg-(--color-surface-hover) hover:text-(--fg)"
                  }`}
                >
                  <Settings
                    className={`h-4 w-4 shrink-0 ${
                      isRouteActive(pathname, "/settings") ? "text-(--fg)/85" : "opacity-60"
                    }`}
                    strokeWidth={1.75}
                  />
                  <span className="whitespace-nowrap text-[length:var(--fs-lg)] font-normal">
                    Settings
                  </span>
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </aside>

      <div className="mobile-pwa-topbar md:hidden fixed left-0 right-0 top-0 z-40 border-b border-(--border)/70 bg-(--bg) px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[length:var(--fs-base)] font-semibold tracking-tight text-(--fg)">
            {mobilePageTitle(pathname)}
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
        <MobileNavigationDrawer
          pathname={pathname}
          projectsNavReady={projectsNavReady}
          ProjectsNavSection={ProjectsNavSection}
          onClose={() => setMobileMenuOpen(false)}
        />
      ) : null}

      {SessionsCommand ? (
        <SessionsCommand
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          activeSessions={activeSessions}
        />
      ) : null}

      <main className="mobile-pwa-main flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-(--agent-bg) md:pt-0">
        {children}
      </main>
    </div>
  );
}

function MobileNavigationDrawer({
  pathname,
  projectsNavReady,
  ProjectsNavSection,
  onClose,
}: {
  pathname: string;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onClose: () => void;
}) {
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
          <div className="mb-2 px-2 text-[length:var(--fs-xs)] font-semibold uppercase tracking-[0.18em] text-(--dim)">
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
          {projectsNavReady ? (
            ProjectsNavSection ? (
              <ProjectsNavSection expanded />
            ) : (
              <ProjectsNavPlaceholder />
            )
          ) : null}
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

function NavItemDesktop({
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
