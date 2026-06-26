"use client";

import { useMemo, useState, useCallback } from "react";
import { Check, ChevronDown, Laptop, Moon, RotateCcw, Search, Sun, X } from "@/ui/icon-registry";
import { useAppStore } from "@/store";
import {
  FONT_FAMILY_OPTIONS,
  type FontFamilyId,
  THEMES,
  THEME_BY_ID,
  type ThemeMeta,
  type ThemeTokens,
} from "@/lib/themes";
import { applyTokensToDocument, applyUiControl } from "@/lib/theme-runtime";
import { ColorField, ListGroup, ListRow, SegmentedControl, type SegmentedItem, Slider } from "@/ui";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const CUSTOM_THEME_TOKEN_KEY = "local-studio.customThemeTokens";
const LIGHT_THEME_ID = "zai-light";
const DARK_THEME_ID = "zai-dark";

type ThemeMode = "light" | "dark" | "system";

const MODE_ITEMS: SegmentedItem<ThemeMode>[] = [
  { id: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
  { id: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
  { id: "system", label: "System", icon: <Laptop className="h-3.5 w-3.5" /> },
];

function readCustomTokens(): ThemeTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEME_TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ThemeTokens;
  } catch {
    return null;
  }
}

function writeCustomTokens(tokens: ThemeTokens) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_THEME_TOKEN_KEY, JSON.stringify(tokens));
}

function matchesQuery(theme: ThemeMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    theme.name.toLowerCase().includes(q) ||
    theme.group.toLowerCase().includes(q) ||
    theme.description.toLowerCase().includes(q)
  );
}

function isLightTheme(theme: ThemeMeta): boolean {
  const bg = theme.tokens.bg;
  const hslLightness = /hsl\([^,]+,[^,]+,\s*([\d.]+)%/i.exec(bg);
  if (hslLightness) return Number(hslLightness[1]) > 50;
  if (typeof document !== "undefined") {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = bg;
      const hex = ctx.fillStyle as string;
      const n = Number.parseInt(hex.slice(1), 16);
      if (Number.isFinite(n)) {
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
      }
    }
  }
  return false;
}

