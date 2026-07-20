// Theme catalogue.
//
// Six themes total: two canonical (Light / Dark) plus four dark accent
// variants (Sky, Violet, Emerald, Rose). The full surface system lives in
// `src/app/styles/globals/tokens.css` keyed on `data-theme`/`.theme-zai-*`
// selectors; the `ThemeTokens` here are the minimal set the runtime bootstrap
// (`theme-runtime.ts`) writes inline so the picker previews correctly. They
// resolve to the same workbench values, so picking a theme never fights the token
// system.

export type ThemeId =
  | "zai-light"
  | "zai-dark"
  | "zai-sky"
  | "zai-violet"
  | "zai-emerald"
  | "zai-rose"
  | "absolutely-dark"
  | "raycast-dark"
  | "midnight"
  | "slate"
  | "graphite"
  | "espresso"
  | "forest"
  | "paper";

export interface ThemeTokens {
  bg: string;
  fg: string;
  dim: string;
  border: string;
  surface: string;
  accent: string;
  hl1: string;
  hl2: string;
  hl3: string;
  err: string;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  group: string;
  swatches: [string, string, string, string];
  tokens: ThemeTokens;
}

const createTheme = (
  id: ThemeId,
  name: string,
  description: string,
  group: string,
  tokens: ThemeTokens,
): ThemeMeta => ({
  id,
  name,
  description,
  group,
  swatches: [tokens.bg, tokens.surface, tokens.accent, tokens.fg],
  tokens,
});

// Canonical surfaces, expressed as concrete values (the bootstrap script
// writes them inline before paint). These mirror the `.theme-zai-*` blocks in
// tokens.css exactly.
const ZAI_LIGHT: ThemeTokens = {
  bg: "#ffffff",
  fg: "#1a1c1f",
  dim: "#5f6165",
  border: "#1a1c1f14",
  surface: "#ffffff",
  accent: "#0d0d0d",
  hl1: "#5f6165",
  hl2: "#8c8e91",
  hl3: "#8f8f8f",
  err: "#e02e2a",
};

const ZAI_DARK: ThemeTokens = {
  bg: "#181818",
  fg: "#ffffff",
  dim: "#ffffffb3",
  border: "#ffffff14",
  surface: "#212121",
  accent: "#ffffff",
  hl1: "#ffffffb3",
  hl2: "#ffffff80",
  hl3: "#8f8f8f",
  err: "#ff6764",
};

// Accent variants keep the canonical dark surfaces; only the brand
// accent + hl1 (the data/links color) shift.
const skyAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#339cff",
});

const violetAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#ad7bf9",
});

const emeraldAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#40c977",
});

const roseAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#ff6764",
});

// Derive the supporting tokens from a bg/fg/surface/accent quartet so new
// themes stay consistent with the workbench ratios.
const darkTheme = (bg: string, fg: string, surface: string, accent: string): ThemeTokens => ({
  bg,
  fg,
  dim: `${fg}b3`,
  border: `${fg}14`,
  surface,
  accent,
  hl1: `${fg}b3`,
  hl2: `${fg}80`,
  hl3: "#8f8f8f",
  err: "#ff6764",
});

const lightTheme = (bg: string, fg: string, surface: string, accent: string): ThemeTokens => ({
  bg,
  fg,
  dim: `${fg}b3`,
  border: `${fg}1f`,
  surface,
  accent,
  hl1: `${fg}b3`,
  hl2: `${fg}80`,
  hl3: "#8f8f8f",
  err: "#e02e2a",
});

export const THEMES: ThemeMeta[] = [
  createTheme(
    "zai-dark",
    "Studio Dark",
    "Unified charcoal canvas, hairline borders, one blue accent",
    "Studio",
    ZAI_DARK,
  ),
  createTheme(
    "zai-light",
    "Studio Light",
    "Pure white canvas, near-black brand, one blue accent",
    "Studio",
    ZAI_LIGHT,
  ),
  createTheme(
    "zai-sky",
    "Sky",
    "Dark with a sky-blue brand accent",
    "Accents",
    skyAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-violet",
    "Violet",
    "Dark with a violet brand accent",
    "Accents",
    violetAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-emerald",
    "Emerald",
    "Dark with an emerald brand accent",
    "Accents",
    emeraldAccent(ZAI_DARK),
  ),
  createTheme("zai-rose", "Rose", "Dark with a rose brand accent", "Accents", roseAccent(ZAI_DARK)),
  createTheme(
    "absolutely-dark",
    "Absolutely Dark",
    "Warm charcoal with a terracotta accent, ported from Codex",
    "Ported",
    darkTheme("#2d2d2b", "#f9f9f7", "#373735", "#cc7d5e"),
  ),
  createTheme(
    "raycast-dark",
    "Raycast Dark",
    "Near-black launcher tones with an electric blue accent",
    "Ported",
    darkTheme("#141414", "#ffffff", "#1e1e1e", "#4fa3f8"),
  ),
  createTheme(
    "midnight",
    "Midnight",
    "Blue-black canvas with a soft azure accent",
    "Atmosphere",
    darkTheme("#0d1117", "#e6edf3", "#161b22", "#58a6ff"),
  ),
  createTheme(
    "slate",
    "Slate",
    "Cool graphite blues with a periwinkle accent",
    "Atmosphere",
    darkTheme("#12151a", "#e2e8f0", "#1a1f27", "#7aa2f7"),
  ),
  createTheme(
    "graphite",
    "Graphite",
    "Ultra-dark neutral with a pure white accent",
    "Atmosphere",
    darkTheme("#0d0d0d", "#ededed", "#171717", "#ffffff"),
  ),
  createTheme(
    "espresso",
    "Espresso",
    "Roasted browns with a caramel accent",
    "Atmosphere",
    darkTheme("#1a1512", "#f2e9df", "#241d18", "#d9954a"),
  ),
  createTheme(
    "forest",
    "Forest",
    "Deep evergreen with a spring-green accent",
    "Atmosphere",
    darkTheme("#0f1512", "#e8f2ec", "#18211b", "#4fd08a"),
  ),
  createTheme(
    "paper",
    "Paper",
    "Warm paper white with a burnt-sienna accent",
    "Studio",
    lightTheme("#faf8f2", "#2a2723", "#ffffff", "#b05f2d"),
  ),
];
