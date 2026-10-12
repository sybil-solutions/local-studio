import { app } from "electron";
import { isDevChannelBuild } from "../app-identity";
import { autoUpdater } from "electron-updater";
import { DESKTOP_CONFIG } from "../configs";
import type { DesktopUpdateSnapshot } from "../types";
import { log } from "../helpers/logger";
import { isLoopbackHttpUrl } from "../helpers/url";
import { UpdateInstallIntent } from "./update-install-intent";

let latestUpdateState: DesktopUpdateSnapshot = { status: "idle" };
const installIntent = new UpdateInstallIntent();

function setUpdateState(nextState: DesktopUpdateSnapshot): void {
  latestUpdateState = nextState;
}

function setUpdateError(error: unknown): void {
  installIntent.clear();
  const message = String(error);
  setUpdateState({ status: "error", message });
  log.error(`Auto update error: ${message}`);
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

function ensureFeedConfigured(): { ok: true; url: string } {
  const feedUrl = resolveFeedUrl();
  if (feedUrl) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feedUrl,
      channel: "stable",
    });
    return { ok: true, url: feedUrl };
  }

  // Default feed: the public GitHub releases, which ship latest-mac.yml plus
  // signed zip/dmg assets. electron-updater verifies the download's code
  // signature against the running app before installing.
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "sybil-solutions",
    repo: "local-studio",
  });
  return { ok: true, url: "github:sybil-solutions/local-studio" };
}

export function getUpdateState(): DesktopUpdateSnapshot {
  return latestUpdateState;
}

function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall();
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

  // Dev-channel builds install via the dev mirror, never the stable releases —
  // the default GitHub feed would happily "update" them onto stable. An
  // explicit LOCAL_STUDIO_UPDATE_URL override still wins for feed testing.
  if (isDevChannelBuild && !resolveFeedUrl()) {
    const devChannelState = {
      status: "idle",
      message: "Dev-channel builds do not auto-update from stable releases",
    } satisfies DesktopUpdateSnapshot;
    setUpdateState(devChannelState);
    return devChannelState;
  }

  ensureFeedConfigured();

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
    autoUpdater.allowPrerelease = false;
    const result = await autoUpdater.checkForUpdates();
    if (result?.downloadPromise) void result.downloadPromise.catch(setUpdateError);
    // An unpackaged app resolves null without emitting any status event; leave
    // "checking" behind and the renderer would poll forever.
    if (!result && latestUpdateState.status === "checking") {
      setUpdateState({ status: "idle", message: "Updater unavailable in this build" });
    }
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

export async function startUpdate(): Promise<DesktopUpdateSnapshot> {
  const action = installIntent.request(latestUpdateState.status);
  if (action === "install") {
    installDownloadedUpdate();
    return latestUpdateState;
  }
  if (action === "wait") return latestUpdateState;

  const snapshot = await checkForUpdates(true);
  if (
    snapshot.status === "idle" ||
    snapshot.status === "not-available" ||
    snapshot.status === "error"
  ) {
    installIntent.clear();
  }
  return snapshot;
}

export function initializeAutoUpdates(): void {
  if (DESKTOP_CONFIG.disableAutoUpdate) {
    log.warn("Auto update disabled by environment flag");
    return;
  }

  if (isDevChannelBuild && !resolveFeedUrl()) {
    setUpdateState({ status: "idle", message: "Dev channel: auto-update disabled" });
    log.info("[update] Dev-channel build; skipping stable release feed");
    return;
  }

  const feed = ensureFeedConfigured();
  log.info(`[update] Feed: ${feed.url}`);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({ status: "checking" });
    log.info("Checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({ status: "available", version: info.version });
    log.info(`Update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", (info) => {
    installIntent.clear();
    setUpdateState({ status: "not-available", version: info.version });
    log.info("No update available");
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      version: latestUpdateState.version,
      message: `${progress.percent.toFixed(1)}%`,
      progress: progress.percent,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({ status: "downloaded", version: info.version });
    log.info(`Update downloaded: ${info.version}`);
    if (installIntent.downloadCompleted()) {
      log.info(`Restarting to install update: ${info.version}`);
      installDownloadedUpdate();
    }
  });

  autoUpdater.on("error", (error) => {
    setUpdateError(error);
  });

  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates().catch((error) => {
        log.error(`Background update check failed: ${String(error)}`);
      });
    }, 4_000);
  }
}
