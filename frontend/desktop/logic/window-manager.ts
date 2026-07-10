import { app, BrowserWindow } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import { log } from "../helpers/logger";
import { hardenWebContents, registerMicrophonePermissionPolicy } from "./security";

async function memorySummary(): Promise<string> {
  try {
    const memory = await process.getProcessMemoryInfo();
    return `memory=${JSON.stringify(memory)}`;
  } catch {
    return "memory=unavailable";
  }
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
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      webSecurity: true,
      devTools: !process.env.LOCAL_STUDIO_DESKTOP_DISABLE_DEVTOOLS,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  const appOrigin = new URL(appUrl).origin;
  hardenWebContents(window, appOrigin);
  registerMicrophonePermissionPolicy(window, appOrigin);

  let lastRendererReloadAt = 0;
  window.webContents.on("render-process-gone", (_event, details) => {
    void memorySummary().then((memory) => {
      log.error(
        [
          "Renderer process gone",
          `reason=${details.reason}`,
          `exitCode=${details.exitCode}`,
          `url=${window.webContents.getURL() || appUrl}`,
          `appVersion=${app.getVersion()}`,
          memory,
        ].join(" "),
      );
    });
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
