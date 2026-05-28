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
  fileViewerFontSize: number;
  setFileViewerFontSize: (size: number) => void;
  lastOpenFileByProject: Record<string, string>;
  setLastOpenFileByProject: (cwd: string, rel: string) => void;
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
  sidebarWidth: 204,
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  fileViewerFontSize: 12,
  setFileViewerFontSize: (fileViewerFontSize) => set({ fileViewerFontSize }),
  lastOpenFileByProject: {},
  setLastOpenFileByProject: (cwd, rel) =>
    set((state) => ({
      lastOpenFileByProject: { ...state.lastOpenFileByProject, [cwd]: rel },
    })),
});
