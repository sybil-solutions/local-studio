// Theme catalogue data lives in themes-data.ts; this module exposes the lookup
// maps and font options the UI consumes.
import { THEMES, type FontFamilyId, type ThemeId, type ThemeMeta } from "./themes-data";

export type { FontFamilyId, ThemeId, ThemeMeta, ThemeTokens, ThemeUiTokens } from "./themes-data";
export { THEMES } from "./themes-data";

export type FontSizeId = "sm" | "md" | "lg" | "xl" | "2xl";

export interface FontFamilyOption {
  id: FontFamilyId;
  label: string;
  cssValue: string;
}

export interface FontSizeOption {
  id: FontSizeId;
  label: string;
  cssValue: string;
}

export const DEFAULT_FONT_FAMILY_ID: FontFamilyId = "geist";
export const DEFAULT_FONT_SIZE_ID: FontSizeId = "md";

export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  {
    id: "openai",
    label: "OpenAI Sans",
    cssValue: "'OpenAI Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  {
    id: "geist",
    label: "Geist",
    cssValue: "var(--font-geist-sans, 'Geist'), system-ui, sans-serif",
  },
  {
    id: "system",
    label: "System UI",
    cssValue: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: "avenir",
    label: "Avenir",
    cssValue: "'Avenir Next', Avenir, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  {
    id: "serif",
    label: "Serif",
    cssValue: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  },
  {
    id: "mono",
    label: "Mono",
    cssValue:
      "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
  {
    id: "rounded",
    label: "Rounded",
    cssValue:
      "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Avenir Next Rounded', system-ui, sans-serif",
  },
];

export const FONT_SIZE_OPTIONS: FontSizeOption[] = [
  { id: "sm", label: "Small", cssValue: "14px" },
  { id: "md", label: "Medium", cssValue: "16px" },
  { id: "lg", label: "Large", cssValue: "17px" },
  { id: "xl", label: "XL", cssValue: "18px" },
  { id: "2xl", label: "2XL", cssValue: "20px" },
];

export const FONT_FAMILY_BY_ID = new Map<FontFamilyId, FontFamilyOption>(
  FONT_FAMILY_OPTIONS.map((option) => [option.id, option]),
);

export const FONT_SIZE_BY_ID = new Map<FontSizeId, FontSizeOption>(
  FONT_SIZE_OPTIONS.map((option) => [option.id, option]),
);

export const THEME_BY_ID = new Map<ThemeId, ThemeMeta>(THEMES.map((theme) => [theme.id, theme]));
