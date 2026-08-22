"use client";

import { useMemo, useState, useCallback } from "react";
import { Check, ChevronDown, Laptop, Moon, RotateCcw, Search, Sun, X } from "@/ui/icon-registry";
import { useAppStore } from "@/store";
import {
  FONT_FAMILY_BY_ID,
  FONT_FAMILY_OPTIONS,
  type FontFamilyId,
  THEMES,
  THEME_BY_ID,
  type ThemeMeta,
  type ThemeTokens,
} from "@/lib/themes";
import { applyTokensToDocument, applyUiControl } from "@/lib/theme-runtime";
import { ColorField, SegmentedControl, type SegmentedItem, Slider } from "@/ui";
import type { PreviewHeight } from "@/ui/preview-scroll";
import {
  TOOL_PREVIEW_HEIGHT_OPTIONS,
  TOOL_PREVIEW_KIND_LABELS,
  type ToolKind,
  type ToolPreviewHeightOverrides,
} from "@/features/agent/ui/timeline/tool-metadata";
import { SettingsButton, SettingsGroup, SettingsRow } from "./settings-ui";

const CUSTOM_THEME_TOKEN_KEY = "local-studio.customThemeTokens";
const LIGHT_THEME_ID = "zai-light";
const DARK_THEME_ID = "zai-dark";

type ThemeMode = "light" | "dark" | "system";

const MODE_ITEMS: SegmentedItem<ThemeMode>[] = [
  { id: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
  { id: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
  { id: "system", label: "System", icon: <Laptop className="h-3.5 w-3.5" /> },
];

const TOOL_PREVIEW_KINDS: ToolKind[] = ["edit", "read", "search", "exec", "browser", "generic"];
const TOOL_PREVIEW_OVERRIDE_OPTIONS: Array<{ id: PreviewHeight | "default"; label: string }> = [
  { id: "default", label: "Default" },
  ...TOOL_PREVIEW_HEIGHT_OPTIONS,
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
    (FONT_FAMILY_BY_ID.get(theme.fontFamilyId)?.label.toLowerCase().includes(q) ?? false) ||
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

function readVarString(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.startsWith("#") ? value : fallback;
}

function readVar(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type SliderRowProps = {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  width: string;
  onChange: (value: number) => void;
};

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  width,
  onChange,
}: SliderRowProps) {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <div className="flex w-full items-center gap-3">
          <Slider value={value} min={min} max={max} step={step} onChange={onChange} aria-label={label} />
          <span
            className={`${width} shrink-0 text-right font-mono text-[length:var(--fs-md)] tabular-nums text-(--ui-muted)`}
          >
            {format(value)}
          </span>
        </div>
      }
    />
  );
}

