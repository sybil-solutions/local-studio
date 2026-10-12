"use client";

import { useSyncExternalStore } from "react";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";

export type TerminalAction = "clearTerminal" | "fontSizeUp" | "fontSizeDown" | "fontSizeReset";

export type TerminalKeybinds = Record<TerminalAction, string>;

export const TERMINAL_ACTIONS: readonly TerminalAction[] = [
  "clearTerminal",
  "fontSizeUp",
  "fontSizeDown",
  "fontSizeReset",
] as const;

export const TERMINAL_ACTION_LABELS: Record<TerminalAction, string> = {
  clearTerminal: "Clear terminal",
  fontSizeUp: "Increase font size",
  fontSizeDown: "Decrease font size",
  fontSizeReset: "Reset font size",
};

export const DEFAULT_TERMINAL_KEYBINDS: TerminalKeybinds = {
  clearTerminal: "mod+k",
  fontSizeUp: "mod+=",
  fontSizeDown: "mod+-",
  fontSizeReset: "mod+0",
};

export const TERMINAL_FONT_SIZE_DEFAULT = 12;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 28;

const KEYBINDS_KEY = "local-studio.terminalKeybinds.v1";
const FONT_SIZE_KEY = "local-studio.terminalFontSize";
const CHANGE_EVENT = "local-studio.terminalKeybinds.changed";

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

type Combo = { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string };

const CODE_KEY: Record<string, string> = {
  Equal: "=",
  Minus: "-",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Space: "space",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase();
  return CODE_KEY[code] ?? null;
}

export function parseKeybind(binding: string): Combo | null {
  const mac = isMac();
  const parts = binding
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const combo: Combo = { meta: false, ctrl: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    if (part === "mod") {
      if (mac) combo.meta = true;
      else combo.ctrl = true;
    } else if (part === "cmd" || part === "meta" || part === "command") combo.meta = true;
    else if (part === "ctrl" || part === "control") combo.ctrl = true;
    else if (part === "alt" || part === "option") combo.alt = true;
    else if (part === "shift") combo.shift = true;
    else combo.key = part;
  }
  return combo.key ? combo : null;
}

const MAC_GLYPH: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  meta: "⌘",
  command: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
};

const GENERIC_GLYPH: Record<string, string> = {
  mod: "Ctrl",
  cmd: "Win",
  meta: "Win",
  command: "Win",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

export function formatKeybind(binding: string): string[] {
  const table = isMac() ? MAC_GLYPH : GENERIC_GLYPH;
  return binding
    .split("+")
    .filter(Boolean)
    .map((part) => {
      const token = part.toLowerCase();
      if (table[token]) return table[token];
      if (token === "space") return "Space";
      return token.length === 1 ? token.toUpperCase() : token[0].toUpperCase() + token.slice(1);
    });
}

export function matchKeybind(event: KeyboardEvent, binding: string): boolean {
  const combo = parseKeybind(binding);
  if (!combo) return false;
  if (event.metaKey !== combo.meta) return false;
  if (event.ctrlKey !== combo.ctrl) return false;
  if (event.altKey !== combo.alt) return false;
  if (event.shiftKey !== combo.shift) return false;
  return codeToKey(event.code) === combo.key;
}

export function eventToKeybind(event: KeyboardEvent): string | null {
  const key = codeToKey(event.code);
  if (!key) return null;
  const mac = isMac();
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push("mod");
  if (mac ? event.ctrlKey : event.metaKey) parts.push(mac ? "ctrl" : "cmd");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

export function matchTerminalAction(
  event: KeyboardEvent,
  keybinds: TerminalKeybinds,
): TerminalAction | null {
  for (const action of TERMINAL_ACTIONS) {
    if (matchKeybind(event, keybinds[action])) return action;
  }
  return null;
}

function sanitizeKeybinds(input: Partial<Record<string, unknown>>): Partial<TerminalKeybinds> {
  const result: Partial<TerminalKeybinds> = {};
  for (const action of TERMINAL_ACTIONS) {
    const value = input[action];
    if (typeof value === "string" && value.trim()) result[action] = value;
  }
  return result;
}

function readKeybinds(): TerminalKeybinds {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_KEYBINDS;
  try {
    const raw = window.localStorage.getItem(KEYBINDS_KEY);
    if (!raw) return DEFAULT_TERMINAL_KEYBINDS;
    return { ...DEFAULT_TERMINAL_KEYBINDS, ...sanitizeKeybinds(JSON.parse(raw)) };
  } catch {
    return DEFAULT_TERMINAL_KEYBINDS;
  }
}

function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)));
}

function readFontSize(): number {
  if (typeof window === "undefined") return TERMINAL_FONT_SIZE_DEFAULT;
  const raw = window.localStorage.getItem(FONT_SIZE_KEY);
  if (raw == null) return TERMINAL_FONT_SIZE_DEFAULT;
  return clampTerminalFontSize(Number(raw));
}

let keybindsCache: TerminalKeybinds = readKeybinds();
let fontSizeCache: number = readFontSize();
let wired = false;
const listeners = new Set<() => void>();

function refresh(): void {
  const nextKeybinds = readKeybinds();
  const nextFontSize = readFontSize();
  let changed = false;
  if (!TERMINAL_ACTIONS.every((action) => nextKeybinds[action] === keybindsCache[action])) {
    keybindsCache = nextKeybinds;
    changed = true;
  }
  if (nextFontSize !== fontSizeCache) {
    fontSizeCache = nextFontSize;
    changed = true;
  }
  if (changed) listeners.forEach((listener) => listener());
}

function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("storage", refresh);
  window.addEventListener(CHANGE_EVENT, refresh);
}

export function subscribeTerminalStore(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTerminalKeybinds(): TerminalKeybinds {
  return keybindsCache;
}

export function getTerminalFontSize(): number {
  return fontSizeCache;
}

function persist(): void {
  refresh();
  scheduleDurableUiPreferencesSave();
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function writeKeybinds(next: TerminalKeybinds): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEYBINDS_KEY, JSON.stringify(next));
  persist();
}

export function setTerminalKeybind(action: TerminalAction, binding: string): void {
  writeKeybinds({ ...keybindsCache, [action]: binding });
}

export function resetTerminalKeybind(action: TerminalAction): void {
  writeKeybinds({ ...keybindsCache, [action]: DEFAULT_TERMINAL_KEYBINDS[action] });
}

export function resetTerminalKeybinds(): void {
  writeKeybinds({ ...DEFAULT_TERMINAL_KEYBINDS });
}

export function saveTerminalFontSize(size: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FONT_SIZE_KEY, String(clampTerminalFontSize(size)));
  persist();
}

export function bumpTerminalFontSize(delta: number): void {
  saveTerminalFontSize(clampTerminalFontSize(fontSizeCache + delta));
}

export function resetTerminalFontSize(): void {
  saveTerminalFontSize(TERMINAL_FONT_SIZE_DEFAULT);
}

export function useTerminalKeybinds(): TerminalKeybinds {
  return useSyncExternalStore(
    subscribeTerminalStore,
    () => keybindsCache,
    () => DEFAULT_TERMINAL_KEYBINDS,
  );
}

export function useTerminalFontSize(): number {
  return useSyncExternalStore(
    subscribeTerminalStore,
    () => fontSizeCache,
    () => TERMINAL_FONT_SIZE_DEFAULT,
  );
}
