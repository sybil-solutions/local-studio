import type { StateCreator } from "zustand";
import { THEME_BY_ID } from "@/lib/themes";
import type { ThemeId } from "@/lib/themes";

export interface ThemeSlice {
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => ({
  themeId: "warm-paper",
  setThemeId: (themeId: ThemeId) => {
    if (typeof document === "undefined") {
      set({ themeId });
      return;
    }

    const theme = THEME_BY_ID.get(themeId);
    const fallbackTheme = THEME_BY_ID.get("warm-paper");
    const nextTheme = theme ?? fallbackTheme;
    if (!nextTheme) {
      set({ themeId });
      return;
    }

    document.documentElement.setAttribute("data-theme", nextTheme.id);

    Object.entries(nextTheme.tokens).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value);
    });

    set({ themeId: nextTheme.id });
  },
});
