import { BrowserWindow, screen, type Rectangle } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import {
  getStoredQuickPanelThreadSize,
  setStoredQuickPanelThreadSize,
  QUICK_PANEL_MIN_THREAD_SIZE,
} from "./desktop-settings";
import { hardenWebContents } from "./security";
import { rendererNavigationGeneration } from "./renderer-navigation-generation";

let panel: BrowserWindow | null = null;
let isThreadMode = false;
let persistSizeTimer: NodeJS.Timeout | null = null;
let userMovedPanel = false;
let applyingBounds = false;

type PanelSize = { width: number; height: number };

function threadWindowSize(): PanelSize {
  const preferred = DESKTOP_CONFIG.quickPanel.threadWindow;
  const stored = getStoredQuickPanelThreadSize();
  if (!stored) return preferred;
  return {
    width: Math.max(stored.width, preferred.width),
    height: Math.min(stored.height, preferred.height),
  };
}

function currentModeSize(): PanelSize {
  return isThreadMode ? threadWindowSize() : DESKTOP_CONFIG.quickPanel.homeWindow;
}

function centeredTopBounds(size: PanelSize): Rectangle {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const inset = DESKTOP_CONFIG.quickPanel.topInsetPx;
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height - inset);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + inset,
    width,
    height,
  };
}

function anchoredBounds(window: BrowserWindow, size: PanelSize): Rectangle {
  if (!userMovedPanel) return centeredTopBounds(size);
  const current = window.getBounds();
  const workArea = screen.getDisplayMatching(current).workArea;
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const x = Math.round(current.x + current.width / 2 - width / 2);
  const y = current.y;
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}

function applyBounds(window: BrowserWindow, bounds: Rectangle, animate = false): void {
  applyingBounds = true;
  try {
    window.setBounds(bounds, animate && process.platform === "darwin");
  } finally {
    applyingBounds = false;
  }
}

function createQuickPanelWindow(appUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    ...centeredTopBounds(DESKTOP_CONFIG.quickPanel.homeWindow),
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  rendererNavigationGeneration(window.webContents);
  hardenWebContents(window, new URL(appUrl).origin);
  window.on("moved", () => {
    if (applyingBounds) return;
    userMovedPanel = true;
  });
  window.on("resize", () => {
    if (applyingBounds || !isThreadMode || !window.isResizable()) return;
    if (persistSizeTimer) clearTimeout(persistSizeTimer);
    persistSizeTimer = setTimeout(() => {
      persistSizeTimer = null;
      if (window.isDestroyed()) return;
      const { width, height } = window.getBounds();
      setStoredQuickPanelThreadSize({ width, height });
    }, 400);
  });
  window.on("closed", () => {
    if (panel === window) panel = null;
  });

  void window.loadURL(`${appUrl}/quick`);

  return window;
}

export function ensureQuickPanel(appUrl: string): BrowserWindow {
  if (!panel || panel.isDestroyed()) {
    panel = createQuickPanelWindow(appUrl);
  }
  return panel;
}

export function getQuickPanelWindow(): BrowserWindow | null {
  return panel && !panel.isDestroyed() ? panel : null;
}

export function toggleQuickPanel(appUrl: string): void {
  const window = ensureQuickPanel(appUrl);
  if (window.isVisible()) {
    hideQuickPanel();
    return;
  }
  showQuickPanel(appUrl);
}

export function showQuickPanel(appUrl: string): void {
  const window = ensureQuickPanel(appUrl);
  applyBounds(window, anchoredBounds(window, currentModeSize()));
  window.show();
  window.focus();
}

export function hideQuickPanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) {
    panel.hide();
  }
}

export function resetQuickPanel(): void {
  if (!panel || panel.isDestroyed()) return;
  panel.webContents.reload();
}

export function resizeQuickPanelToThread(): void {
  if (!panel || panel.isDestroyed()) return;
  isThreadMode = true;
  panel.setMinimumSize(QUICK_PANEL_MIN_THREAD_SIZE.width, QUICK_PANEL_MIN_THREAD_SIZE.height);
  panel.setResizable(true);
  applyBounds(panel, anchoredBounds(panel, threadWindowSize()), true);
}

export function resizeQuickPanelToHome(): void {
  if (!panel || panel.isDestroyed()) return;
  isThreadMode = false;
  panel.setMinimumSize(0, 0);
  applyBounds(panel, anchoredBounds(panel, DESKTOP_CONFIG.quickPanel.homeWindow));
  panel.setResizable(false);
}
