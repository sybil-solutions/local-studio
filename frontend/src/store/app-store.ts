import { create, type StateCreator } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { createAppSlice, type AppSlice } from "./app-slice";
import { createThemeSlice, type ThemeSlice } from "./theme-slice";
import {
  hydrateDurableUiPreferences,
  scheduleDurableUiPreferencesSave,
} from "@/lib/desktop-ui-preferences";

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
        fileViewerFontSize: state.fileViewerFontSize,
        lastOpenFileByProject: state.lastOpenFileByProject,
      }),
      merge: (persisted, current) => {
        const persistedRecord = (persisted ?? {}) as Record<string, unknown>;
        const persistedStore = (persisted ?? {}) as Partial<AppStore>;
        return {
          ...current,
          ...persistedStore,
          // 240px/220px were old defaults. Keep genuinely custom widths, but
          // migrate default-width sidebars to the tighter desktop rail.
          sidebarWidth:
            persistedRecord.sidebarWidth === 240 || persistedRecord.sidebarWidth === 220
              ? 204
              : (persistedStore.sidebarWidth ?? current.sidebarWidth),
          sidebar: {
            ...current.sidebar,
            collapsed: persistedRecord.sidebarCollapsed === true,
          },
        };
      },
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
  void (async () => {
    await hydrateDurableUiPreferences();
    await useAppStore.persist.rehydrate();
    scheduleDurableUiPreferencesSave();
    useAppStore.subscribe(() => scheduleDurableUiPreferencesSave());
  })();
}
