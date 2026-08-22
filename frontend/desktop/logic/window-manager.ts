import { app, BrowserWindow, type RenderProcessGoneDetails } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import { log } from "../helpers/logger";
import { hardenWebContents, registerPermissionPolicy } from "./security";

/**
 * One crash line for both the per-window and the app-wide `render-process-gone`
 * events: `source` names which fired, and the memory figures say whether the
 * renderer died of OOM.
 */
export async function logRenderProcessGone(
  source: string,
  details: RenderProcessGoneDetails,
  url: string,
): Promise<void> {
  let memory = "memory=unavailable";
  try {
    memory = `memory=${JSON.stringify(await process.getProcessMemoryInfo())}`;
  } catch {}
  log.error(
    [
      source,
      `reason=${details.reason}`,
      `exitCode=${details.exitCode}`,
      `url=${url}`,
      `appVersion=${app.getVersion()}`,
      memory,
    ].join(" "),
  );
}

export function createMainWindow(appUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: DESKTOP_CONFIG.preferredWindow.width,
    height: DESKTOP_CONFIG.preferredWindow.height,
    minWidth: DESKTOP_CONFIG.minimumWindow.width,
    minHeight: DESKTOP_CONFIG.minimumWindow.height,
    backgroundColor: "#0b0f14",
    show: false,
    title: DESKTOP_CONFIG.appName,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "desktop", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      devTools: !process.env.LOCAL_STUDIO_DESKTOP_DISABLE_DEVTOOLS,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  const appOrigin = new URL(appUrl).origin;
  hardenWebContents(window, appOrigin);
  registerPermissionPolicy(window, appOrigin);

  let lastRendererReloadAt = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    void logRenderProcessGone(
      "Renderer process gone",
      details,
      window.webContents.getURL() || appUrl,
    );
    // Recover from a renderer crash (OOM/GPU/abnormal) by reloading, so the user
    // isn't left with a permanent blank window. Rate-limited so a hard crash-loop
    // doesn't spin — after that the window stays blank rather than thrashing.
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const now = Date.now();
    if (now - lastRendererReloadAt < 10_000) return;
    lastRendererReloadAt = now;
    log.warn("Reloading window after renderer crash");
    window.webContents.reload();
  });

  window.once("ready-to-show", () => window.show());
  void window.loadURL(appUrl);

  return window;
}
