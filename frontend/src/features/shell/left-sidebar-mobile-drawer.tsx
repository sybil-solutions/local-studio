"use client";

import { Settings, X } from "@/ui/icon-registry";
import type { ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemMobile,
  ProjectsNavPlaceholder,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

export function MobileNavigationDrawer({
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
