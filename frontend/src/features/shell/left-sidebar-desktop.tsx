"use client";

import Link from "next/link";
import { ProfileFooter } from "@/features/shell/profile-footer";
import { type MouseEvent as ReactMouseEvent } from "react";
import {
  Clock,
  PanelLeftHollow,
  PanelLeftFilled,
  Plus,
  Search,
  Settings,
} from "@/ui/icon-registry";
import type { NavView, ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavDestinationsStrip,
  NavIconButton,
  ProjectsNavPlaceholder,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

const TOOLBAR_BTN =
  "flex h-7 w-7 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)";

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
  navView,
  onToggleNavView,
  liveCount,
  onNewTask,
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
  navView: NavView;
  onToggleNavView: () => void;
  liveCount: number;
  onNewTask: () => void;
}) {
  return (
    <aside
      onPointerEnter={onRevealProjectsNav}
      onFocusCapture={onRevealProjectsNav}
      className={`relative hidden md:flex sticky top-0 h-[100dvh] border-r border-(--border) bg-(--sidebar-bg) flex-col shrink-0 z-40 overflow-hidden ${
        resizing ? "" : "transition-[width] duration-150 ease-out"
      }`}
      style={{
        width: isExpanded ? `${width}px` : 44,
      }}
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
      {!isExpanded ? (
        <CollapsedRail
          pathname={pathname}
          liveCount={liveCount}
          navView={navView}
          onExpand={() => onSetPinnedOpen(true)}
          onNewTask={onNewTask}
          onToggleNavView={onToggleNavView}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[var(--h-toolbar)] shrink-0 items-center gap-0.5 bg-(--sidebar-bg) px-1.5">
            <button
              onClick={() => onSetPinnedOpen(false)}
              className={`${TOOLBAR_BTN} rounded-lg`}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftFilled className="h-3 w-3" strokeWidth={1.6} />
            </button>
            <span className="min-w-0 flex-1 truncate px-1 text-[length:var(--fs-md)] font-medium text-(--fg)">
              {navView === "recents" ? "Tasks" : "Projects"}
            </span>
            <button
              onClick={onOpenSearch}
              className={TOOLBAR_BTN}
              title="Search (⌘K)"
              aria-label="Search sessions"
            >
              <Search className="h-4 w-4" strokeWidth={1.6} />
            </button>
            <button
              onClick={onToggleNavView}
              aria-pressed={navView === "recents"}
              className={`${TOOLBAR_BTN} relative aria-pressed:text-(--fg)`}
              title={navView === "recents" ? "Show projects" : "Recent sessions"}
              aria-label={navView === "recents" ? "Show projects" : "Recent sessions"}
            >
              <span className="relative inline-flex">
                <Clock className="h-4 w-4" strokeWidth={1.6} />
                {liveCount > 0 ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-(--ok) animate-pulse-soft"
                    aria-label={`${liveCount} running`}
                  />
                ) : null}
              </span>
            </button>
          </div>

          <NavDestinationsStrip pathname={pathname} onNewTask={onNewTask} />

          <nav className="sidebar-scroller flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[var(--sidebar-padding-x)] pb-1 [contain:layout_paint]">
            {projectsNavReady ? (
              ProjectsNavSection ? (
                <ProjectsNavSection expanded={isExpanded} view={navView} />
              ) : (
                <ProjectsNavPlaceholder />
              )
            ) : null}
          </nav>

          <div className="shrink-0 border-t border-(--border)/55 bg-(--sidebar-bg) px-[var(--sidebar-padding-x)] pb-1.5 pt-1">
            <ProfileFooter settingsActive={isRouteActive(pathname, "/settings")} />
          </div>
        </div>
      )}
    </aside>
  );
}

function CollapsedRail({
  pathname,
  liveCount,
  navView,
  onExpand,
  onNewTask,
  onToggleNavView,
}: {
  pathname: string;
  liveCount: number;
  navView: NavView;
  onExpand: () => void;
  onNewTask: () => void;
  onToggleNavView: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center gap-0.5 py-1">
      <NavIconButton label="Expand sidebar" onClick={onExpand}>
        <PanelLeftHollow className="h-3.5 w-3.5" strokeWidth={1.6} />
      </NavIconButton>
      <NavIconButton label="New task" onClick={onNewTask}>
        <Plus className="h-4 w-4" strokeWidth={1.6} />
      </NavIconButton>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch={false}
          title={tab.label}
          aria-label={tab.label}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            isRouteActive(pathname, tab.href)
              ? "bg-(--active) text-(--fg)"
              : "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)"
          }`}
        >
          <tab.icon className="h-4 w-4" strokeWidth={1.6} />
        </Link>
      ))}
      <NavIconButton
        label={navView === "recents" ? "Show projects" : "Recent sessions"}
        active={navView === "recents"}
        onClick={onToggleNavView}
      >
        <span className="relative inline-flex">
          <Clock className="h-4 w-4" strokeWidth={1.6} />
          {liveCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-(--ok)" />
          ) : null}
        </span>
      </NavIconButton>
      <div className="flex-1" />
      <Link
        href="/settings"
        prefetch={false}
        title="Settings"
        aria-label="Settings"
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
          isRouteActive(pathname, "/settings")
            ? "bg-(--active) text-(--fg)"
            : "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)"
        }`}
      >
        <Settings className="h-3.5 w-3.5" strokeWidth={1.6} />
      </Link>
    </div>
  );
}
