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

const STORE_KEY = "local-studio-state";
const DEFAULT_THEME_ID: ThemeId = "zai-dark";

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
  const ink = isLight ? "26, 28, 31" : "255, 255, 255";
  return {
    // White/ink overlays over a unified canvas: 8% surfaces, 5% hover,
    // 8% active, hairline 8% borders — the same ratios tokens.css encodes.
    "surface-2": `rgba(${ink}, 0.08)`,
    "surface-3": `rgba(${ink}, 0.05)`,
    // The rail sits one tone step above the canvas so the body reads darker
    // than the left navbar (mirrors tokens.css --color-sidebar).
    rail: isLight ? "#f9f9f9" : `color-mix(in srgb, ${tokens.bg} 97%, #ffffff)`,
    border: `rgba(${ink}, 0.08)`,
    separator: `rgba(${ink}, 0.05)`,
    hover: `rgba(${ink}, 0.05)`,
    active: `rgba(${ink}, 0.08)`,
    // Codex composer, exact: a flat elevated tone step (#282828 over the
    // #181818 canvas in dark; the mirrored light gray in light) with no
    // drop shadow and no ring.
    composer: isLight ? "#f3f3f3" : "#282828",
    "composer-footer": isLight ? "#f3f3f3" : "#282828",
    "composer-shadow": "none",
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

/* ── Master scale/shape knobs (beyond colors) the Appearance editor controls ──
   These set the canonical CSS variables that the whole UI derives from, so a
   handful of values re-theme everything uniformly. Persisted to localStorage and
   re-applied on load. */
const UI_CONTROLS_KEY = "local-studio.uiControls";

export function applyUiControl(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(name, value);
  try {
    const raw = window.localStorage.getItem(UI_CONTROLS_KEY);
    const next = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    next[name] = value;
    window.localStorage.setItem(UI_CONTROLS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function applyStoredUiControls(): void {
  if (typeof document === "undefined") return;
  try {
    const raw = window.localStorage.getItem(UI_CONTROLS_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, string>;
    for (const [name, value] of Object.entries(stored)) {
      if (typeof value === "string") document.documentElement.style.setProperty(name, value);
    }
  } catch {
    /* ignore */
  }
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
