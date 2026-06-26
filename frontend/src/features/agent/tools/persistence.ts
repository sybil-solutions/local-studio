import {
  COMPUTER_TAB_IDS,
  type BrowserBackend,
  type BrowserState,
  type ComputerState,
  type ComputerTab,
} from "@/features/agent/tools/types";

export const BROWSER_TOOL_KEY = "local-studio.agent.browserToolEnabled";
export const BROWSER_BACKEND_KEY = "local-studio.agent.browserBackend";
export const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "***************************************************";
export const COMPUTER_BROWSER_OPEN_KEY = "local-studio.agent.computer.browserOpen";
export const COMPUTER_FILES_OPEN_KEY = "local-studio.agent.computer.filesOpen";
export const COMPUTER_DEFAULT_CLOSED_STORAGE_ID = "local-studio.agent.computer.defaultCollapsedV2";
export const COMPUTER_WIDTH_KEY = "local-studio.agent.computer.width";
export const COMPUTER_TAB_KEY = "local-studio.agent.computer.tab";
export const COMPUTER_TABS_KEY = "local-studio.agent.computer.tabs";
export const COMPUTER_CANVAS_ENABLED_KEY = "local-studio.agent.computer.canvasEnabled";
export const COMPUTER_CANVAS_TEXT_KEY = "local-studio.agent.computer.canvasText";

export const DEFAULT_BROWSER_URL = "about:blank";
export const DEFAULT_BROWSER_BACKEND: BrowserBackend = "embedded";
export const DEFAULT_COMPUTER_WIDTH = 440;
export const MIN_COMPUTER_WIDTH = 280;
export const MAX_COMPUTER_WIDTH = 1800;
export const MIN_CHAT_WIDTH_WHEN_COMPUTER_OPEN = 340;
export const COMPUTER_SNAP_RATIOS = [0.25, 0.35, 0.5, 0.65] as const;

const COMPUTER_TABS: readonly ComputerTab[] = COMPUTER_TAB_IDS;

function viewportWidth(): number | undefined {
  return typeof window === "undefined" ? undefined : window.innerWidth;
}

export function computerWidthBounds(containerWidth = viewportWidth()): {
  min: number;
  max: number;
} {
  if (!containerWidth || !Number.isFinite(containerWidth)) {
    return { min: MIN_COMPUTER_WIDTH, max: MAX_COMPUTER_WIDTH };
  }
  const minimum = Math.max(
    MIN_COMPUTER_WIDTH,
    Math.round(containerWidth * COMPUTER_SNAP_RATIOS[0]),
  );
  const roomyMaximum = Math.round(
    containerWidth * COMPUTER_SNAP_RATIOS[COMPUTER_SNAP_RATIOS.length - 1],
  );
  const chatSafeMaximum = Math.max(minimum, containerWidth - MIN_CHAT_WIDTH_WHEN_COMPUTER_OPEN);
  return {
    min: minimum,
    max: Math.min(MAX_COMPUTER_WIDTH, roomyMaximum, chatSafeMaximum),
  };
}

