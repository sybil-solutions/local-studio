import { create, type StateCreator } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { createAppSlice, type AppSlice } from "./app-slice";
import { createThemeSlice, type ThemeSlice } from "./theme-slice";

export type AppStore = AppSlice &
  ThemeSlice & {
    desktopSidebarPinnedOpen: boolean;
    setDesktopSidebarPinnedOpen: (open: boolean) => void;
  };

const createAppStoreImpl: StateCreator<AppStore, [], [], AppStore> = (set, ...args) => ({
  ...createAppSlice(set, ...args),
  ...createThemeSlice(set, ...args),
  desktopSidebarPinnedOpen: true,
  setDesktopSidebarPinnedOpen: (desktopSidebarPinnedOpen) => set({ desktopSidebarPinnedOpen }),
});

const storage = createJSONStorage(() =>
  typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage),
);

export const useAppStore = create<AppStore>()(
  devtools(
    persist(createAppStoreImpl, {
      name: "vllm-studio-state",
      storage,
      skipHydration: true,
      partialize: (state) => ({
        themeId: state.themeId,
        fontFamilyId: state.fontFamilyId,
        fontSizeId: state.fontSizeId,
        desktopSidebarPinnedOpen: state.desktopSidebarPinnedOpen,
        sidebarCollapsed: state.sidebar.collapsed,
        sidebarWidth: state.sidebarWidth,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AppStore>),
        sidebar: {
          ...current.sidebar,
          collapsed: (persisted as Record<string, unknown>)?.sidebarCollapsed === true,
        },
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.themeId) state.setThemeId(state.themeId);
        if (state?.fontFamilyId) state.setFontFamilyId(state.fontFamilyId);
        if (state?.fontSizeId) state.setFontSizeId(state.fontSizeId);
      },
    }),
    { name: "vllm-studio" },
  ),
);

if (typeof window !== "undefined") {
  void useAppStore.persist.rehydrate();
}
