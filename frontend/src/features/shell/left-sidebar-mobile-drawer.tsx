"use client";

import { Settings } from "@/ui/icon-registry";
import { Drawer, DrawerHeader, DrawerOverlay } from "@/ui/drawer";
import type { ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemMobile,
  NavNewTaskMobile,
  ProjectsNavPlaceholder,
  SidebarNavSeparator,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

export function MobileNavigationDrawer({
  pathname,
  projectsNavReady,
  ProjectsNavSection,
  onClose,
  onNewTask,
}: {
  pathname: string;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onClose: () => void;
  onNewTask: () => void;
}) {
  return (
    <DrawerOverlay onClose={onClose} className="md:hidden">
      <Drawer
        id="mobile-navigation-drawer"
        fullBleed
        className="mobile-pwa-drawer h-full bg-(--bg)"
      >
        <DrawerHeader
          title={
            <span className="text-[19px] font-semibold tracking-[-0.01em] text-(--fg)">
              Local Studio
            </span>
          }
          onClose={onClose}
          className="mobile-pwa-drawer-header h-auto px-4"
        />

        <nav className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-3 pb-4 pt-2">
          <NavNewTaskMobile
            onClick={(event) => {
              onClose();
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNewTask();
            }}
          />

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

          {projectsNavReady ? (
            <>
              <SidebarNavSeparator />
              {ProjectsNavSection ? (
                <ProjectsNavSection expanded view="recents" />
              ) : (
                <ProjectsNavPlaceholder />
              )}
            </>
          ) : null}
        </nav>
      </Drawer>
    </DrawerOverlay>
  );
}
