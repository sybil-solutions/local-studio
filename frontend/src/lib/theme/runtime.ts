import {
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SIZE_ID,
  FONT_FAMILY_BY_ID,
  FONT_SIZE_BY_ID,
  THEME_BY_ID,
  type FontFamilyId,
  type FontSizeId,
  type ThemeId,
  type ThemeTokens,
} from "@/lib/themes";

const STORE_KEY = "vllm-studio-state";
const DEFAULT_THEME_ID: ThemeId = "omlx-dark";

const THEME_TOKENS_BY_ID = Object.fromEntries(
  Array.from(THEME_BY_ID.entries()).map(([id, theme]) => [id, theme.tokens]),
) as Record<string, ThemeTokens>;

function lightnessFromColor(value: string): number | null {
  const hsl = value.match(/hsla?\([^,]+,\s*[^,]+,\s*([\d.]+)%/i);
  if (hsl) return Number(hsl[1]);

  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const raw = hex[1];
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => part + part)
          .join("")
      : raw;
  const r = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const g = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const b = Number.parseInt(expanded.slice(4, 6), 16) / 255;
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100;
}

function deriveThemeUiTokens(tokens: ThemeTokens): Record<string, string> {
  const isLight = (lightnessFromColor(tokens.bg) ?? 0) > 50;
  const ink = isLight ? "0, 0, 0" : "255, 255, 255";
  return {
    "surface-2": "color-mix(in srgb, var(--surface) 88%, var(--fg) 12%)",
    "surface-3": "color-mix(in srgb, var(--surface) 78%, var(--fg) 22%)",
    rail: "color-mix(in srgb, var(--surface) 72%, var(--bg) 28%)",
    border: `rgba(${ink}, ${isLight ? "0.12" : "0.12"})`,
    separator: `rgba(${ink}, ${isLight ? "0.18" : "0.18"})`,
    hover: `rgba(${ink}, ${isLight ? "0.055" : "0.07"})`,
    active: `rgba(${ink}, ${isLight ? "0.085" : "0.11"})`,
    composer: "color-mix(in srgb, var(--surface) 92%, var(--bg) 8%)",
    "composer-footer": "color-mix(in srgb, var(--surface) 72%, var(--bg) 28%)",
    "composer-shadow": isLight
      ? "0 12px 36px rgba(0, 0, 0, 0.08)"
      : "0 18px 60px rgba(0, 0, 0, 0.45)",
  };
}

const THEME_UI_TOKENS_BY_ID = Object.fromEntries(
  Array.from(THEME_BY_ID.entries()).map(([id, theme]) => [id, deriveThemeUiTokens(theme.tokens)]),
) as Record<string, Record<string, string>>;

const FONT_FAMILY_CSS_BY_ID = Object.fromEntries(
  Array.from(FONT_FAMILY_BY_ID.entries()).map(([id, option]) => [id, option.cssValue]),
) as Record<string, string>;

const FONT_SIZE_CSS_BY_ID = Object.fromEntries(
  Array.from(FONT_SIZE_BY_ID.entries()).map(([id, option]) => [id, option.cssValue]),
) as Record<string, string>;

function setThemeTokens(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  for (const [key, value] of Object.entries({ ...tokens, ...deriveThemeUiTokens(tokens) })) {
    document.documentElement.style.setProperty(`--${key}`, value);
  }
}

export function applyThemeToDocument(themeId: ThemeId): ThemeId {
  if (typeof document === "undefined") return themeId;

  const nextTheme = THEME_BY_ID.get(themeId) ?? THEME_BY_ID.get(DEFAULT_THEME_ID);
  if (!nextTheme) return themeId;

  document.documentElement.setAttribute("data-theme", nextTheme.id);
  setThemeTokens(nextTheme.tokens);
  return nextTheme.id;
}

export function applyFontFamilyToDocument(fontFamilyId: FontFamilyId): FontFamilyId {
  if (typeof document === "undefined") return fontFamilyId;

  const nextFont =
    FONT_FAMILY_BY_ID.get(fontFamilyId) ?? FONT_FAMILY_BY_ID.get(DEFAULT_FONT_FAMILY_ID);
  if (!nextFont) return fontFamilyId;

  document.documentElement.style.setProperty("--font-sans", nextFont.cssValue);
  return nextFont.id;
}

export function applyFontSizeToDocument(fontSizeId: FontSizeId): FontSizeId {
  if (typeof document === "undefined") return fontSizeId;

  const nextSize = FONT_SIZE_BY_ID.get(fontSizeId) ?? FONT_SIZE_BY_ID.get(DEFAULT_FONT_SIZE_ID);
  if (!nextSize) return fontSizeId;

  document.documentElement.style.setProperty("--app-font-size", nextSize.cssValue);
  return nextSize.id;
}

export function applyTokensToDocument(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  setThemeTokens(tokens);
}

export function getThemeBootstrapScript(): string {
  const bootstrapData = {
    storeKey: STORE_KEY,
    defaultThemeId: DEFAULT_THEME_ID,
    defaultFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    defaultFontSizeId: DEFAULT_FONT_SIZE_ID,
    themeTokensById: THEME_TOKENS_BY_ID,
    themeUiTokensById: THEME_UI_TOKENS_BY_ID,
    fontFamilyCssById: FONT_FAMILY_CSS_BY_ID,
    fontSizeCssById: FONT_SIZE_CSS_BY_ID,
  };

  return `
    (function () {
      try {
        var data = ${JSON.stringify(bootstrapData)};
        var raw = localStorage.getItem(data.storeKey) || "{}";
        var parsed = JSON.parse(raw);
        var state = (parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object")
          ? parsed.state
          : parsed;

        if (!state || typeof state !== "object") {
          state = {};
        }

        var themeId = typeof state.themeId === "string" ? state.themeId : data.defaultThemeId;
        var themeTokens = data.themeTokensById[themeId] || data.themeTokensById[data.defaultThemeId];
        var resolvedThemeId = data.themeTokensById[themeId] ? themeId : data.defaultThemeId;

        document.documentElement.setAttribute("data-theme", resolvedThemeId);

        if (themeTokens && typeof themeTokens === "object") {
          for (var tokenKey in themeTokens) {
            if (Object.prototype.hasOwnProperty.call(themeTokens, tokenKey)) {
              document.documentElement.style.setProperty("--" + tokenKey, themeTokens[tokenKey]);
            }
          }
        }

        var themeUiTokens = data.themeUiTokensById[resolvedThemeId] || {};
        for (var uiTokenKey in themeUiTokens) {
          if (Object.prototype.hasOwnProperty.call(themeUiTokens, uiTokenKey)) {
            document.documentElement.style.setProperty("--" + uiTokenKey, themeUiTokens[uiTokenKey]);
          }
        }

        var fontFamilyId = typeof state.fontFamilyId === "string" ? state.fontFamilyId : data.defaultFontFamilyId;
        var fontFamilyCss = data.fontFamilyCssById[fontFamilyId] || data.fontFamilyCssById[data.defaultFontFamilyId];
        if (fontFamilyCss) {
          document.documentElement.style.setProperty("--font-sans", fontFamilyCss);
        }

        var fontSizeId = typeof state.fontSizeId === "string" ? state.fontSizeId : data.defaultFontSizeId;
        var fontSizeCss = data.fontSizeCssById[fontSizeId] || data.fontSizeCssById[data.defaultFontSizeId];
        if (fontSizeCss) {
          document.documentElement.style.setProperty("--app-font-size", fontSizeCss);
        }
      } catch (e) {
        // no-op
      }
    })();
  `;
}
