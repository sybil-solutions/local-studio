import { app } from "electron";
import path from "node:path";

const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:3000";

export const DESKTOP_CONFIG = {
  appName: "Local Studio",
  minimumWindow: { width: 1200, height: 760 },
  preferredWindow: { width: 1520, height: 980 },
  startupTimeoutMs: 45_000,
  devServerUrl: process.env.LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL ?? DEFAULT_DEV_SERVER_URL,
  disableAutoUpdate: process.env.LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE === "true",
  userDataDir: app.getPath("userData"),
  quickPanel: {
    hotkey: process.env.LOCAL_STUDIO_DESKTOP_QUICK_PANEL_HOTKEY ?? "CommandOrControl+,",
    homeWindow: { width: 520, height: 340 },
    threadWindow: { width: 560, height: 640 },
    topInsetPx: 96,
  },
};

export function resolveStandaloneBaseDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app", "frontend", ".next", "standalone");
  }

  return path.resolve(__dirname, "..", "..", ".next", "standalone");
}

export function resolveStaticAssetsSource(): { staticDir: string; publicDir: string } {
  if (app.isPackaged) {
    return {
      staticDir: path.join(process.resourcesPath, "app", "frontend", ".next", "static"),
      publicDir: path.join(process.resourcesPath, "app", "frontend", "public"),
    };
  }

  return {
    staticDir: path.resolve(__dirname, "..", "..", ".next", "static"),
    publicDir: path.resolve(__dirname, "..", "..", "public"),
  };
}
