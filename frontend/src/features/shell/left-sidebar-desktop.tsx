"use client";

import Link from "next/link";
import { ProfileFooter } from "@/features/shell/profile-footer";
import { type MouseEvent as ReactMouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search as SearchIcon,
  Settings,
  PanelLeftOpen,
  PanelLeftClose,
} from "@/ui/icon-registry";
import type { ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemDesktop,
  ProjectsNavPlaceholder,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

const HISTORY_STEPPER_CLASS =
  "flex h-6 w-6 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)";

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
        <div className="flex h-[var(--h-toolbar)] shrink-0 items-center justify-center">
          <button
            onClick={() => onSetPinnedOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          isExpanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {isExpanded ? (
          <>
            <div className="sticky top-0 z-50 flex h-[var(--h-toolbar)] shrink-0 items-center gap-1 bg-(--sidebar-bg) px-2">
              <button
                onClick={() => onSetPinnedOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              <button
                onClick={() => window.history.back()}
                className={HISTORY_STEPPER_CLASS}
                title="Go back"
                aria-label="Go back"
              >
                <ChevronLeft className="h-3 w-3" strokeWidth={1.75} />
              </button>
              <button
                onClick={() => window.history.forward()}
                className={HISTORY_STEPPER_CLASS}
                title="Go forward"
                aria-label="Go forward"
              >
                <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
              </button>
            </div>

            <nav className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[var(--sidebar-padding-x)] py-0.5 [contain:layout_paint]">
              <button
                type="button"
                onClick={onOpenSearch}
                className="mb-0.5 flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 text-(--fg) transition-colors hover:bg-(--hover)"
                title="Search sessions (⌘K)"
              >
                <SearchIcon className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
                <span className="flex-1 truncate text-left text-[length:var(--fs-md)] font-normal">
                  Search
                </span>
              </button>

              <div className="pb-1 pt-5 px-2 text-[length:var(--fs-sm)] font-normal text-(--hl2)">
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

            <div className="shrink-0 border-t border-(--separator) bg-(--sidebar-bg) px-[var(--sidebar-padding-x)] py-2">
              <ProfileFooter settingsActive={isRouteActive(pathname, "/settings")} />
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
