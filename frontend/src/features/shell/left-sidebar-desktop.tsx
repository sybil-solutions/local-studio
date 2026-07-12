"use client";

import Link from "next/link";
import { type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search as SearchIcon,
  Settings,
  PanelLeftOpen,
  Square,
} from "@/ui/icon-registry";
import type { ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemDesktop,
  ProjectsNavPlaceholder,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

export function DesktopSidebar({
  pathname,
  isExpanded,
  width,
  resizing,
  projectsNavReady,
  ProjectsNavSection,
  onStartResize,
  onRevealProjectsNav,
  onSetPinnedOpen,
  onOpenSearch,
}: {
  pathname: string;
  isExpanded: boolean;
  width: number;
  resizing: boolean;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onStartResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onRevealProjectsNav: () => void;
  onSetPinnedOpen: (open: boolean) => void;
  onOpenSearch: () => void;
}) {
  return (
    <>
      {!isExpanded ? (
        <div className="fixed left-0 top-0 z-50 hidden h-9 w-10 items-center justify-center md:flex">
          <button
            onClick={() => onSetPinnedOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim)/70 transition-colors hover:bg-(--hover) hover:text-(--fg)"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <aside
        onPointerEnter={onRevealProjectsNav}
        onFocusCapture={onRevealProjectsNav}
        className={`relative hidden md:flex sticky top-0 h-[100dvh] border-r border-(--border) bg-(--sidebar-bg) flex-col shrink-0 z-40 overflow-hidden shadow-[inset_-1px_0_rgba(255,255,255,0.02)] ${
          resizing ? "" : "transition-[width] duration-150 ease-out"
        } ${isExpanded ? "" : "w-0 border-r-0"}`}
        style={{
          width: isExpanded ? `${width}px` : 0,
        }}
        aria-hidden={!isExpanded}
      >
        {isExpanded ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Resize sidebar"
            onMouseDown={onStartResize}
            className={`absolute right-0 top-0 z-[60] h-full w-2 cursor-col-resize transition-colors ${
              resizing ? "bg-(--fg)/10" : "hover:bg-(--fg)/8"
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
                  onClick={() => onSetPinnedOpen(false)}
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
                  onClick={onOpenSearch}
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
    </>
  );
}
