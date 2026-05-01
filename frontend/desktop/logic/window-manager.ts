import { BrowserWindow } from "electron";
import path from "node:path";
import { DESKTOP_CONFIG } from "../configs";
import { hardenWebContents } from "./security";

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
      devTools: !process.env.VLLM_STUDIO_DESKTOP_DISABLE_DEVTOOLS,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  hardenWebContents(window, new URL(appUrl).origin);

  window.once("ready-to-show", () => window.show());
  void window.loadURL(appUrl);

  return window;
}
