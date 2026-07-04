import { BrowserWindow, screen, type Rectangle } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import {
  getStoredQuickPanelThreadSize,
  setStoredQuickPanelThreadSize,
  QUICK_PANEL_MIN_THREAD_SIZE,
} from "./desktop-settings";
import { hardenWebContents } from "./security";

let panel: BrowserWindow | null = null;
let isThreadMode = false;
let persistSizeTimer: NodeJS.Timeout | null = null;
// Where the user last dragged the panel. While set, mode changes and re-shows
// anchor to this spot instead of snapping back to the screen-top center.
let userMovedPanel = false;
let applyingBounds = false;

type PanelSize = { width: number; height: number };

function threadWindowSize(): PanelSize {
  return getStoredQuickPanelThreadSize() ?? DESKTOP_CONFIG.quickPanel.threadWindow;
}

function currentModeSize(): PanelSize {
  return isThreadMode ? threadWindowSize() : DESKTOP_CONFIG.quickPanel.homeWindow;
}

function centeredTopBounds(size: PanelSize): Rectangle {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + DESKTOP_CONFIG.quickPanel.topInsetPx,
    width,
    height,
  };
}

/** Bounds for `size` that respect the user's dragged position: keep the
 * panel's current top edge and horizontal center, clamped to its display. */
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

function applyBounds(window: BrowserWindow, bounds: Rectangle): void {
  applyingBounds = true;
  try {
    window.setBounds(bounds);
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

  hardenWebContents(window, new URL(appUrl).origin);
  window.on("blur", () => hideQuickPanel());
  window.on("moved", () => {
    if (applyingBounds) return;
    userMovedPanel = true;
  });
  window.on("resize", () => {
    // Remember the user's thread-mode size across restarts. Debounced so we
    // only persist once per drag, and guarded so programmatic home/thread
    // transitions don't overwrite the remembered size.
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

/** Reload the panel page so the next open starts from a fresh composer.
 * Called on explicit dismiss / open-in-app — NOT on blur-hide, so briefly
 * switching apps doesn't discard an in-progress quick thread. */
export function resetQuickPanel(): void {
  if (!panel || panel.isDestroyed()) return;
  panel.webContents.reload();
}

export function resizeQuickPanelToThread(): void {
  if (!panel || panel.isDestroyed()) return;
  applyBounds(panel, anchoredBounds(panel, threadWindowSize()));
  panel.setResizable(true);
  panel.setMinimumSize(QUICK_PANEL_MIN_THREAD_SIZE.width, QUICK_PANEL_MIN_THREAD_SIZE.height);
  // Flip mode last so the transition's own resize event isn't persisted.
  isThreadMode = true;
}

export function resizeQuickPanelToHome(): void {
  if (!panel || panel.isDestroyed()) return;
  isThreadMode = false;
  panel.setMinimumSize(0, 0);
  applyBounds(panel, anchoredBounds(panel, DESKTOP_CONFIG.quickPanel.homeWindow));
  panel.setResizable(false);
}
