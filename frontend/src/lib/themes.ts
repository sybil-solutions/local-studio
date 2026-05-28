export type ThemeId =
  | "omlx-light"
  | "omlx-dark"
  | "warm-paper"
  | "midnight-blue"
  | "nord"
  | "dracula"
  | "monokai"
  | "solarized-dark"
  | "catppuccin-mocha"
  | "gruvbox-dark"
  | "tokyo-night"
  | "rose-pine"
  | "carbon-noir"
  | "onyx"
  | "graphite-black"
  | "slate-shade"
  | "basalt"
  | "gunmetal"
  | "asphalt"
  | "charcoal"
  | "obsidian"
  | "inkstone"
  | "midnight-ink"
  | "deep-ocean"
  | "arctic-ocean"
  | "polar-ice"
  | "glacier-rift"
  | "cobalt-night"
  | "blue-fjord"
  | "teal-abyss"
  | "violet-gloom"
  | "amethyst-shadow"
  | "indigo-night"
  | "mauve-dusk"
  | "plum-cinder"
  | "royal-ink"
  | "lavender-storm"
  | "ember-vault"
  | "rusted-copper"
  | "crimson-burn"
  | "emerald-depth"
  | "pine-shadow"
  | "abyssal-voyager"
  | "obsidian-sharp"
  | "neon-night"
  | "deep-space-high"
  | "volcanic-ash"
  | "arctic-contrast"
  | "jungle-night"
  | "cyber-black"
  | "royal-contrast"
  | "desert-dark"
  | "blackhole-void"
  | "pitch-ink"
  | "noir-terminal"
  | "eclipse-carbon"
  | "ghost-contrast"
  | "razor-midnight"
  | "blackout-pro"
  | "obsidian-volt"
  | "stealth-cobalt"
  | "stealth-crimson"
  | "stealth-lime"
  | "stealth-cyan"
  | "stealth-violet"
  | "stealth-amber"
  | "stealth-rose"
  | "ultra-slate"
  | "void-neon"
  | "mono-killer"
  | "deep-graphite-hc"
  | "tungsten-night"
  | "mono-etch"
  | "ash-paper"
  | "graphite-fog"
  | "noir-dim";

