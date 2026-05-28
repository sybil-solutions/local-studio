"use client";

import { useMemo, useState, useCallback } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useAppStore } from "@/store";
import {
  FONT_FAMILY_OPTIONS,
  type FontFamilyId,
  THEMES,
  THEME_BY_ID,
  type ThemeMeta,
  type ThemeTokens,
} from "@/lib/themes";
import { applyTokensToDocument } from "@/lib/theme/runtime";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const CUSTOM_THEME_TOKEN_KEY = "vllm-studio.customThemeTokens";

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

/* Convert any CSS color to 6-digit hex for the native color input */
function toHex6(value: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = value;
  const computed = ctx.fillStyle;
  return computed.startsWith("#") && computed.length === 7 ? computed : computed;
}

/* ------------------------------------------------------------------ */
/*  Swatches                                                          */
/* ------------------------------------------------------------------ */

function ThemeSwatches({ theme }: { theme: ThemeMeta }) {
  return (
    <div className="flex items-center gap-1">
      {theme.swatches.map((color, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-sm border border-(--border)"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live color picker row                                             */
/* ------------------------------------------------------------------ */

function TokenColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const [hex, setHex] = useState(() => toHex6(value));

  // Sync local edit state when the incoming value changes (render-phase
  // adjustment — the React-sanctioned alternative to a syncing effect).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
    setHex(toHex6(value));
  }

  const handleText = (v: string) => {
    setText(v);
    onChange(v);
    try {
      setHex(toHex6(v));
    } catch {
      /* ignore invalid */
    }
  };

  const handleHex = (v: string) => {
    setHex(v);
    setText(v);
    onChange(v);
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5">
      <span className="font-mono text-[11px] text-(--dim)">--{label}</span>
      <div className="flex items-center gap-2">
        <div className="relative h-6 w-16 overflow-hidden rounded border border-(--border)">
          <input
            type="color"
            value={hex}
            onChange={(e) => handleHex(e.target.value)}
            className="absolute -top-2 -left-2 h-12 w-20 cursor-pointer border-0 p-0"
          />
        </div>
        <input
          value={text}
          onChange={(e) => handleText(e.target.value)}
          className="h-6 w-36 rounded border border-(--border) bg-transparent px-2 text-right text-[11px] font-mono text-(--fg) outline-none focus:border-(--accent)/30"
        />
      </div>
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

  const sizeMap: Record<string, number> = {
    sm: 14,
    md: 16,
    lg: 17,
    xl: 18,
    "2xl": 20,
  };
  const [uiFontSize, setUiFontSize] = useState(sizeMap[fontSizeId] ?? 16);

  const currentTheme = THEME_BY_ID.get(themeId) ?? THEMES[0];

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

  const fontFamily =
    FONT_FAMILY_OPTIONS.find((f) => f.id === fontFamilyId) ?? FONT_FAMILY_OPTIONS[0];

  /* ---------------------------------------------------------------- */
  /*  Live custom token editor                                         */
  /* ---------------------------------------------------------------- */

  const baseTokens = currentTheme.tokens;
  const [customTokens, setCustomTokens] = useState<ThemeTokens>(
    () => readCustomTokens() ?? baseTokens,
  );
  const [showCustom, setShowCustom] = useState(false);
  const [isCustomActive, setIsCustomActive] = useState(false);

  // Reset custom token edits when the active theme changes (render-phase
  // adjustment — the React-sanctioned alternative to a syncing effect).
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

  const tokenKeys: Array<keyof ThemeTokens> = [
    "bg",
    "fg",
    "dim",
    "border",
    "surface",
    "accent",
    "hl1",
    "hl2",
    "hl3",
    "err",
  ];

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-[640px] space-y-0">
      {/* Search */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search themes"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-(--fg) placeholder:text-(--dim)/50 outline-none"
        />
        {query ? (
          <button onClick={() => setQuery("")} className="shrink-0 text-(--dim) hover:text-(--fg)">
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="h-px bg-(--border)" />

      {/* Active theme */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] text-(--fg)">
            {isCustomActive ? `${currentTheme.name} (edited)` : currentTheme.name}
          </div>
          <div className="text-[11px] text-(--dim)">
            {isCustomActive ? "Live custom tokens active" : currentTheme.description}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeSwatches theme={currentTheme} />
          <span className="inline-flex items-center gap-1 text-[11px] text-(--hl2)">
            <Check className="h-3 w-3" />
            active
          </span>
        </div>
      </div>

      <div className="h-px bg-(--border)" />

      {/* Theme groups */}
      {groups.length === 0 ? (
        <div className="px-4 py-3 text-[13px] text-(--dim)">No themes match your search.</div>
      ) : (
        groups.map(([group, themes]) => {
          const expanded = expandedGroups.has(group);
          return (
            <div key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-(--hover)"
              >
                <span className="text-[12px] font-medium text-(--fg)">{group}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-(--dim)">
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
                        onClick={() => {
                          setThemeId(theme.id);
                          setIsCustomActive(false);
                        }}
                        className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left transition-colors ${active ? "bg-(--hover)" : "hover:bg-(--hover)"}`}
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] text-(--fg)">{theme.name}</div>
                          <div className="truncate text-[11px] text-(--dim)">
                            {theme.description}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <ThemeSwatches theme={theme} />
                          {active && !isCustomActive ? (
                            <Check className="h-3.5 w-3.5 text-(--hl2)" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                : null}
              <div className="h-px bg-(--border)" />
            </div>
          );
        })
      )}

      <div className="h-px bg-(--border)" />

      {/* Font family */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <span className="text-[13px] text-(--fg)">Font family</span>
        <div className="relative">
          <select
            value={fontFamilyId}
            onChange={(e) => setFontFamilyId(e.target.value as FontFamilyId)}
            className="h-7 appearance-none rounded-md border border-(--border) bg-(--surface) pl-7 pr-6 text-[12px] text-(--fg) outline-none focus:border-(--accent)/30"
          >
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-(--dim)">
            Aa
          </span>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--dim)" />
        </div>
      </div>

      <div className="h-px bg-(--border)" />

      {/* Font size */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <div>
          <div className="text-[13px] text-(--fg)">UI font size</div>
          <div className="text-[11px] text-(--dim)">Base size for the vLLM Studio UI</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={24}
            value={uiFontSize}
            onChange={(e) => handleFontSizeChange(Number(e.target.value))}
            className="h-7 w-16 rounded-md border border-(--border) bg-transparent px-2 text-right text-[12px] text-(--fg) outline-none focus:border-(--accent)/30"
          />
          <span className="text-[11px] text-(--dim)">px</span>
        </div>
      </div>

      <div className="h-px bg-(--border)" />

      {/* Custom tokens — live color editor */}
      <button
        type="button"
        onClick={() => setShowCustom((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-(--hover)"
      >
        <div>
          <div className="text-[13px] text-(--fg)">Custom tokens</div>
          <div className="text-[11px] text-(--dim)">
            Edit colours live — changes apply immediately
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCustomActive ? <span className="text-[10px] text-(--hl2)">edited</span> : null}
          <ChevronDown
            className={`h-3.5 w-3.5 text-(--dim) transition-transform ${showCustom ? "" : "-rotate-90"}`}
          />
        </div>
      </button>

      {showCustom ? (
        <div className="pb-2">
          {tokenKeys.map((key) => (
            <TokenColorRow
              key={key}
              label={key}
              value={customTokens[key]}
              onChange={(v) => patchToken(key, v)}
            />
          ))}
          <div className="flex items-center justify-end gap-2 px-4 pt-2">
            <button
              type="button"
              onClick={resetTokens}
              className="h-7 rounded-md px-2.5 text-[11px] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            >
              Reset to theme
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