export function clampComputerWidth(width: number, containerWidth?: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COMPUTER_WIDTH;
  const { min, max } = computerWidthBounds(containerWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function computerSnapWidths(containerWidth: number): number[] {
  const { min, max } = computerWidthBounds(containerWidth);
  return COMPUTER_SNAP_RATIOS.map((ratio) => Math.round(containerWidth * ratio)).filter(
    (width) => width >= min && width <= max,
  );
}

export function gentlySnapComputerWidth(width: number, containerWidth: number): number {
  const clamped = clampComputerWidth(width, containerWidth);
  const snapThreshold = Math.max(14, Math.min(30, Math.round(containerWidth * 0.015)));
  const nearest = computerSnapWidths(containerWidth).reduce<number | null>((best, candidate) => {
    if (best === null) return candidate;
    return Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best;
  }, null);
  if (nearest === null || Math.abs(nearest - clamped) > snapThreshold) return clamped;
  return nearest;
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota / private mode — keep state in memory only.
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

export function migrateToolStorage(): void {
  if (!read(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY)) {
    write(BROWSER_TOOL_KEY, "0");
    write(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY, "1");
  }
  if (!read(COMPUTER_DEFAULT_CLOSED_STORAGE_ID)) {
    write(COMPUTER_BROWSER_OPEN_KEY, "0");
    write(COMPUTER_FILES_OPEN_KEY, "0");
    write(COMPUTER_DEFAULT_CLOSED_STORAGE_ID, "1");
  }
  // Computer panel always boots closed regardless of last session.
  write(COMPUTER_BROWSER_OPEN_KEY, "0");
  // SESSIONS_COLLAPSED_KEY cleanup is owned by workspace persistence.ts; tools
  // doesn't touch sidebar collapse state.
  remove("local-studio.agent.sessionsCollapsed");
}

export function loadBrowserState(): BrowserState {
  return {
    enabled: read(BROWSER_TOOL_KEY) === "1",
    backend: parseBrowserBackend(read(BROWSER_BACKEND_KEY)),
    url: DEFAULT_BROWSER_URL,
    input: DEFAULT_BROWSER_URL,
  };
}

export function loadComputerState(): ComputerState {
  const storedWidth = Number(read(COMPUTER_WIDTH_KEY));
  const storedTab = read(COMPUTER_TAB_KEY);
  const tab: ComputerTab = isComputerTab(storedTab) ? storedTab : "status";
  const storedTabs = readComputerTabs();
  const canvasEnabled = read(COMPUTER_CANVAS_ENABLED_KEY) === "1";
  const persistedTabs = uniqueComputerTabs([
    "status",
    ...(storedTabs.length ? storedTabs : [tab]),
    ...(canvasEnabled ? (["canvas"] as const) : []),
  ]);
  const tabs = persistedTabs.includes(tab)
    ? persistedTabs
    : uniqueComputerTabs([...persistedTabs, tab]);
  return {
    open: false,
    tab,
    tabs,
    width: Number.isFinite(storedWidth) ? clampComputerWidth(storedWidth) : DEFAULT_COMPUTER_WIDTH,
    canvasEnabled,
    canvasText: read(COMPUTER_CANVAS_TEXT_KEY) ?? "",
  };
}

function isComputerTab(value: unknown): value is ComputerTab {
  return typeof value === "string" && COMPUTER_TABS.includes(value as ComputerTab);
}

function readComputerTabs(): ComputerTab[] {
  const raw = read(COMPUTER_TABS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? uniqueComputerTabs(parsed.filter(isComputerTab)) : [];
  } catch {
    return [];
  }
}

export function uniqueComputerTabs(tabs: ComputerTab[]): ComputerTab[] {
  const seen = new Set<ComputerTab>();
  const out: ComputerTab[] = [];
  for (const tab of tabs) {
    if (seen.has(tab)) continue;
    seen.add(tab);
    out.push(tab);
  }
  return out.includes("status") ? out : ["status", ...out];
}

export function writeBrowserEnabled(enabled: boolean): void {
  write(BROWSER_TOOL_KEY, enabled ? "1" : "0");
}

function parseBrowserBackend(value: string | null): BrowserBackend {
  // A previously-stored "parchi" (now removed) falls back to the default so
  // existing installs don't break on reload.
  return value === "embedded" || value === "sitegeist" ? value : DEFAULT_BROWSER_BACKEND;
}

export function writeBrowserBackend(backend: BrowserBackend): void {
  write(BROWSER_BACKEND_KEY, backend);
}

export function writeComputerTab(tab: ComputerTab): void {
  write(COMPUTER_FILES_OPEN_KEY, tab === "files" ? "1" : "0");
  write(COMPUTER_TAB_KEY, tab);
}

export function writeComputerTabs(tabs: ComputerTab[]): void {
  write(COMPUTER_TABS_KEY, JSON.stringify(uniqueComputerTabs(tabs)));
}

export function writeComputerWidth(width: number): void {
  write(COMPUTER_WIDTH_KEY, String(clampComputerWidth(width)));
}

export function writeComputerCanvasEnabled(enabled: boolean): void {
  write(COMPUTER_CANVAS_ENABLED_KEY, enabled ? "1" : "0");
}

export function writeComputerCanvasText(text: string): void {
  write(COMPUTER_CANVAS_TEXT_KEY, text);
}