function readVar(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ThemeSwatches({ theme }: { theme: ThemeMeta }) {
  return (
    <div className="flex items-center gap-1">
      {theme.swatches.map((color, i) => (
        <span
          key={i}
          className="h-3.5 w-3.5 rounded-[var(--rad-2xs)] border border-(--ui-border)"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function AppearanceSettings() {
  const themeId = useAppStore((s) => s.themeId);
  const setThemeId = useAppStore((s) => s.setThemeId);
  const fontFamilyId = useAppStore((s) => s.fontFamilyId);
  const setFontFamilyId = useAppStore((s) => s.setFontFamilyId);
  const fontSizeId = useAppStore((s) => s.fontSizeId);
  const setFontSizeId = useAppStore((s) => s.setFontSizeId);

  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(["Classic"]));

  const sizeMap: Record<string, number> = { sm: 14, md: 16, lg: 17, xl: 18, "2xl": 20 };
  const [uiFontSize, setUiFontSize] = useState(sizeMap[fontSizeId] ?? 16);

  // Master scale knobs — drive the canonical CSS vars the whole UI derives from.
  const [uiScale, setUiScale] = useState(() => readVar("--ui-scale", 1));
  const [radiusBase, setRadiusBase] = useState(() => readVar("--radius-base", 8));
  const setScale = (value: number) => {
    setUiScale(value);
    applyUiControl("--ui-scale", String(value));
  };
  const setRadius = (value: number) => {
    setRadiusBase(value);
    applyUiControl("--radius-base", `${value}px`);
  };

  const currentTheme = THEME_BY_ID.get(themeId) ?? THEMES[0];

  const [mode, setMode] = useState<ThemeMode>(() =>
    isLightTheme(currentTheme) ? "light" : "dark",
  );

  const groups = useMemo(() => {
    const map = new Map<string, ThemeMeta[]>();
    for (const theme of THEMES) {
      if (!matchesQuery(theme, query)) continue;
      const list = map.get(theme.group) ?? [];
      list.push(theme);
      map.set(theme.group, list);
    }
    return Array.from(map.entries());
  }, [query]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleFontSizeChange = (value: number) => {
    setUiFontSize(value);
    const closest = Object.entries(sizeMap).reduce(
      (best, [id, size]) => (Math.abs(size - value) < Math.abs(sizeMap[best] - value) ? id : best),
      "md" as string,
    );
    setFontSizeId(closest as typeof fontSizeId);
  };

  /* ---- live custom token editor (reuses the existing apply pipeline) ---- */

  const baseTokens = currentTheme.tokens;
  const [customTokens, setCustomTokens] = useState<ThemeTokens>(
    () => readCustomTokens() ?? baseTokens,
  );
  const [isCustomActive, setIsCustomActive] = useState(false);

  // Reset edits when the active theme changes (render-phase sync — the
  // React-sanctioned alternative to a syncing effect).
  const [prevThemeId, setPrevThemeId] = useState(themeId);
  if (themeId !== prevThemeId) {
    setPrevThemeId(themeId);
    setCustomTokens(baseTokens);
    setIsCustomActive(false);
  }

  const patchToken = useCallback((key: keyof ThemeTokens, value: string) => {
    setCustomTokens((prev) => {
      const next = { ...prev, [key]: value };
      writeCustomTokens(next);
      applyTokensToDocument(next);
      setIsCustomActive(true);
      return next;
    });
  }, []);

  const resetTokens = () => {
    setCustomTokens(baseTokens);
    writeCustomTokens(baseTokens);
    applyTokensToDocument(baseTokens);
    setIsCustomActive(false);
  };

  const applyMode = (next: ThemeMode) => {
    setMode(next);
    if (next === "light") setThemeId(LIGHT_THEME_ID);
    else if (next === "dark") setThemeId(DARK_THEME_ID);
    else {
      const prefersDark =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      setThemeId(prefersDark ? DARK_THEME_ID : LIGHT_THEME_ID);
    }
    setIsCustomActive(false);
  };

  const editorTokens: Array<{ key: keyof ThemeTokens; label: string; description?: string }> = [
    { key: "accent", label: "Accent", description: "Buttons, links, highlights" },
    { key: "bg", label: "Background" },
    { key: "fg", label: "Foreground", description: "Primary text" },
    { key: "surface", label: "Surface", description: "Cards & panels" },
  ];

  const advancedTokens: Array<keyof ThemeTokens> = ["dim", "border", "hl1", "hl2", "hl3", "err"];

  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-1">
      {/* Theme + mode */}
      <ListGroup
        title="Theme"
        description="Use light, dark, or match your system."
        actions={
          <SegmentedControl items={MODE_ITEMS} value={mode} onChange={applyMode} size="sm" />
        }
      >
        <ListRow
          label="Active theme"
          description={isCustomActive ? "Live custom tokens active" : currentTheme.description}
          control={
            <div className="flex items-center gap-2.5">
              <span className="text-[length:var(--fs-md)] text-(--ui-fg)">
                {currentTheme.name}
                {isCustomActive ? " · edited" : ""}
              </span>
              <ThemeSwatches theme={currentTheme} />
              <span className="inline-flex items-center gap-1 text-[length:var(--fs-sm)] text-(--ui-success)">
                <Check className="h-3 w-3" />
                active
              </span>
            </div>
          }
        />
      </ListGroup>

      {/* Theme editor — color fields */}
      <ListGroup
        title="Theme editor"
        actions={
          isCustomActive ? (
            <button
              type="button"
              onClick={resetTokens}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[length:var(--fs-sm)] text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          ) : undefined
        }
      >
        {editorTokens.map((row) => (
          <ListRow
            key={row.key}
            label={row.label}
            description={row.description}
            control={
              <ColorField
                value={customTokens[row.key]}
                label={`${row.label} color`}
                onChange={(v) => patchToken(row.key, v)}
              />
            }
          />
        ))}
      </ListGroup>

      {/* Advanced tokens */}
      <ListGroup title="Advanced tokens" collapsible defaultOpen={false}>
        {advancedTokens.map((key) => (
          <ListRow
            key={key}
            label={`--${key}`}
            control={
              <ColorField
                value={customTokens[key]}
                label={`--${key} color`}
                onChange={(v) => patchToken(key, v)}
              />
            }
          />
        ))}
      </ListGroup>

      {/* Typography */}
      <ListGroup title="Typography">
        <ListRow
          label="Font family"
          control={
            <div className="relative w-full max-w-[184px]">
              <select
                value={fontFamilyId}
                onChange={(e) => setFontFamilyId(e.target.value as FontFamilyId)}
                className="h-7 w-full appearance-none rounded-md border border-(--ui-border) bg-(--ui-bg) pl-7 pr-7 text-[length:var(--fs-md)] text-(--ui-fg) outline-none focus:border-(--ui-accent)/40"
              >
                {FONT_FAMILY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[length:var(--fs-sm)] text-(--ui-muted)">
                Aa
              </span>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--ui-muted)" />
            </div>
          }
        />
        <ListRow
          label="UI font size"
          description="Base size for the Local Studio UI"
          control={
            <div className="flex w-full items-center gap-3">
              <Slider
                value={uiFontSize}
                min={12}
                max={20}
                onChange={handleFontSizeChange}
                aria-label="UI font size"
              />
              <span className="w-9 shrink-0 text-right font-mono text-[length:var(--fs-md)] tabular-nums text-(--ui-muted)">
                {uiFontSize}px
              </span>
            </div>
          }
        />
      </ListGroup>

      {/* Sizing & shape — master scales that resize the whole UI uniformly */}
      <ListGroup
        title="Sizing & shape"
        description="Master scales — each resizes the entire UI uniformly."
      >
        <ListRow
          label="UI scale"
          description="Scales every text size at once"
          control={
            <div className="flex w-full items-center gap-3">
              <Slider
                value={uiScale}
                min={0.8}
                max={1.3}
                step={0.05}
                onChange={setScale}
                aria-label="UI scale"
              />
              <span className="w-10 shrink-0 text-right font-mono text-[length:var(--fs-md)] tabular-nums text-(--ui-muted)">
                {Math.round(uiScale * 100)}%
              </span>
            </div>
          }
        />
        <ListRow
          label="Corner radius"
          description="Roundness of cards, buttons, inputs"
          control={
            <div className="flex w-full items-center gap-3">
              <Slider
                value={radiusBase}
                min={0}
                max={16}
                step={1}
                onChange={setRadius}
                aria-label="Corner radius"
              />
              <span className="w-10 shrink-0 text-right font-mono text-[length:var(--fs-md)] tabular-nums text-(--ui-muted)">
                {radiusBase}px
              </span>
            </div>
          }
        />
      </ListGroup>

      {/* Theme library */}
      <ListGroup title="Theme library" collapsible defaultOpen={false}>
        <div>
          <div className="flex items-center gap-2 px-3.5 py-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-(--ui-muted)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search themes"
              className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-base)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/60"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="shrink-0 text-(--ui-muted) hover:text-(--ui-fg)"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
          {groups.length === 0 ? (
            <div className="px-3.5 py-2.5 text-[length:var(--fs-base)] text-(--ui-muted)">
              No themes match your search.
            </div>
          ) : (
            groups.map(([group, themes]) => {
              const expanded = expandedGroups.has(group);
              return (
                <div key={group} className="border-t border-(--ui-separator)">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="flex w-full items-center justify-between px-3.5 py-2 text-left hover:bg-(--ui-hover)"
                  >
                    <span className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
                      {group}
                    </span>
                    <span className="flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
                      {themes.length}
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${expanded ? "" : "-rotate-90"}`}
                      />
                    </span>
                  </button>
                  {expanded
                    ? themes.map((theme) => {
                        const active = theme.id === themeId;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() => setThemeId(theme.id)}
                            className={`flex w-full items-center justify-between gap-4 px-3.5 py-2 text-left transition-colors ${
                              active ? "bg-(--ui-hover)" : "hover:bg-(--ui-hover)"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-[length:var(--fs-base)] text-(--ui-fg)">
                                {theme.name}
                              </div>
                              <div className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
                                {theme.description}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <ThemeSwatches theme={theme} />
                              {active && !isCustomActive ? (
                                <Check className="h-3.5 w-3.5 text-(--ui-success)" />
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    : null}
                </div>
              );
            })
          )}
        </div>
      </ListGroup>
    </div>
  );
}