function ThemeSwatches({ theme }: { theme: ThemeMeta }) {
  return (
    <div className="flex items-center gap-0.5">
      {theme.swatches.map((color, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-[var(--rad-2xs)] border border-(--ui-border)"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export function AppearanceSettings() {
  const themeId = useAppStore((s) => s.themeId);
  const setThemeId = useAppStore((s) => s.setThemeId);
  const fontFamilyId = useAppStore((s) => s.fontFamilyId);
  const setFontFamilyId = useAppStore((s) => s.setFontFamilyId);
  const fontSizeId = useAppStore((s) => s.fontSizeId);
  const setFontSizeId = useAppStore((s) => s.setFontSizeId);
  const toolPreviewHeight = useAppStore((s) => s.toolPreviewHeight);
  const setToolPreviewHeight = useAppStore((s) => s.setToolPreviewHeight);
  const toolPreviewHeightOverrides = useAppStore((s) => s.toolPreviewHeightOverrides);
  const setToolPreviewHeightOverride = useAppStore((s) => s.setToolPreviewHeightOverride);

  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(["Reference", "Studio"]),
  );

  const sizeMap: Record<string, number> = { sm: 14, md: 16, lg: 17, xl: 18, "2xl": 20 };
  const [uiFontSize, setUiFontSize] = useState(sizeMap[fontSizeId] ?? 16);

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

  const [chatFontSize, setChatFontSize] = useState(() => readVar("--codex-chat-font-size", 16));
  const [chatLineHeight, setChatLineHeight] = useState(() =>
    readVar("--codex-chat-line-height", 1.5),
  );
  const [chatWidth, setChatWidth] = useState(() => readVar("--composer-w", 48));
  const [bubbleTone, setBubbleTone] = useState(() => readVarString("--bubble", "#282828"));
  const setChatFont = (value: number) => {
    setChatFontSize(value);
    applyUiControl("--codex-chat-font-size", `${value}px`);
  };
  const setChatLeading = (value: number) => {
    setChatLineHeight(value);
    applyUiControl("--codex-chat-line-height", String(value));
  };
  const setChatColumn = (value: number) => {
    setChatWidth(value);
    applyUiControl("--composer-w", `${value}rem`);
  };
  const setBubble = (value: string) => {
    setBubbleTone(value);
    applyUiControl("--bubble", value);
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

  const baseTokens = currentTheme.tokens;
  const [customTokens, setCustomTokens] = useState<ThemeTokens>(
    () => readCustomTokens() ?? baseTokens,
  );
  const [isCustomActive, setIsCustomActive] = useState(false);

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

  const sliderRows: Record<"typography" | "sizing" | "chat", SliderRowProps[]> = {
    typography: [
      // prettier-ignore
      { label: "UI font size", description: "Base size for the Local Studio UI", value: uiFontSize, min: 12, max: 20, format: (v) => `${v}px`, width: "w-9", onChange: handleFontSizeChange },
    ],
    sizing: [
      // prettier-ignore
      { label: "UI scale", description: "Scales every text size at once", value: uiScale, min: 0.8, max: 1.3, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, width: "w-10", onChange: setScale },
      // prettier-ignore
      { label: "Corner radius", description: "Roundness of cards, buttons, inputs", value: radiusBase, min: 0, max: 16, step: 1, format: (v) => `${v}px`, width: "w-10", onChange: setRadius },
    ],
    chat: [
      // prettier-ignore
      { label: "Chat text size", description: "Message and composer text", value: chatFontSize, min: 13, max: 18, step: 1, format: (v) => `${v}px`, width: "w-9", onChange: setChatFont },
      // prettier-ignore
      { label: "Chat line height", value: chatLineHeight, min: 1.3, max: 1.8, step: 0.05, format: (v) => v.toFixed(2), width: "w-10", onChange: setChatLeading },
      // prettier-ignore
      { label: "Chat column width", description: "Maximum width of the thread and composer", value: chatWidth, min: 40, max: 64, step: 1, format: (v) => `${v}rem`, width: "w-12", onChange: setChatColumn },
    ],
  };

  const themeLibrary = (
    <SettingsGroup
      title="Theme library"
      description="Presets pair a complete surface palette with a typeface."
    >
      <div>
        <div className="flex h-9 items-center gap-2 px-3">
          <Search className="h-3 w-3 shrink-0 text-(--ui-muted)" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search colors or fonts"
            className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-md)] text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/60"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 text-(--ui-muted) hover:text-(--ui-fg)"
              aria-label="Clear theme search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        {groups.length === 0 ? (
          <div className="border-t border-(--ui-separator) px-3 py-3 text-[length:var(--fs-md)] text-(--ui-muted)">
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
                  className="flex h-8 w-full items-center justify-between px-3 text-left hover:bg-(--ui-hover)"
                >
                  <span className="text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
                    {group}
                  </span>
                  <span className="flex items-center gap-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                    {themes.length}
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${expanded ? "" : "-rotate-90"}`}
                    />
                  </span>
                </button>
                {expanded ? (
                  <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
                    {themes.map((theme) => {
                      const active = theme.id === themeId && !isCustomActive;
                      const font = FONT_FAMILY_BY_ID.get(theme.fontFamilyId);
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => setThemeId(theme.id)}
                          className={`min-w-0 rounded-[var(--rad-md)] border px-2.5 py-2 text-left transition-colors ${
                            active
                              ? "border-(--ui-accent)/35 bg-(--ui-active)"
                              : "border-transparent hover:border-(--ui-border) hover:bg-(--ui-hover)"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)"
                              style={{ fontFamily: font?.cssValue }}
                            >
                              {theme.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <ThemeSwatches theme={theme} />
                              {active ? <Check className="h-3 w-3 text-(--ui-success)" /> : null}
                            </div>
                          </div>
                          <div className="mt-0.5 truncate text-[length:var(--fs-xs)] text-(--ui-muted)">
                            {font?.label} · {theme.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </SettingsGroup>
  );

  return (
    <div>
      <SettingsGroup
        title="Theme"
        description="Use light, dark, or match your system."
        actions={
          <SegmentedControl items={MODE_ITEMS} value={mode} onChange={applyMode} size="sm" />
        }
      >
        <SettingsRow
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
      </SettingsGroup>

      {themeLibrary}

      <SettingsGroup
        title="Theme editor"
        actions={
          isCustomActive ? (
            <SettingsButton onClick={resetTokens}>
              <RotateCcw className="h-3 w-3" />
              Reset
            </SettingsButton>
          ) : undefined
        }
      >
        {editorTokens.map((row) => (
          <SettingsRow
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
      </SettingsGroup>

      <SettingsGroup title="Advanced tokens" collapsible defaultOpen={false}>
        {advancedTokens.map((key) => (
          <SettingsRow
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
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsRow
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
        {sliderRows.typography.map((row) => (
          <SliderRow key={row.label} {...row} />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Sizing & shape"
        description="Scale the interface and adjust its corner treatment."
      >
        {sliderRows.sizing.map((row) => (
          <SliderRow key={row.label} {...row} />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Chat & composer"
        description="Tune the conversation surface independently of the UI chrome."
      >
        {sliderRows.chat.map((row) => (
          <SliderRow key={row.label} {...row} />
        ))}
        <SettingsRow
          label="Bubble tone"
          description="Surface color of your messages"
          control={<ColorField value={bubbleTone} label="Bubble tone" onChange={setBubble} />}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Tool previews"
        description="Set one preview height for all tools, then override individual tool types."
      >
        <SettingsRow
          label="All tools"
          description="Default maximum preview height"
          control={
            <SegmentedControl
              items={TOOL_PREVIEW_HEIGHT_OPTIONS}
              value={toolPreviewHeight}
              onChange={setToolPreviewHeight}
              size="sm"
            />
          }
        />
        {TOOL_PREVIEW_KINDS.map((kind) => (
          <ToolPreviewHeightRow
            key={kind}
            kind={kind}
            overrides={toolPreviewHeightOverrides}
            onChange={setToolPreviewHeightOverride}
          />
        ))}
      </SettingsGroup>
    </div>
  );
}

function ToolPreviewHeightRow({
  kind,
  overrides,
  onChange,
}: {
  kind: ToolKind;
  overrides: ToolPreviewHeightOverrides;
  onChange: (kind: ToolKind, height: PreviewHeight | undefined) => void;
}) {
  const value = overrides[kind] ?? "default";
  return (
    <SettingsRow
      label={TOOL_PREVIEW_KIND_LABELS[kind]}
      description={value === "default" ? "Uses the all-tools setting" : "Custom preview height"}
      control={
        <SegmentedControl
          items={TOOL_PREVIEW_OVERRIDE_OPTIONS}
          value={value}
          onChange={(height) => onChange(kind, height === "default" ? undefined : height)}
          size="sm"
        />
      }
    />
  );
}
