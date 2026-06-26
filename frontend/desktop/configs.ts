import { app } from "electron";
import path from "node:path";
import type { DesktopReleaseChannel } from "./types";

const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:3000";

function resolveReleaseChannel(): DesktopReleaseChannel {
  const raw = (process.env.LOCAL_STUDIO_DESKTOP_CHANNEL ?? "stable").toLowerCase();
  if (raw === "alpha") return { name: "alpha", allowPrerelease: true };
  if (raw === "beta") return { name: "beta", allowPrerelease: true };
  return { name: "stable", allowPrerelease: false };
}

export const DESKTOP_CONFIG = {
  appName: "Local Studio",
  minimumWindow: { width: 1200, height: 760 },
  preferredWindow: { width: 1520, height: 980 },
  startupTimeoutMs: 45_000,
  releaseChannel: resolveReleaseChannel(),
  devServerUrl: process.env.LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL ?? DEFAULT_DEV_SERVER_URL,
  disableAutoUpdate: process.env.LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE === "true",
  userDataDir: app.getPath("userData"),
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
