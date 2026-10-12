"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Menu } from "@/ui/icon-registry";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_SIDEBAR_WIDTH, useAppStore } from "@/store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useOpenSessions, useSessionActivity } from "@/features/agent/session-index";
import { hrefWithOpenNonce } from "@/features/agent/ui/projects-nav/helpers";
import { DesktopSidebar } from "@/features/shell/left-sidebar-desktop";
import {
  loadProjectsNavSection,
  loadSessionsCommand,
  type NavView,
  type ProjectsNavSectionComponent,
  type SessionsCommandComponent,
} from "@/features/shell/left-sidebar-lazy";
import { MobileNavigationDrawer } from "@/features/shell/left-sidebar-mobile-drawer";
import {
  mobilePageTitle,
  routeHidesAppSidebar,
  routeOwnsMobileHeader,
} from "@/features/shell/left-sidebar-nav";

// Search and recents are the same palette in two modes: one lazy chunk, one
// dialog, and only ever one of them open.
type PaletteMode = "search" | null;

// Codex desktop sidebar clamp: min(240px, 275px preferred, max min(520px, 100vw-320px)).
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;
function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function LeftSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hidesAppSidebar = routeHidesAppSidebar(pathname);
  // Sessions and projects are the sidebar's body on EVERY page, not an agent
  // extra: lazy-loading them on hover made the nav look empty anywhere else,
  // which read as "the sessions are gone".
  const projectsNavImmediate = !hidesAppSidebar;
  const {
    desktopSidebarPinnedOpen,
    setDesktopSidebarPinnedOpen,
    sidebarWidth,
    setSidebarWidth,
    mobileMenuOpen,
    setMobileMenuOpen,
  } = useAppStore(
    useShallow((s) => ({
      desktopSidebarPinnedOpen: s.desktopSidebarPinnedOpen,
      setDesktopSidebarPinnedOpen: s.setDesktopSidebarPinnedOpen,
      sidebarWidth: s.sidebarWidth,
      setSidebarWidth: s.setSidebarWidth,
      mobileMenuOpen: s.mobileNavOpen,
      setMobileMenuOpen: s.setMobileNavOpen,
    })),
  );
  const isExpanded = desktopSidebarPinnedOpen;
  const clampedSidebarWidth = clampSidebarWidth(sidebarWidth);
  // Agent routes carry their own header (hamburger + surface title), so the app
  // topbar would be a second stacked row there.
  const ownsMobileHeader = routeOwnsMobileHeader(pathname);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>(null);
  const [navView, setNavView] = useState<NavView>("recents");
  const liveCount = useSessionActivity().active.size;
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
  }, [mobileMenuOpen, setMobileMenuOpen]);

  // Navigating anywhere dismisses the drawer — it covers the whole screen, so
  // leaving it open over the destination is never what you want.
  useMountSubscription(() => {
    setMobileMenuOpen(false);
  }, [pathname, setMobileMenuOpen]);

  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (key === "k") {
        event.preventDefault();
        setPaletteMode((mode) => (mode === "search" ? null : "search"));
        return;
      }
      if (key !== "n") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      event.preventDefault();
      router.push(hrefWithOpenNonce("/agent?new=1&replace=1"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

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
    if (!paletteMode || SessionsCommand) return;
    let cancelled = false;
    void loadSessionsCommand().then((Component) => {
      if (!cancelled) setSessionsCommand(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [SessionsCommand, paletteMode]);

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
  const openNewTask = useCallback(
    () => router.push(hrefWithOpenNonce("/agent?new=1&replace=1")),
    [router],
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
        onOpenSearch={() => setPaletteMode("search")}
        navView={navView}
        onToggleNavView={() => setNavView((view) => (view === "recents" ? "projects" : "recents"))}
        liveCount={liveCount}
        onNewTask={openNewTask}
      />

      {ownsMobileHeader ? null : (
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
              <Menu className="h-[17px] w-[17px]" />
            </button>
          </div>
        </div>
      )}

      {mobileMenuOpen ? (
        <MobileNavigationDrawer
          pathname={pathname}
          projectsNavReady={projectsNavReady}
          ProjectsNavSection={ProjectsNavSection}
          onClose={() => setMobileMenuOpen(false)}
          onNewTask={openNewTask}
        />
      ) : null}

      {SessionsCommand ? (
        <SessionsCommand
          open={paletteMode !== null}
          onClose={() => setPaletteMode(null)}
          activeSessions={activeSessions}
        />
      ) : null}

      <main
        data-no-topbar={ownsMobileHeader ? "true" : undefined}
        className="mobile-pwa-main flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-(--agent-bg) md:pt-0"
      >
        {children}
      </main>
    </div>
  );
}
