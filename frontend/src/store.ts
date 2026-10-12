import { create, type StateCreator } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import {
  hydrateDurableUiPreferences,
  scheduleDurableUiPreferencesSave,
} from "@/lib/desktop-ui-preferences";
import {
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SIZE_ID,
  THEME_BY_ID,
  type FontFamilyId,
  type FontSizeId,
  type ThemeId,
} from "@/lib/themes";
import {
  applyFontFamilyToDocument,
  applyFontSizeToDocument,
  applyStoredUiControls,
  applyThemeToDocument,
} from "@/lib/theme-runtime";
import type { PreviewHeight } from "@/ui/preview-scroll";
import type {
  ToolKind,
  ToolPreviewHeightOverrides,
} from "@/features/agent/ui/timeline/tool-metadata";

// --- App slice ---

export interface AppSlice {
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  fileViewerFontSize: number;
  setFileViewerFontSize: (size: number) => void;
  toolPreviewHeight: PreviewHeight;
  setToolPreviewHeight: (height: PreviewHeight) => void;
  toolPreviewHeightOverrides: ToolPreviewHeightOverrides;
  setToolPreviewHeightOverride: (kind: ToolKind, height: PreviewHeight | undefined) => void;
  lastOpenFileByProject: Record<string, string>;
  setLastOpenFileByProject: (cwd: string, rel: string) => void;
}

export const DEFAULT_SIDEBAR_WIDTH = 240;

const LEGACY_DEFAULT_SIDEBAR_WIDTHS = new Set([204, 220, 224, 240, 260, 275]);

function restoredSidebarWidth(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return LEGACY_DEFAULT_SIDEBAR_WIDTHS.has(value) ? DEFAULT_SIDEBAR_WIDTH : value;
}

const createAppSlice: StateCreator<AppSlice, [], [], AppSlice> = (set) => ({
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  fileViewerFontSize: 12,
  setFileViewerFontSize: (fileViewerFontSize) => set({ fileViewerFontSize }),
  toolPreviewHeight: "md",
  setToolPreviewHeight: (toolPreviewHeight) => set({ toolPreviewHeight }),
  toolPreviewHeightOverrides: {},
  setToolPreviewHeightOverride: (kind, height) =>
    set((state) => {
      const toolPreviewHeightOverrides = { ...state.toolPreviewHeightOverrides };
      if (height) toolPreviewHeightOverrides[kind] = height;
      else delete toolPreviewHeightOverrides[kind];
      return { toolPreviewHeightOverrides };
    }),
  lastOpenFileByProject: {},
  setLastOpenFileByProject: (cwd, rel) =>
    set((state) => ({
      lastOpenFileByProject: { ...state.lastOpenFileByProject, [cwd]: rel },
    })),
});

// --- Theme slice ---

export interface ThemeSlice {
  themeId: ThemeId;
  fontFamilyId: FontFamilyId;
  fontSizeId: FontSizeId;
  setThemeId: (themeId: ThemeId) => void;
  setFontFamilyId: (fontFamilyId: FontFamilyId) => void;
  setFontSizeId: (fontSizeId: FontSizeId) => void;
}

const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => ({
  themeId: "zai-dark",
  fontFamilyId: DEFAULT_FONT_FAMILY_ID,
  fontSizeId: DEFAULT_FONT_SIZE_ID,
  setThemeId: (themeId: ThemeId) => {
    const appliedThemeId = applyThemeToDocument(themeId);
    const preferredFontFamilyId = THEME_BY_ID.get(appliedThemeId)?.fontFamilyId;
    const appliedFontFamilyId = preferredFontFamilyId
      ? applyFontFamilyToDocument(preferredFontFamilyId)
      : undefined;
    set({
      themeId: appliedThemeId,
      ...(appliedFontFamilyId ? { fontFamilyId: appliedFontFamilyId } : {}),
    });
  },
  setFontFamilyId: (fontFamilyId: FontFamilyId) => {
    const appliedFontFamilyId = applyFontFamilyToDocument(fontFamilyId);
    set({ fontFamilyId: appliedFontFamilyId });
  },
  setFontSizeId: (fontSizeId: FontSizeId) => {
    const appliedFontSizeId = applyFontSizeToDocument(fontSizeId);
    set({ fontSizeId: appliedFontSizeId });
  },
});

// --- Store ---

export type AppStore = AppSlice &
  ThemeSlice & {
    desktopSidebarPinnedOpen: boolean;
    setDesktopSidebarPinnedOpen: (open: boolean) => void;
    // Phone-only navigation drawer. Lives in the store because the agent chat
    // header owns the hamburger there, while the drawer itself is in the shell.
    mobileNavOpen: boolean;
    setMobileNavOpen: (open: boolean) => void;
  };

const createAppStoreImpl: StateCreator<AppStore, [], [], AppStore> = (set, ...args) => ({
  ...createAppSlice(set, ...args),
  ...createThemeSlice(set, ...args),
  desktopSidebarPinnedOpen: true,
  setDesktopSidebarPinnedOpen: (desktopSidebarPinnedOpen) => set({ desktopSidebarPinnedOpen }),
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
});

let appStorePersistenceReady = false;

const baseStorage = createJSONStorage(() =>
  typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage),
);

const storage = baseStorage
  ? {
      ...baseStorage,
      setItem: (...args: Parameters<typeof baseStorage.setItem>) =>
        appStorePersistenceReady ? baseStorage.setItem(...args) : undefined,
      removeItem: (...args: Parameters<typeof baseStorage.removeItem>) =>
        appStorePersistenceReady ? baseStorage.removeItem(...args) : undefined,
    }
  : undefined;

export const useAppStore = create<AppStore>()(
  devtools(
    persist(createAppStoreImpl, {
      name: "local-studio-state",
      storage,
      skipHydration: true,
      partialize: (state) => ({
        themeId: state.themeId,
        fontFamilyId: state.fontFamilyId,
        fontSizeId: state.fontSizeId,
        desktopSidebarPinnedOpen: state.desktopSidebarPinnedOpen,
        sidebarWidth: state.sidebarWidth,
        fileViewerFontSize: state.fileViewerFontSize,
        toolPreviewHeight: state.toolPreviewHeight,
        toolPreviewHeightOverrides: state.toolPreviewHeightOverrides,
        lastOpenFileByProject: state.lastOpenFileByProject,
      }),
      merge: (persisted, current) => {
        const persistedRecord = (persisted ?? {}) as Record<string, unknown>;
        const persistedStore = (persisted ?? {}) as Partial<AppStore>;
        return {
          ...current,
          ...persistedStore,
          sidebarWidth: restoredSidebarWidth(persistedRecord.sidebarWidth, current.sidebarWidth),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.themeId) state.setThemeId(state.themeId);
        if (state?.fontFamilyId) state.setFontFamilyId(state.fontFamilyId);
        if (state?.fontSizeId) state.setFontSizeId(state.fontSizeId);
        applyStoredUiControls();
      },
    }),
    { name: "local-studio" },
  ),
);

if (typeof window !== "undefined") {
  void (async () => {
    try {
      await hydrateDurableUiPreferences();
      await useAppStore.persist.rehydrate();
    } finally {
      appStorePersistenceReady = true;
      scheduleDurableUiPreferencesSave();
      useAppStore.subscribe(() => scheduleDurableUiPreferencesSave());
    }
  })();
}
