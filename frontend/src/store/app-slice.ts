// CRITICAL
import type { StateCreator } from "zustand";

export interface SidebarState {
  collapsed: boolean;
  mobileOpen: boolean;
}

export interface AppSlice {
  sidebar: SidebarState;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarMobileOpen: (open: boolean) => void;
  toggleSidebarMobileOpen: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
}

export const createAppSlice: StateCreator<AppSlice, [], [], AppSlice> = (set) => ({
  sidebar: { collapsed: false, mobileOpen: false },
  setSidebarCollapsed: (collapsed) =>
    set((state) => {
      if (state.sidebar.collapsed === collapsed) return state;
      return { sidebar: { ...state.sidebar, collapsed } };
    }),
  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebar: { ...state.sidebar, collapsed: !state.sidebar.collapsed } })),
  setSidebarMobileOpen: (mobileOpen) =>
    set((state) => {
      if (state.sidebar.mobileOpen === mobileOpen) return state;
      return { sidebar: { ...state.sidebar, mobileOpen } };
    }),
  toggleSidebarMobileOpen: () =>
    set((state) => ({ sidebar: { ...state.sidebar, mobileOpen: !state.sidebar.mobileOpen } })),
  sidebarWidth: 240,
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
});
