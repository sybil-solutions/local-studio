"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Menu } from "@/ui/icon-registry";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useOpenSessions } from "@/features/agent/ui/use-open-sessions";
import { DesktopSidebar } from "@/features/shell/left-sidebar-desktop";
import {
  loadProjectsNavSection,
  loadSessionsCommand,
  type ProjectsNavSectionComponent,
  type SessionsCommandComponent,
} from "@/features/shell/left-sidebar-lazy";
import { MobileNavigationDrawer } from "@/features/shell/left-sidebar-mobile-drawer";
import { mobilePageTitle, routeHidesAppSidebar } from "@/features/shell/left-sidebar-nav";

const SIDEBAR_MIN_WIDTH = 188;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 224;

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
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
  const activeSessions = useOpenSessions();
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
      <DesktopSidebar
        pathname={pathname}
        isExpanded={isExpanded}
        width={clampedSidebarWidth}
        resizing={sidebarResizing}
        projectsNavReady={projectsNavReady}
        ProjectsNavSection={ProjectsNavSection}
        onStartResize={startSidebarResize}
        onRevealProjectsNav={() => {
          if (!hidesAppSidebar && !projectsNavReady) setProjectsNavReady(true);
        }}
        onSetPinnedOpen={setDesktopSidebarPinnedOpen}
        onOpenSearch={() => setSearchOpen(true)}
      />

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