export type FontFamilyId = "geist" | "system" | "serif" | "mono" | "rounded";
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
    id: "geist",
    label: "Geist",
    cssValue: "var(--font-geist-sans), system-ui, sans-serif",
  },
  {
    id: "system",
    label: "System UI",
    cssValue: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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

export const THEMES: ThemeMeta[] = [
  createTheme(
    "omlx-light",
    "oMLX Light",
    "Warm cream paper with amber neutrals and blue accents",
    "Classic",
    {
      bg: "hsl(40, 20%, 95%)",
      fg: "hsl(30, 10%, 10%)",
      dim: "hsl(30, 5%, 44%)",
      border: "hsl(35, 12%, 87%)",
      surface: "hsl(38, 18%, 91%)",
      accent: "hsl(217, 91%, 60%)",
      hl1: "hsl(217, 91%, 60%)",
      hl2: "hsl(142, 71%, 45%)",
      hl3: "hsl(38, 92%, 50%)",
      err: "hsl(0, 84%, 60%)",
    },
  ),

  createTheme(
    "omlx-dark",
    "oMLX Dark",
    "True black with cool zinc grays and blue accents",
    "Classic",
    {
      bg: "hsl(0, 0%, 4%)",
      fg: "hsl(0, 0%, 92%)",
      dim: "hsl(0, 0%, 46%)",
      border: "hsl(0, 0%, 14%)",
      surface: "hsl(0, 0%, 8%)",
      accent: "hsl(217, 91%, 65%)",
      hl1: "hsl(217, 70%, 60%)",
      hl2: "hsl(142, 50%, 50%)",
      hl3: "hsl(38, 80%, 55%)",
      err: "hsl(0, 70%, 60%)",
    },
  ),

  createTheme("warm-paper", "Warm Paper", "Warm browns and tans with amber accents", "Classic", {
    bg: "hsl(30, 5%, 9%)",
    fg: "hsl(40, 20%, 92%)",
    dim: "hsl(35, 12%, 58%)",
    border: "hsl(30, 6%, 22%)",
    surface: "hsl(30, 5%, 14%)",
    accent: "hsl(32, 94%, 44%)",
    hl1: "hsl(270, 50%, 55%)",
    hl2: "hsl(142, 45%, 45%)",
    hl3: "hsl(38, 85%, 55%)",
    err: "hsl(0, 60%, 55%)",
  }),

  createTheme(
    "midnight-blue",
    "Midnight Blue",
    "Deep blue backgrounds with cool blue accents",
    "Blue",
    {
      bg: "hsl(222, 30%, 7%)",
      fg: "hsl(210, 25%, 93%)",
      dim: "hsl(215, 15%, 55%)",
      border: "hsl(222, 18%, 20%)",
      surface: "hsl(222, 25%, 13%)",
      accent: "hsl(217, 90%, 58%)",
      hl1: "hsl(217, 70%, 58%)",
      hl2: "hsl(160, 50%, 44%)",
      hl3: "hsl(38, 80%, 52%)",
      err: "hsl(0, 62%, 55%)",
    },
  ),

  createTheme("nord", "Nord", "Arctic blue-greens inspired by the Nord palette", "Blue", {
    bg: "hsl(220, 16%, 12%)",
    fg: "hsl(218, 27%, 94%)",
    dim: "hsl(219, 14%, 56%)",
    border: "hsl(220, 13%, 24%)",
    surface: "hsl(220, 16%, 18%)",
    accent: "hsl(193, 60%, 55%)",
    hl1: "hsl(210, 45%, 58%)",
    hl2: "hsl(142, 35%, 48%)",
    hl3: "hsl(38, 70%, 55%)",
    err: "hsl(354, 50%, 56%)",
  }),

  createTheme("dracula", "Dracula", "Purple accents on a dark purple-gray background", "Purple", {
    bg: "hsl(231, 15%, 12%)",
    fg: "hsl(60, 30%, 96%)",
    dim: "hsl(230, 15%, 55%)",
    border: "hsl(232, 12%, 25%)",
    surface: "hsl(231, 15%, 18%)",
    accent: "hsl(265, 80%, 68%)",
    hl1: "hsl(265, 80%, 68%)",
    hl2: "hsl(135, 55%, 55%)",
    hl3: "hsl(65, 80%, 60%)",
    err: "hsl(0, 100%, 67%)",
  }),

  createTheme(
    "monokai",
    "Monokai",
    "Classic dev theme with green, orange, and pink accents",
    "Green",
    {
      bg: "hsl(70, 8%, 8%)",
      fg: "hsl(60, 30%, 96%)",
      dim: "hsl(60, 10%, 52%)",
      border: "hsl(60, 5%, 21%)",
      surface: "hsl(70, 8%, 14%)",
      accent: "hsl(80, 76%, 53%)",
      hl1: "hsl(261, 55%, 62%)",
      hl2: "hsl(80, 76%, 53%)",
      hl3: "hsl(54, 70%, 60%)",
      err: "hsl(338, 95%, 56%)",
    },
  ),

  createTheme(
    "solarized-dark",
    "Solarized Dark",
    "Ethan Schoonover's precision-crafted dark palette",
    "Neutral",
    {
      bg: "hsl(192, 100%, 8%)",
      fg: "hsl(44, 87%, 94%)",
      dim: "hsl(186, 13%, 55%)",
      border: "hsl(192, 40%, 18%)",
      surface: "hsl(192, 80%, 13%)",
      accent: "hsl(45, 100%, 35%)",
      hl1: "hsl(237, 45%, 58%)",
      hl2: "hsl(68, 45%, 42%)",
      hl3: "hsl(18, 80%, 48%)",
      err: "hsl(1, 72%, 52%)",
    },
  ),

  createTheme(
    "catppuccin-mocha",
    "Catppuccin Mocha",
    "Soothing pastel colors on a rich dark base",
    "Purple",
    {
      bg: "hsl(240, 21%, 10%)",
      fg: "hsl(227, 68%, 88%)",
      dim: "hsl(228, 20%, 55%)",
      border: "hsl(237, 16%, 24%)",
      surface: "hsl(240, 21%, 16%)",
      accent: "hsl(267, 84%, 78%)",
      hl1: "hsl(267, 84%, 78%)",
      hl2: "hsl(115, 54%, 62%)",
      hl3: "hsl(40, 70%, 65%)",
      err: "hsl(343, 81%, 68%)",
    },
  ),

  createTheme(
    "gruvbox-dark",
    "Gruvbox Dark",
    "Retro warm tones with orange and green accents",
    "Warm",
    {
      bg: "hsl(0, 0%, 13%)",
      fg: "hsl(48, 45%, 86%)",
      dim: "hsl(40, 15%, 52%)",
      border: "hsl(20, 5%, 25%)",
      surface: "hsl(0, 0%, 19%)",
      accent: "hsl(24, 96%, 55%)",
      hl1: "hsl(323, 40%, 56%)",
      hl2: "hsl(104, 35%, 50%)",
      hl3: "hsl(40, 73%, 49%)",
      err: "hsl(0, 60%, 52%)",
    },
  ),

  createTheme(
    "tokyo-night",
    "Tokyo Night",
    "Blue-purple hues inspired by Tokyo city lights",
    "Blue",
    {
      bg: "hsl(235, 18%, 8%)",
      fg: "hsl(226, 64%, 88%)",
      dim: "hsl(228, 18%, 52%)",
      border: "hsl(234, 14%, 22%)",
      surface: "hsl(235, 18%, 14%)",
      accent: "hsl(218, 90%, 68%)",
      hl1: "hsl(266, 65%, 68%)",
      hl2: "hsl(143, 40%, 55%)",
      hl3: "hsl(35, 80%, 60%)",
      err: "hsl(348, 75%, 62%)",
    },
  ),

  createTheme("rose-pine", "Rosé Pine", "Muted pinks and golds on a dark canvas", "Purple", {
    bg: "hsl(249, 22%, 8%)",
    fg: "hsl(245, 50%, 94%)",
    dim: "hsl(247, 15%, 50%)",
    border: "hsl(249, 15%, 22%)",
    surface: "hsl(249, 22%, 14%)",
    accent: "hsl(2, 55%, 75%)",
    hl1: "hsl(267, 50%, 65%)",
    hl2: "hsl(143, 30%, 55%)",
    hl3: "hsl(35, 80%, 62%)",
    err: "hsl(343, 65%, 60%)",
  }),

  createTheme("carbon-noir", "Carbon Noir", "Inky blacks with a warm amber pulse", "Neutrals", {
    bg: "hsl(0, 0%, 6%)",
    fg: "hsl(0, 0%, 95%)",
    dim: "hsl(35, 11%, 55%)",
    border: "hsl(0, 0%, 19%)",
    surface: "hsl(0, 0%, 12%)",
    accent: "hsl(42, 85%, 58%)",
    hl1: "hsl(42, 90%, 59%)",
    hl2: "hsl(20, 20%, 68%)",
    hl3: "hsl(37, 75%, 60%)",
    err: "hsl(0, 65%, 58%)",
  }),

  createTheme("onyx", "Onyx", "Dense black tones with a crisp slate blue accent", "Neutrals", {
    bg: "hsl(0, 0%, 5%)",
    fg: "hsl(0, 0%, 95%)",
    dim: "hsl(35, 12%, 53%)",
    border: "hsl(210, 5%, 19%)",
    surface: "hsl(210, 5%, 11%)",
    accent: "hsl(225, 78%, 60%)",
    hl1: "hsl(225, 70%, 60%)",
    hl2: "hsl(185, 52%, 48%)",
    hl3: "hsl(210, 65%, 56%)",
    err: "hsl(352, 66%, 55%)",
  }),

  createTheme(
    "graphite-black",
    "Graphite Black",
    "Stone-like neutrals with deep cobalt guidance",
    "Neutrals",
    {
      bg: "hsl(0, 0%, 7%)",
      fg: "hsl(0, 0%, 93%)",
      dim: "hsl(35, 12%, 50%)",
      border: "hsl(0, 0%, 20%)",
      surface: "hsl(0, 0%, 13%)",
      accent: "hsl(198, 35%, 52%)",
      hl1: "hsl(198, 45%, 57%)",
      hl2: "hsl(175, 27%, 52%)",
      hl3: "hsl(40, 35%, 68%)",
      err: "hsl(0, 64%, 56%)",
    },
  ),

  createTheme(
    "slate-shade",
    "Slate Shade",
    "Blue-leaning grays with a soft luminous accent",
    "Neutrals",
    {
      bg: "hsl(214, 16%, 8%)",
      fg: "hsl(214, 35%, 94%)",
      dim: "hsl(214, 12%, 57%)",
      border: "hsl(214, 14%, 23%)",
      surface: "hsl(214, 16%, 15%)",
      accent: "hsl(210, 82%, 64%)",
      hl1: "hsl(210, 65%, 68%)",
      hl2: "hsl(185, 58%, 50%)",
      hl3: "hsl(55, 80%, 52%)",
      err: "hsl(354, 64%, 56%)",
    },
  ),

  createTheme(
    "basalt",
    "Basalt",
    "Cool graphite and smoky blue with restrained contrast",
    "Neutrals",
    {
      bg: "hsl(212, 15%, 9%)",
      fg: "hsl(212, 33%, 93%)",
      dim: "hsl(214, 10%, 52%)",
      border: "hsl(212, 13%, 20%)",
      surface: "hsl(212, 16%, 13%)",
      accent: "hsl(188, 65%, 58%)",
      hl1: "hsl(188, 74%, 60%)",
      hl2: "hsl(162, 40%, 48%)",
      hl3: "hsl(26, 35%, 60%)",
      err: "hsl(0, 62%, 57%)",
    },
  ),

  createTheme("gunmetal", "Gunmetal", "Charcoal steel with cool blue accents", "Neutrals", {
    bg: "hsl(205, 22%, 11%)",
    fg: "hsl(205, 25%, 92%)",
    dim: "hsl(207, 12%, 55%)",
    border: "hsl(205, 15%, 23%)",
    surface: "hsl(205, 16%, 14%)",
    accent: "hsl(190, 60%, 60%)",
    hl1: "hsl(190, 70%, 58%)",
    hl2: "hsl(152, 44%, 48%)",
    hl3: "hsl(35, 55%, 60%)",
    err: "hsl(1, 66%, 56%)",
  }),

  createTheme("asphalt", "Asphalt", "Muted darks with a blue-cobalt signal", "Neutrals", {
    bg: "hsl(220, 18%, 12%)",
    fg: "hsl(220, 28%, 92%)",
    dim: "hsl(220, 13%, 54%)",
    border: "hsl(220, 14%, 24%)",
    surface: "hsl(220, 18%, 15%)",
    accent: "hsl(196, 48%, 58%)",
    hl1: "hsl(196, 58%, 60%)",
    hl2: "hsl(154, 52%, 48%)",
    hl3: "hsl(40, 46%, 60%)",
    err: "hsl(352, 63%, 56%)",
  }),

  createTheme("charcoal", "Charcoal", "A charcoal canvas with blue-lilac structure", "Neutrals", {
    bg: "hsl(225, 15%, 8%)",
    fg: "hsl(225, 22%, 94%)",
    dim: "hsl(225, 11%, 49%)",
    border: "hsl(225, 13%, 21%)",
    surface: "hsl(225, 18%, 13%)",
    accent: "hsl(220, 55%, 54%)",
    hl1: "hsl(220, 64%, 58%)",
    hl2: "hsl(180, 45%, 47%)",
    hl3: "hsl(45, 70%, 60%)",
    err: "hsl(355, 62%, 56%)",
  }),

  createTheme("obsidian", "Obsidian", "Black basalt with violet-led punctuation", "Neutrals", {
    bg: "hsl(230, 18%, 7%)",
    fg: "hsl(230, 22%, 93%)",
    dim: "hsl(230, 12%, 49%)",
    border: "hsl(230, 14%, 20%)",
    surface: "hsl(230, 15%, 13%)",
    accent: "hsl(229, 77%, 59%)",
    hl1: "hsl(229, 60%, 59%)",
    hl2: "hsl(160, 46%, 46%)",
    hl3: "hsl(45, 84%, 56%)",
    err: "hsl(0, 64%, 57%)",
  }),

  createTheme("inkstone", "Inkstone", "Ink and inkstone with a cool ultramarine edge", "Neutrals", {
    bg: "hsl(232, 11%, 12%)",
    fg: "hsl(232, 18%, 93%)",
    dim: "hsl(232, 11%, 56%)",
    border: "hsl(232, 12%, 25%)",
    surface: "hsl(232, 16%, 16%)",
    accent: "hsl(218, 56%, 64%)",
    hl1: "hsl(218, 72%, 64%)",
    hl2: "hsl(158, 42%, 50%)",
    hl3: "hsl(36, 68%, 64%)",
    err: "hsl(353, 62%, 56%)",
  }),

  createTheme(
    "midnight-ink",
    "Midnight Ink",
    "Blue-black depth with a cool violet ribbon",
    "Blue",
    {
      bg: "hsl(245, 18%, 9%)",
      fg: "hsl(245, 22%, 94%)",
      dim: "hsl(245, 10%, 50%)",
      border: "hsl(245, 14%, 22%)",
      surface: "hsl(245, 17%, 14%)",
      accent: "hsl(236, 52%, 56%)",
      hl1: "hsl(236, 62%, 58%)",
      hl2: "hsl(165, 38%, 46%)",
      hl3: "hsl(40, 48%, 55%)",
      err: "hsl(350, 63%, 56%)",
    },
  ),

  createTheme("deep-ocean", "Deep Ocean", "Muted navy with strong marine glow", "Blue", {
    bg: "hsl(210, 35%, 8%)",
    fg: "hsl(210, 22%, 93%)",
    dim: "hsl(210, 12%, 58%)",
    border: "hsl(210, 24%, 22%)",
    surface: "hsl(210, 35%, 13%)",
    accent: "hsl(193, 75%, 58%)",
    hl1: "hsl(193, 85%, 58%)",
    hl2: "hsl(167, 52%, 45%)",
    hl3: "hsl(47, 90%, 57%)",
    err: "hsl(0, 64%, 58%)",
  }),

  createTheme("arctic-ocean", "Arctic Ocean", "Deep water tones with cleaner icy balance", "Blue", {
    bg: "hsl(199, 42%, 9%)",
    fg: "hsl(199, 20%, 95%)",
    dim: "hsl(199, 14%, 58%)",
    border: "hsl(199, 14%, 20%)",
    surface: "hsl(199, 42%, 14%)",
    accent: "hsl(190, 65%, 65%)",
    hl1: "hsl(190, 75%, 64%)",
    hl2: "hsl(152, 44%, 60%)",
    hl3: "hsl(47, 78%, 59%)",
    err: "hsl(0, 64%, 55%)",
  }),

  createTheme("polar-ice", "Polar Ice", "Blue-grays with a restrained cyan highlight", "Blue", {
    bg: "hsl(203, 40%, 10%)",
    fg: "hsl(203, 14%, 94%)",
    dim: "hsl(203, 11%, 56%)",
    border: "hsl(203, 10%, 24%)",
    surface: "hsl(203, 15%, 16%)",
    accent: "hsl(190, 55%, 64%)",
    hl1: "hsl(190, 60%, 64%)",
    hl2: "hsl(160, 40%, 56%)",
    hl3: "hsl(45, 70%, 54%)",
    err: "hsl(0, 65%, 54%)",
  }),

  createTheme(
    "glacier-rift",
    "Glacier Rift",
    "A crisp blue gradient tuned for low fatigue",
    "Blue",
    {
      bg: "hsl(196, 36%, 11%)",
      fg: "hsl(196, 18%, 93%)",
      dim: "hsl(196, 10%, 54%)",
      border: "hsl(196, 12%, 21%)",
      surface: "hsl(196, 36%, 15%)",
      accent: "hsl(177, 58%, 62%)",
      hl1: "hsl(177, 72%, 62%)",
      hl2: "hsl(140, 37%, 55%)",
      hl3: "hsl(44, 66%, 53%)",
      err: "hsl(0, 62%, 55%)",
    },
  ),

  createTheme(
    "cobalt-night",
    "Cobalt Night",
    "Classic terminal cobalt with elevated contrast",
    "Blue",
    {
      bg: "hsl(225, 45%, 10%)",
      fg: "hsl(225, 20%, 93%)",
      dim: "hsl(225, 15%, 56%)",
      border: "hsl(225, 18%, 23%)",
      surface: "hsl(225, 18%, 13%)",
      accent: "hsl(214, 78%, 65%)",
      hl1: "hsl(214, 86%, 66%)",
      hl2: "hsl(168, 42%, 52%)",
      hl3: "hsl(58, 74%, 58%)",
      err: "hsl(0, 64%, 56%)",
    },
  ),

  createTheme("blue-fjord", "Blue Fjord", "Blue-grays with a calm, focused signal", "Blue", {
    bg: "hsl(224, 48%, 11%)",
    fg: "hsl(224, 20%, 94%)",
    dim: "hsl(224, 15%, 55%)",
    border: "hsl(224, 12%, 23%)",
    surface: "hsl(224, 24%, 16%)",
    accent: "hsl(198, 70%, 66%)",
    hl1: "hsl(198, 75%, 63%)",
    hl2: "hsl(157, 43%, 54%)",
    hl3: "hsl(46, 82%, 54%)",
    err: "hsl(352, 63%, 56%)",
  }),

  createTheme("teal-abyss", "Teal Abyss", "Forest-dark with teal navigation accents", "Blue", {
    bg: "hsl(191, 46%, 9%)",
    fg: "hsl(191, 15%, 94%)",
    dim: "hsl(191, 14%, 56%)",
    border: "hsl(191, 16%, 20%)",
    surface: "hsl(191, 45%, 14%)",
    accent: "hsl(176, 52%, 57%)",
    hl1: "hsl(176, 68%, 58%)",
    hl2: "hsl(165, 40%, 54%)",
    hl3: "hsl(49, 72%, 56%)",
    err: "hsl(355, 62%, 56%)",
  }),

  createTheme(
    "violet-gloom",
    "Violet Gloom",
    "Dusky violet with soft blue-gray underlight",
    "Purple",
    {
      bg: "hsl(262, 24%, 9%)",
      fg: "hsl(262, 25%, 94%)",
      dim: "hsl(262, 18%, 58%)",
      border: "hsl(262, 20%, 22%)",
      surface: "hsl(262, 24%, 14%)",
      accent: "hsl(270, 55%, 66%)",
      hl1: "hsl(270, 68%, 66%)",
      hl2: "hsl(140, 45%, 53%)",
      hl3: "hsl(34, 70%, 60%)",
      err: "hsl(0, 64%, 56%)",
    },
  ),

  createTheme(
    "amethyst-shadow",
    "Amethyst Shadow",
    "Balanced violet-gray with a refined coolness",
    "Purple",
    {
      bg: "hsl(268, 22%, 10%)",
      fg: "hsl(268, 22%, 94%)",
      dim: "hsl(268, 12%, 54%)",
      border: "hsl(268, 16%, 21%)",
      surface: "hsl(268, 22%, 13%)",
      accent: "hsl(277, 49%, 67%)",
      hl1: "hsl(277, 60%, 66%)",
      hl2: "hsl(145, 46%, 54%)",
      hl3: "hsl(36, 72%, 58%)",
      err: "hsl(351, 63%, 55%)",
    },
  ),

  createTheme(
    "indigo-night",
    "Indigo Night",
    "Low-noise indigo with a clean electric accent",
    "Purple",
    {
      bg: "hsl(246, 25%, 9%)",
      fg: "hsl(246, 20%, 94%)",
      dim: "hsl(246, 12%, 53%)",
      border: "hsl(246, 18%, 21%)",
      surface: "hsl(246, 25%, 15%)",
      accent: "hsl(256, 72%, 64%)",
      hl1: "hsl(256, 84%, 64%)",
      hl2: "hsl(161, 46%, 52%)",
      hl3: "hsl(45, 74%, 55%)",
      err: "hsl(353, 62%, 56%)",
    },
  ),

  createTheme("mauve-dusk", "Mauve Dusk", "Subtle mauve haze for late-night coding", "Purple", {
    bg: "hsl(284, 20%, 10%)",
    fg: "hsl(284, 20%, 93%)",
    dim: "hsl(284, 14%, 52%)",
    border: "hsl(284, 16%, 22%)",
    surface: "hsl(284, 20%, 14%)",
    accent: "hsl(289, 55%, 66%)",
    hl1: "hsl(289, 68%, 65%)",
    hl2: "hsl(151, 45%, 53%)",
    hl3: "hsl(32, 73%, 58%)",
    err: "hsl(1, 64%, 56%)",
  }),

  createTheme("plum-cinder", "Plum Cinder", "Mature magenta with restrained smoke", "Purple", {
    bg: "hsl(294, 18%, 8%)",
    fg: "hsl(294, 18%, 93%)",
    dim: "hsl(294, 15%, 51%)",
    border: "hsl(294, 14%, 19%)",
    surface: "hsl(294, 18%, 12%)",
    accent: "hsl(315, 43%, 61%)",
    hl1: "hsl(315, 57%, 62%)",
    hl2: "hsl(160, 44%, 50%)",
    hl3: "hsl(31, 70%, 56%)",
    err: "hsl(0, 65%, 55%)",
  }),

  createTheme("royal-ink", "Royal Ink", "Rich ink with violet depth and clear focus", "Purple", {
    bg: "hsl(262, 31%, 9%)",
    fg: "hsl(262, 18%, 93%)",
    dim: "hsl(262, 16%, 56%)",
    border: "hsl(262, 15%, 21%)",
    surface: "hsl(262, 31%, 13%)",
    accent: "hsl(268, 88%, 67%)",
    hl1: "hsl(268, 88%, 63%)",
    hl2: "hsl(136, 42%, 50%)",
    hl3: "hsl(44, 72%, 56%)",
    err: "hsl(354, 63%, 55%)",
  }),

  createTheme(
    "lavender-storm",
    "Lavender Storm",
    "Lavender-rich atmosphere with subtle contrast",
    "Purple",
    {
      bg: "hsl(275, 24%, 10%)",
      fg: "hsl(275, 20%, 93%)",
      dim: "hsl(275, 16%, 55%)",
      border: "hsl(275, 12%, 22%)",
      surface: "hsl(275, 24%, 15%)",
      accent: "hsl(282, 48%, 67%)",
      hl1: "hsl(282, 60%, 67%)",
      hl2: "hsl(166, 43%, 50%)",
      hl3: "hsl(44, 73%, 56%)",
      err: "hsl(352, 64%, 55%)",
    },
  ),

  createTheme("ember-vault", "Ember Vault", "Warm coals with restrained orange signals", "Warm", {
    bg: "hsl(13, 20%, 10%)",
    fg: "hsl(13, 20%, 95%)",
    dim: "hsl(13, 12%, 58%)",
    border: "hsl(13, 14%, 22%)",
    surface: "hsl(13, 20%, 15%)",
    accent: "hsl(22, 82%, 59%)",
    hl1: "hsl(22, 92%, 62%)",
    hl2: "hsl(165, 40%, 52%)",
    hl3: "hsl(44, 70%, 57%)",
    err: "hsl(0, 73%, 58%)",
  }),

  createTheme(
    "rusted-copper",
    "Rusted Copper",
    "Burnished copper accents over dark stone",
    "Warm",
    {
      bg: "hsl(28, 20%, 10%)",
      fg: "hsl(28, 18%, 94%)",
      dim: "hsl(28, 12%, 56%)",
      border: "hsl(28, 13%, 20%)",
      surface: "hsl(28, 20%, 14%)",
      accent: "hsl(32, 74%, 56%)",
      hl1: "hsl(32, 84%, 57%)",
      hl2: "hsl(144, 42%, 50%)",
      hl3: "hsl(45, 72%, 56%)",
      err: "hsl(354, 69%, 57%)",
    },
  ),

  createTheme(
    "crimson-burn",
    "Crimson Burn",
    "Low-key red-black with a muted ember center",
    "Warm",
    {
      bg: "hsl(350, 25%, 9%)",
      fg: "hsl(350, 20%, 95%)",
      dim: "hsl(350, 15%, 55%)",
      border: "hsl(350, 16%, 21%)",
      surface: "hsl(350, 25%, 13%)",
      accent: "hsl(354, 78%, 58%)",
      hl1: "hsl(354, 78%, 60%)",
      hl2: "hsl(166, 44%, 51%)",
      hl3: "hsl(44, 75%, 56%)",
      err: "hsl(0, 75%, 60%)",
    },
  ),

  createTheme(
    "emerald-depth",
    "Emerald Depth",
    "Deep green-black with focused mint highlights",
    "Green",
    {
      bg: "hsl(145, 18%, 9%)",
      fg: "hsl(145, 24%, 93%)",
      dim: "hsl(145, 12%, 54%)",
      border: "hsl(145, 14%, 19%)",
      surface: "hsl(145, 18%, 13%)",
      accent: "hsl(154, 56%, 55%)",
      hl1: "hsl(154, 64%, 58%)",
      hl2: "hsl(31, 45%, 59%)",
      hl3: "hsl(42, 75%, 59%)",
      err: "hsl(356, 64%, 57%)",
    },
  ),

  createTheme(
    "pine-shadow",
    "Pine Shadow",
    "Subtle forest noir with clean, muted greens",
    "Green",
    {
      bg: "hsl(140, 19%, 10%)",
      fg: "hsl(140, 22%, 94%)",
      dim: "hsl(140, 18%, 56%)",
      border: "hsl(140, 16%, 21%)",
      surface: "hsl(140, 19%, 15%)",
      accent: "hsl(144, 45%, 58%)",
      hl1: "hsl(144, 55%, 58%)",
      hl2: "hsl(32, 52%, 53%)",
      hl3: "hsl(45, 72%, 58%)",
      err: "hsl(353, 62%, 56%)",
    },
  ),

  createTheme(
    "abyssal-voyager",
    "Abyssal Voyager",
    "Dark blue deep-sea high contrast theme",
    "Blue",
    {
      bg: "hsl(230, 20%, 4%)",
      fg: "hsl(230, 30%, 96%)",
      dim: "hsl(230, 15%, 60%)",
      border: "hsl(230, 25%, 15%)",
      surface: "hsl(230, 20%, 8%)",
      accent: "hsl(200, 90%, 60%)",
      hl1: "hsl(200, 95%, 65%)",
      hl2: "hsl(150, 70%, 55%)",
      hl3: "hsl(40, 90%, 65%)",
      err: "hsl(0, 85%, 65%)",
    },
  ),

  createTheme("obsidian-sharp", "Obsidian Sharp", "Ultra-high contrast monochrome", "Neutrals", {
    bg: "hsl(0, 0%, 2%)",
    fg: "hsl(0, 0%, 98%)",
    dim: "hsl(0, 0%, 65%)",
    border: "hsl(0, 0%, 20%)",
    surface: "hsl(0, 0%, 6%)",
    accent: "hsl(0, 0%, 100%)",
    hl1: "hsl(210, 80%, 60%)",
    hl2: "hsl(140, 70%, 55%)",
    hl3: "hsl(45, 90%, 60%)",
    err: "hsl(0, 80%, 60%)",
  }),

  createTheme("neon-night", "Neon Night", "Vibrant neon accents on pitch black", "Purple", {
    bg: "hsl(280, 40%, 4%)",
    fg: "hsl(280, 50%, 96%)",
    dim: "hsl(280, 20%, 65%)",
    border: "hsl(280, 35%, 15%)",
    surface: "hsl(280, 30%, 8%)",
    accent: "hsl(300, 100%, 60%)",
    hl1: "hsl(320, 100%, 65%)",
    hl2: "hsl(160, 90%, 55%)",
    hl3: "hsl(50, 100%, 60%)",
    err: "hsl(0, 90%, 65%)",
  }),

  createTheme("deep-space-high", "Deep Space High", "Intense purple space theme", "Purple", {
    bg: "hsl(260, 30%, 3%)",
    fg: "hsl(260, 20%, 98%)",
    dim: "hsl(260, 15%, 65%)",
    border: "hsl(260, 25%, 15%)",
    surface: "hsl(260, 25%, 7%)",
    accent: "hsl(250, 90%, 70%)",
    hl1: "hsl(270, 90%, 75%)",
    hl2: "hsl(140, 80%, 60%)",
    hl3: "hsl(40, 95%, 65%)",
    err: "hsl(0, 85%, 65%)",
  }),

  createTheme("volcanic-ash", "Volcanic Ash", "Dark ash with fiery red accents", "Warm", {
    bg: "hsl(0, 0%, 5%)",
    fg: "hsl(20, 20%, 95%)",
    dim: "hsl(10, 10%, 60%)",
    border: "hsl(0, 0%, 25%)",
    surface: "hsl(0, 0%, 10%)",
    accent: "hsl(15, 90%, 60%)",
    hl1: "hsl(15, 95%, 65%)",
    hl2: "hsl(120, 60%, 50%)",
    hl3: "hsl(45, 90%, 60%)",
    err: "hsl(0, 80%, 60%)",
  }),

  createTheme("arctic-contrast", "Arctic Contrast", "Chillingly high contrast icy blue", "Blue", {
    bg: "hsl(200, 30%, 5%)",
    fg: "hsl(200, 20%, 98%)",
    dim: "hsl(200, 15%, 65%)",
    border: "hsl(200, 25%, 20%)",
    surface: "hsl(200, 25%, 9%)",
    accent: "hsl(190, 90%, 60%)",
    hl1: "hsl(190, 95%, 65%)",
    hl2: "hsl(150, 80%, 55%)",
    hl3: "hsl(40, 90%, 65%)",
    err: "hsl(0, 85%, 65%)",
  }),

  createTheme("jungle-night", "Jungle Night", "Deepest green with vivid plant accents", "Green", {
    bg: "hsl(140, 30%, 4%)",
    fg: "hsl(140, 20%, 96%)",
    dim: "hsl(140, 15%, 60%)",
    border: "hsl(140, 25%, 15%)",
    surface: "hsl(140, 25%, 8%)",
    accent: "hsl(120, 80%, 55%)",
    hl1: "hsl(100, 85%, 60%)",
    hl2: "hsl(180, 70%, 55%)",
    hl3: "hsl(50, 90%, 60%)",
    err: "hsl(0, 80%, 60%)",
  }),

  createTheme("cyber-black", "Cyber Black", "Pure black with terminal green", "Green", {
    bg: "hsl(0, 0%, 0%)",
    fg: "hsl(120, 100%, 50%)",
    dim: "hsl(120, 50%, 40%)",
    border: "hsl(120, 100%, 20%)",
    surface: "hsl(120, 100%, 5%)",
    accent: "hsl(120, 100%, 50%)",
    hl1: "hsl(120, 100%, 60%)",
    hl2: "hsl(180, 90%, 55%)",
    hl3: "hsl(60, 100%, 50%)",
    err: "hsl(0, 100%, 50%)",
  }),

  createTheme("royal-contrast", "Royal Contrast", "Deep purple with high visibility", "Purple", {
    bg: "hsl(270, 40%, 5%)",
    fg: "hsl(270, 20%, 98%)",
    dim: "hsl(270, 15%, 65%)",
    border: "hsl(270, 30%, 20%)",
    surface: "hsl(270, 35%, 10%)",
    accent: "hsl(280, 90%, 65%)",
    hl1: "hsl(290, 90%, 70%)",
    hl2: "hsl(150, 75%, 55%)",
    hl3: "hsl(45, 95%, 65%)",
    err: "hsl(0, 85%, 65%)",
  }),

  createTheme("desert-dark", "Desert Dark", "High contrast warm sand", "Warm", {
    bg: "hsl(30, 20%, 5%)",
    fg: "hsl(35, 30%, 95%)",
    dim: "hsl(35, 15%, 60%)",
    border: "hsl(35, 20%, 20%)",
    surface: "hsl(35, 25%, 10%)",
    accent: "hsl(35, 90%, 55%)",
    hl1: "hsl(45, 95%, 60%)",
    hl2: "hsl(120, 60%, 50%)",
    hl3: "hsl(20, 90%, 60%)",
    err: "hsl(0, 80%, 60%)",
  }),

  createTheme(
    "blackhole-void",
    "Blackhole Void",
    "Near-absolute black with crisp electric blue",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 1%)",
      fg: "hsl(210, 30%, 98%)",
      dim: "hsl(210, 12%, 66%)",
      border: "hsl(210, 28%, 22%)",
      surface: "hsl(0, 0%, 5%)",
      accent: "hsl(212, 100%, 62%)",
      hl1: "hsl(212, 100%, 68%)",
      hl2: "hsl(160, 82%, 56%)",
      hl3: "hsl(46, 96%, 62%)",
      err: "hsl(0, 90%, 64%)",
    },
  ),

  createTheme(
    "pitch-ink",
    "Pitch Ink",
    "Hard black paper look with cold white contrast",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 0%)",
      fg: "hsl(0, 0%, 98%)",
      dim: "hsl(0, 0%, 64%)",
      border: "hsl(0, 0%, 24%)",
      surface: "hsl(0, 0%, 4%)",
      accent: "hsl(199, 100%, 60%)",
      hl1: "hsl(199, 100%, 67%)",
      hl2: "hsl(149, 82%, 54%)",
      hl3: "hsl(48, 96%, 60%)",
      err: "hsl(0, 90%, 62%)",
    },
  ),

  createTheme(
    "noir-terminal",
    "Noir Terminal",
    "Retro terminal black with readable green-on-graphite",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 2%)",
      fg: "hsl(118, 90%, 82%)",
      dim: "hsl(118, 34%, 60%)",
      border: "hsl(118, 62%, 22%)",
      surface: "hsl(0, 0%, 6%)",
      accent: "hsl(118, 92%, 58%)",
      hl1: "hsl(183, 94%, 58%)",
      hl2: "hsl(118, 96%, 62%)",
      hl3: "hsl(57, 97%, 58%)",
      err: "hsl(0, 89%, 62%)",
    },
  ),

  createTheme(
    "eclipse-carbon",
    "Eclipse Carbon",
    "Carbon-black slate with intense cyan guidance",
    "Hardcore Black",
    {
      bg: "hsl(216, 20%, 3%)",
      fg: "hsl(216, 25%, 97%)",
      dim: "hsl(216, 12%, 65%)",
      border: "hsl(216, 30%, 20%)",
      surface: "hsl(216, 22%, 8%)",
      accent: "hsl(188, 94%, 60%)",
      hl1: "hsl(188, 98%, 66%)",
      hl2: "hsl(148, 82%, 56%)",
      hl3: "hsl(42, 96%, 60%)",
      err: "hsl(0, 90%, 63%)",
    },
  ),

  createTheme(
    "ghost-contrast",
    "Ghost Contrast",
    "Monochrome black/white with surgical clarity",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 1%)",
      fg: "hsl(0, 0%, 99%)",
      dim: "hsl(0, 0%, 70%)",
      border: "hsl(0, 0%, 28%)",
      surface: "hsl(0, 0%, 7%)",
      accent: "hsl(0, 0%, 100%)",
      hl1: "hsl(205, 100%, 68%)",
      hl2: "hsl(150, 90%, 58%)",
      hl3: "hsl(50, 98%, 60%)",
      err: "hsl(0, 92%, 64%)",
    },
  ),

  createTheme(
    "razor-midnight",
    "Razor Midnight",
    "Ultra-dark navy-black with high edge definition",
    "Hardcore Black",
    {
      bg: "hsl(230, 32%, 2%)",
      fg: "hsl(230, 22%, 97%)",
      dim: "hsl(230, 14%, 66%)",
      border: "hsl(230, 34%, 22%)",
      surface: "hsl(230, 30%, 7%)",
      accent: "hsl(224, 100%, 66%)",
      hl1: "hsl(265, 100%, 72%)",
      hl2: "hsl(157, 82%, 56%)",
      hl3: "hsl(45, 95%, 62%)",
      err: "hsl(0, 90%, 62%)",
    },
  ),

  createTheme(
    "blackout-pro",
    "Blackout Pro",
    "Professional pure-black high-contrast editor style",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 0%)",
      fg: "hsl(210, 20%, 97%)",
      dim: "hsl(210, 10%, 64%)",
      border: "hsl(210, 18%, 24%)",
      surface: "hsl(210, 18%, 6%)",
      accent: "hsl(213, 92%, 64%)",
      hl1: "hsl(279, 94%, 71%)",
      hl2: "hsl(150, 83%, 55%)",
      hl3: "hsl(42, 96%, 60%)",
      err: "hsl(0, 88%, 62%)",
    },
  ),

  createTheme(
    "obsidian-volt",
    "Obsidian Volt",
    "Obsidian black with vivid electric accents",
    "Hardcore Black",
    {
      bg: "hsl(240, 10%, 2%)",
      fg: "hsl(240, 14%, 97%)",
      dim: "hsl(240, 10%, 66%)",
      border: "hsl(240, 14%, 22%)",
      surface: "hsl(240, 14%, 7%)",
      accent: "hsl(194, 100%, 62%)",
      hl1: "hsl(269, 100%, 73%)",
      hl2: "hsl(154, 84%, 56%)",
      hl3: "hsl(48, 98%, 60%)",
      err: "hsl(0, 89%, 64%)",
    },
  ),

  createTheme(
    "stealth-cobalt",
    "Stealth Cobalt",
    "Black stealth base with cobalt focus rails",
    "Hardcore Black",
    {
      bg: "hsl(221, 28%, 2%)",
      fg: "hsl(221, 25%, 97%)",
      dim: "hsl(221, 13%, 66%)",
      border: "hsl(221, 36%, 22%)",
      surface: "hsl(221, 26%, 7%)",
      accent: "hsl(219, 100%, 66%)",
      hl1: "hsl(195, 100%, 64%)",
      hl2: "hsl(156, 84%, 55%)",
      hl3: "hsl(46, 96%, 60%)",
      err: "hsl(0, 90%, 63%)",
    },
  ),

  createTheme(
    "stealth-crimson",
    "Stealth Crimson",
    "Jet black with crimson command highlights",
    "Hardcore Black",
    {
      bg: "hsl(355, 22%, 2%)",
      fg: "hsl(355, 16%, 97%)",
      dim: "hsl(355, 10%, 66%)",
      border: "hsl(355, 30%, 24%)",
      surface: "hsl(355, 22%, 7%)",
      accent: "hsl(354, 94%, 64%)",
      hl1: "hsl(280, 94%, 70%)",
      hl2: "hsl(155, 84%, 56%)",
      hl3: "hsl(44, 96%, 60%)",
      err: "hsl(0, 94%, 66%)",
    },
  ),

  createTheme(
    "stealth-lime",
    "Stealth Lime",
    "Black tactical UI with lime high-contrast accents",
    "Hardcore Black",
    {
      bg: "hsl(110, 14%, 1%)",
      fg: "hsl(110, 20%, 97%)",
      dim: "hsl(110, 10%, 64%)",
      border: "hsl(110, 35%, 20%)",
      surface: "hsl(110, 14%, 6%)",
      accent: "hsl(102, 96%, 58%)",
      hl1: "hsl(188, 96%, 64%)",
      hl2: "hsl(102, 98%, 60%)",
      hl3: "hsl(52, 96%, 60%)",
      err: "hsl(0, 90%, 62%)",
    },
  ),

  createTheme(
    "stealth-cyan",
    "Stealth Cyan",
    "Near-black with bright cyan instrumentation",
    "Hardcore Black",
    {
      bg: "hsl(194, 24%, 2%)",
      fg: "hsl(194, 22%, 97%)",
      dim: "hsl(194, 12%, 65%)",
      border: "hsl(194, 34%, 21%)",
      surface: "hsl(194, 22%, 7%)",
      accent: "hsl(186, 98%, 60%)",
      hl1: "hsl(216, 98%, 68%)",
      hl2: "hsl(156, 82%, 56%)",
      hl3: "hsl(48, 96%, 60%)",
      err: "hsl(0, 90%, 63%)",
    },
  ),

  createTheme(
    "stealth-violet",
    "Stealth Violet",
    "Hard black with bright violet signal color",
    "Hardcore Black",
    {
      bg: "hsl(268, 22%, 2%)",
      fg: "hsl(268, 18%, 97%)",
      dim: "hsl(268, 12%, 66%)",
      border: "hsl(268, 30%, 22%)",
      surface: "hsl(268, 22%, 7%)",
      accent: "hsl(272, 96%, 70%)",
      hl1: "hsl(198, 98%, 66%)",
      hl2: "hsl(152, 84%, 56%)",
      hl3: "hsl(48, 96%, 60%)",
      err: "hsl(0, 90%, 64%)",
    },
  ),

  createTheme(
    "stealth-amber",
    "Stealth Amber",
    "Midnight black with amber tactical glow",
    "Hardcore Black",
    {
      bg: "hsl(32, 18%, 2%)",
      fg: "hsl(32, 20%, 97%)",
      dim: "hsl(32, 12%, 66%)",
      border: "hsl(32, 30%, 23%)",
      surface: "hsl(32, 18%, 7%)",
      accent: "hsl(38, 100%, 62%)",
      hl1: "hsl(210, 98%, 66%)",
      hl2: "hsl(152, 82%, 55%)",
      hl3: "hsl(38, 100%, 66%)",
      err: "hsl(0, 90%, 62%)",
    },
  ),

  createTheme(
    "stealth-rose",
    "Stealth Rose",
    "Jet black with rose-magenta contrast pops",
    "Hardcore Black",
    {
      bg: "hsl(333, 20%, 2%)",
      fg: "hsl(333, 18%, 97%)",
      dim: "hsl(333, 10%, 66%)",
      border: "hsl(333, 28%, 22%)",
      surface: "hsl(333, 20%, 7%)",
      accent: "hsl(332, 100%, 66%)",
      hl1: "hsl(210, 98%, 66%)",
      hl2: "hsl(152, 82%, 56%)",
      hl3: "hsl(44, 96%, 60%)",
      err: "hsl(0, 90%, 64%)",
    },
  ),

  createTheme(
    "ultra-slate",
    "Ultra Slate",
    "Slate-black high-contrast with cool neutral readability",
    "Hardcore Black",
    {
      bg: "hsl(220, 12%, 2%)",
      fg: "hsl(220, 18%, 97%)",
      dim: "hsl(220, 10%, 65%)",
      border: "hsl(220, 20%, 21%)",
      surface: "hsl(220, 14%, 8%)",
      accent: "hsl(209, 98%, 66%)",
      hl1: "hsl(272, 96%, 72%)",
      hl2: "hsl(154, 83%, 56%)",
      hl3: "hsl(46, 96%, 60%)",
      err: "hsl(0, 90%, 63%)",
    },
  ),

  createTheme(
    "void-neon",
    "Void Neon",
    "Absolute dark base with neon triad highlights",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 0%)",
      fg: "hsl(0, 0%, 98%)",
      dim: "hsl(0, 0%, 66%)",
      border: "hsl(0, 0%, 24%)",
      surface: "hsl(0, 0%, 5%)",
      accent: "hsl(188, 100%, 60%)",
      hl1: "hsl(290, 100%, 72%)",
      hl2: "hsl(146, 98%, 58%)",
      hl3: "hsl(54, 100%, 60%)",
      err: "hsl(0, 92%, 64%)",
    },
  ),

  createTheme(
    "mono-killer",
    "Mono Killer",
    "Aggressive black/white contrast for maximum legibility",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 0%)",
      fg: "hsl(0, 0%, 100%)",
      dim: "hsl(0, 0%, 72%)",
      border: "hsl(0, 0%, 28%)",
      surface: "hsl(0, 0%, 8%)",
      accent: "hsl(0, 0%, 100%)",
      hl1: "hsl(210, 100%, 68%)",
      hl2: "hsl(150, 90%, 58%)",
      hl3: "hsl(52, 100%, 60%)",
      err: "hsl(0, 95%, 66%)",
    },
  ),

  createTheme(
    "deep-graphite-hc",
    "Deep Graphite HC",
    "Graphite-black with boosted UI separation",
    "Hardcore Black",
    {
      bg: "hsl(210, 10%, 2%)",
      fg: "hsl(210, 16%, 97%)",
      dim: "hsl(210, 8%, 66%)",
      border: "hsl(210, 18%, 22%)",
      surface: "hsl(210, 12%, 8%)",
      accent: "hsl(205, 98%, 64%)",
      hl1: "hsl(265, 96%, 70%)",
      hl2: "hsl(153, 82%, 56%)",
      hl3: "hsl(46, 96%, 60%)",
      err: "hsl(0, 90%, 63%)",
    },
  ),

  createTheme(
    "tungsten-night",
    "Tungsten Night",
    "Industrial black metal with high visual punch",
    "Hardcore Black",
    {
      bg: "hsl(30, 8%, 2%)",
      fg: "hsl(30, 16%, 97%)",
      dim: "hsl(30, 8%, 65%)",
      border: "hsl(30, 16%, 22%)",
      surface: "hsl(30, 10%, 8%)",
      accent: "hsl(32, 100%, 62%)",
      hl1: "hsl(210, 98%, 66%)",
      hl2: "hsl(153, 82%, 56%)",
      hl3: "hsl(45, 98%, 62%)",
      err: "hsl(0, 90%, 63%)",
    },
  ),

  createTheme(
    "mono-etch",
    "Mono Etch",
    "Black and graphite with razor-thin blue-gray accents",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 3%)",
      fg: "hsl(0, 0%, 95%)",
      dim: "hsl(0, 0%, 61%)",
      border: "hsl(0, 0%, 18%)",
      surface: "hsl(0, 0%, 7%)",
      accent: "hsl(210, 10%, 66%)",
      hl1: "hsl(210, 14%, 62%)",
      hl2: "hsl(195, 10%, 56%)",
      hl3: "hsl(35, 8%, 58%)",
      err: "hsl(0, 52%, 60%)",
    },
  ),

  createTheme(
    "ash-paper",
    "Ash Paper",
    "Soft charcoal paper feel with subtle cool highlights",
    "Neutrals",
    {
      bg: "hsl(210, 6%, 9%)",
      fg: "hsl(210, 10%, 93%)",
      dim: "hsl(210, 6%, 60%)",
      border: "hsl(210, 6%, 21%)",
      surface: "hsl(210, 6%, 13%)",
      accent: "hsl(205, 10%, 62%)",
      hl1: "hsl(205, 12%, 61%)",
      hl2: "hsl(175, 9%, 56%)",
      hl3: "hsl(32, 8%, 60%)",
      err: "hsl(0, 48%, 59%)",
    },
  ),

  createTheme(
    "graphite-fog",
    "Graphite Fog",
    "Deep graphite layers with faint steel-blue cues",
    "Neutrals",
    {
      bg: "hsl(215, 8%, 7%)",
      fg: "hsl(215, 12%, 94%)",
      dim: "hsl(215, 6%, 59%)",
      border: "hsl(215, 7%, 20%)",
      surface: "hsl(215, 8%, 11%)",
      accent: "hsl(215, 11%, 63%)",
      hl1: "hsl(210, 13%, 62%)",
      hl2: "hsl(190, 10%, 55%)",
      hl3: "hsl(36, 8%, 58%)",
      err: "hsl(0, 50%, 58%)",
    },
  ),

  createTheme(
    "noir-dim",
    "Noir Dim",
    "Near-black monochrome with restrained neutral highlights",
    "Hardcore Black",
    {
      bg: "hsl(0, 0%, 2%)",
      fg: "hsl(0, 0%, 94%)",
      dim: "hsl(0, 0%, 58%)",
      border: "hsl(0, 0%, 16%)",
      surface: "hsl(0, 0%, 6%)",
      accent: "hsl(210, 8%, 60%)",
      hl1: "hsl(210, 10%, 59%)",
      hl2: "hsl(180, 8%, 53%)",
      hl3: "hsl(30, 8%, 56%)",
      err: "hsl(0, 48%, 58%)",
    },
  ),
];

export const THEME_BY_ID = new Map<ThemeId, ThemeMeta>(THEMES.map((theme) => [theme.id, theme]));
