import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { DESKTOP_CONFIG } from "../configs";
import type { DesktopUpdateSnapshot } from "../types";
import { log } from "../helpers/logger";
import { isLoopbackHttpUrl } from "../helpers/url";

let latestUpdateState: DesktopUpdateSnapshot = { status: "idle" };

function setUpdateState(nextState: DesktopUpdateSnapshot): void {
  latestUpdateState = nextState;
}

function resolveFeedUrl(): string | null {
  const raw = process.env.LOCAL_STUDIO_UPDATE_URL?.trim();
  if (!raw) return null;
  // Refuse cleartext update feeds — auto-update over http is trivially
  // MITM-able into shipping an arbitrary binary. Allow http only for loopback
  // (local testing of an update server).
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && !isLoopbackHttpUrl(raw)) {
      log.warn(`[update] Ignoring non-https update feed: ${parsed.protocol}//${parsed.host}`);
      return null;
    }
  } catch {
    log.warn("[update] Ignoring malformed LOCAL_STUDIO_UPDATE_URL");
    return null;
  }
  return raw.replace(/\/+$/, "");
}

function ensureFeedConfigured(): { ok: true; url: string } | { ok: false; reason: string } {
  const feedUrl = resolveFeedUrl();
  if (!feedUrl) {
    return { ok: false, reason: "LOCAL_STUDIO_UPDATE_URL is not set" };
  }

  autoUpdater.setFeedURL({
    provider: "generic",
    url: feedUrl,
    channel: DESKTOP_CONFIG.releaseChannel.name,
  });

  return { ok: true, url: feedUrl };
}

export function getUpdateState(): DesktopUpdateSnapshot {
  return latestUpdateState;
}

export async function checkForUpdates(force = false): Promise<DesktopUpdateSnapshot> {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    const disabledState = {
      status: "error",
      message: "Auto update disabled by LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE",
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(disabledState);
    return disabledState;
  }

  const feed = ensureFeedConfigured();
  if (!feed.ok) {
    const missingFeedState = {
      status: "error",
      message: feed.reason,
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(missingFeedState);
    return missingFeedState;
  }

  if (!app.isPackaged && !force) {
    const devState = {
      status: "idle",
      message: "Auto updates are only available in packaged builds",
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(devState);
    return devState;
  }

  try {
    setUpdateState({ status: "checking" });
    autoUpdater.allowPrerelease = DESKTOP_CONFIG.releaseChannel.allowPrerelease;
    await autoUpdater.checkForUpdates();
    return latestUpdateState;
  } catch (error) {
    const errorState = {
      status: "error",
      message: String(error),
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(errorState);
    return errorState;
  }
}

export function initializeAutoUpdates(): void {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    log.warn("Auto update disabled by environment flag");
    return;
  }

  const feed = ensureFeedConfigured();
  if (!feed.ok) {
    setUpdateState({ status: "idle", message: feed.reason });
    log.warn(`Auto updates disabled: ${feed.reason}`);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking" });
    log.info("Checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "available", version: info.version });
    log.info(`Update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateState({ status: "not-available", version: info.version });
    log.info("No update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      message: `${progress.percent.toFixed(1)}%`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "downloaded", version: info.version });
    log.info(`Update downloaded: ${info.version}`);
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({ status: "error", message: String(error) });
    log.error(`Auto update error: ${String(error)}`);
  });

  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates().catch((error) => {
        log.error(`Background update check failed: ${String(error)}`);
      });
    }, 4_000);
  }
}
