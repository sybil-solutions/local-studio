import { isDevChannelBuild } from "./app-identity";
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
} from "electron";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { DesktopAppState } from "./types";
import { DESKTOP_CONFIG } from "./configs";
import { readJsonObject, writeJsonAtomic } from "./helpers/fs-json";
import { log } from "./helpers/logger";
import { isHttpUrl } from "./helpers/url";
import { createMainWindow, logRenderProcessGone } from "./logic/window-manager";
import { registerNavigationPolicy } from "./logic/security";
import { startFrontendServer, stopFrontendServer, type ServerHandle } from "./logic/app-server";
import {
  resolveFrontendRestartUrl,
  shouldReloadAfterFrontendRestart,
} from "./logic/frontend-restart";
import { getUpdateState, initializeAutoUpdates, startUpdate } from "./logic/update-manager";
import { addProject, listProjectsWithMeta, removeProject } from "./logic/projects-store";
import { deployController } from "./logic/controller-deploy";
import {
  getKittylitterPairingJson,
  normalizeKittylitterPairingJson,
} from "./logic/kittylitter-pairing";

let appState: DesktopAppState = "starting";
let mainWindow: BrowserWindow | null = null;
let frontendServer: ServerHandle | undefined;
let restartingFrontend = false;
let frontendHealthTimer: NodeJS.Timeout | undefined;
let frontendHealthFailures = 0;
let restartAttempts = 0;
let lastRestartAt = 0;
let shutdownPromise: Promise<void> | undefined;
let quitAfterShutdown = false;
let relaunchAfterShutdown = false;
const expectedFrontendStopPids = new Set<number>();

const HEALTH_CHECK_INTERVAL_MS = 5_000;
const HEALTH_CHECK_TIMEOUT_MS = 4_000;
const HEALTH_FAILURE_THRESHOLD = 5;
const RESTART_BACKOFF_STEP_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 15_000;
const RESTART_BACKOFF_WINDOW_MS = 60_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Read the latest app state without control-flow narrowing so it can be
// re-checked after an `await` (e.g. shutdown started during restart backoff).
function isAppStopping(): boolean {
  return appState === "stopping";
}

// Open the app window and keep `mainWindow` honest: the reference must drop on
// close so `activate` and the restart path know to build a fresh one.
function openMainWindow(url: string): void {
  mainWindow = createMainWindow(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap(): Promise<void> {
  if (!frontendServer) {
    frontendServer = await startFrontendServer({ onExit: handleFrontendServerExit });
    registerNavigationPolicy(new URL(frontendServer.runtime.url).origin);
    startFrontendHealthMonitor();
  }
  if (!mainWindow) openMainWindow(frontendServer.runtime.url);

  appState = "ready";
  log.info(
    `Desktop ready (mode=${frontendServer.runtime.mode}, url=${frontendServer.runtime.url})`,
  );
}

function stopFrontendHealthMonitor(): void {
  if (!frontendHealthTimer) return;
  clearInterval(frontendHealthTimer);
  frontendHealthTimer = undefined;
  frontendHealthFailures = 0;
}

function currentRendererUrl(): string | undefined {
  if (!mainWindow || mainWindow.isDestroyed()) return undefined;
  return mainWindow.webContents.getURL() || undefined;
}

function startFrontendHealthMonitor(): void {
  stopFrontendHealthMonitor();
  frontendHealthTimer = setInterval(() => {
    void checkFrontendHealth();
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function checkFrontendHealth(): Promise<void> {
  if (!frontendServer || restartingFrontend || appState === "stopping") return;
  if (frontendServer.runtime.mode !== "embedded-standalone") return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    // Any HTTP answer means the Node server is alive and serving; only a
    // transport-level failure (process dead/hung) rejects and counts as unhealthy.
    await fetch(`${frontendServer.runtime.url}/api/desktop-health`, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "cache-control": "no-cache" },
    });
    frontendHealthFailures = 0;
    return;
  } catch {
    frontendHealthFailures += 1;
  } finally {
    clearTimeout(timeout);
  }

  if (frontendHealthFailures < HEALTH_FAILURE_THRESHOLD || !frontendServer) return;
  const stalledServer = frontendServer;
  const rendererUrl = currentRendererUrl();
  frontendHealthFailures = 0;
  log.error(`Embedded frontend health check failed; restarting ${stalledServer.runtime.url}`);
  const pid = stalledServer.process?.pid;
  if (pid) {
    expectedFrontendStopPids.add(pid);
    setTimeout(() => expectedFrontendStopPids.delete(pid), 30_000);
  }
  await stopFrontendServer(stalledServer, { stopAgentRuntime: false });
  if (frontendServer === stalledServer) frontendServer = undefined;
  await restartFrontendServer(stalledServer.runtime.port, stalledServer.agentRuntime, rendererUrl);
}

function handleFrontendServerExit(details: {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
}) {
  if (appState === "stopping") return;
  if (details.pid && expectedFrontendStopPids.delete(details.pid)) return;
  if (frontendServer?.process && frontendServer.process.pid !== details.pid) return;

  const previousServer = frontendServer;
  const rendererUrl = currentRendererUrl();
  frontendServer = undefined;
  log.error(
    `Embedded frontend stopped unexpectedly code=${details.code ?? "null"} signal=${details.signal ?? "null"}`,
  );
  void restartFrontendServer(
    previousServer?.runtime.port,
    previousServer?.agentRuntime,
    rendererUrl,
  );
}

async function restartFrontendServer(
  port?: number,
  agentRuntime?: ServerHandle["agentRuntime"],
  rendererUrl?: string,
): Promise<void> {
  if (restartingFrontend || appState === "stopping") return;
  restartingFrontend = true;
  appState = "starting";
  try {
    const now = Date.now();
    restartAttempts = now - lastRestartAt < RESTART_BACKOFF_WINDOW_MS ? restartAttempts + 1 : 1;
    lastRestartAt = now;
    const backoffMs = Math.min(
      RESTART_BACKOFF_MAX_MS,
      (restartAttempts - 1) * RESTART_BACKOFF_STEP_MS,
    );
    if (backoffMs > 0) {
      log.warn(`Embedded frontend restart backoff ${backoffMs}ms (attempt ${restartAttempts})`);
      await delay(backoffMs);
      if (isAppStopping()) return;
    }
    const started = await startFrontendServer({
      agentRuntime,
      port,
      onExit: handleFrontendServerExit,
    });
    // Shutdown may have begun during the fork. If so, shutdown() already cleared
    // the health monitor and no-op'd the (mid-restart undefined) server stop —
    // so tear this just-started server down instead of re-arming the monitor and
    // resurrecting a server the app is trying to quit.
    if (isAppStopping()) {
      await stopFrontendServer(started).catch(() => undefined);
      return;
    }
    frontendServer = started;
    startFrontendHealthMonitor();
    const nextUrl = frontendServer.runtime.url;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const liveUrl = mainWindow.webContents.getURL() || rendererUrl;
      if (shouldReloadAfterFrontendRestart(nextUrl, liveUrl)) {
        await mainWindow.loadURL(resolveFrontendRestartUrl(nextUrl, rendererUrl));
      }
    } else {
      openMainWindow(nextUrl);
    }
    appState = "ready";
    log.info(`Embedded frontend restarted (mode=${frontendServer.runtime.mode}, url=${nextUrl})`);
  } catch (error) {
    log.error(
      `Failed to restart embedded frontend: ${error instanceof Error ? error.stack : String(error)}`,
    );
  } finally {
    restartingFrontend = false;
  }
}

// Resolve a renderer-supplied file reference to a real path inside the user's
// home tree, or null. Assistant output cites files the way people write them —
// repo-relative, "services/agent-runtime/src/foo.ts". Passing that straight to
// realpath resolves it against the MAIN PROCESS cwd, which is the app bundle,
// so it throws; try it as given, then against each known project root.
function resolveHomeConfinedPath(target: unknown): string | null {
  if (typeof target !== "string" || !target.trim()) return null;
  const raw = target.trim();
  const candidates = [raw];
  if (!path.isAbsolute(raw) && !raw.startsWith("~")) {
    for (const project of listProjectsWithMeta()) {
      if (project.path) candidates.push(path.join(project.path, raw));
    }
  }
  const home = realpathSync.native(app.getPath("home"));
  for (const candidate of candidates) {
    let resolved: string;
    try {
      resolved = realpathSync.native(candidate);
    } catch {
      continue;
    }
    // Confined to the user's home tree, so a crafted markdown link cannot point
    // the renderer at /etc or a mounted disk.
    const relative = path.relative(home, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    return resolved;
  }
  return null;
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-runtime", async () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    releaseChannel: isDevChannelBuild ? "dev" : "stable",
    chromeVersion: process.versions.chrome,
    electronVersion: process.versions.electron,
  }));

  ipcMain.handle("desktop:open-external", async (_, url: string) => {
    if (!isHttpUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  // Reveal a file the assistant referenced in the OS file manager. Confined to
  // the user's home tree (the same default as the runtime's WORKSPACE_ROOTS) so
  // a crafted markdown link cannot point the renderer at /etc or a mounted disk.
  ipcMain.handle("desktop:reveal-path", async (_, target: unknown) => {
    const resolved = resolveHomeConfinedPath(target);
    if (!resolved) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  // Hand a file to its default application — the only way to view formats the
  // Files panel cannot render (PDFs, archives, media). Same home confinement.
  ipcMain.handle("desktop:open-path", async (_, target: unknown) => {
    const resolved = resolveHomeConfinedPath(target);
    if (!resolved) return false;
    const error = await shell.openPath(resolved);
    return error === "";
  });

  ipcMain.handle("desktop:get-update-status", async () => getUpdateState());
  ipcMain.handle("desktop:start-update", async () => startUpdate());
  ipcMain.handle("desktop:get-kittylitter-pairing-json", async () => getKittylitterPairingJson());
  ipcMain.handle("desktop:copy-kittylitter-pairing-json", async (_, pairingJson: unknown) => {
    try {
      if (typeof pairingJson !== "string") throw new Error("invalid pairing payload");
      clipboard.writeText(normalizeKittylitterPairingJson(pairingJson));
      return { ok: true };
    } catch {
      return { ok: false, error: "Connection JSON could not be copied." };
    }
  });

  ipcMain.handle("desktop:open-directory", async () => {
    const owner = mainWindow ?? undefined;
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    if (!selected) return null;
    try {
      return addProject(selected);
    } catch (error) {
      log.error(`Failed to add project from dialog: ${String(error)}`);
      throw error;
    }
  });

  ipcMain.handle(
    "desktop:controller-deploy",
    async (event, options: { host: string; port?: number; installDir?: string }) => {
      const resourcesPath = app.isPackaged
        ? path.join(process.resourcesPath, "app", "scripts")
        : path.join(app.getAppPath(), "..", "scripts");
      return deployController(options, resourcesPath, (line) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("desktop:controller-deploy-log", { line });
        }
      });
    },
  );

  ipcMain.handle("desktop:list-projects", async () => listProjectsWithMeta());

  ipcMain.handle("desktop:remove-project", async (_, id: string) => {
    if (typeof id !== "string") {
      throw new Error("id must be a string");
    }
    removeProject(id);
    return { ok: true } as const;
  });

  ipcMain.handle("desktop:load-session-prefs", async () => {
    return readSessionPrefsFile();
  });

  ipcMain.handle("desktop:save-session-prefs", async (_, prefs: unknown) => {
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
      throw new Error("prefs must be a plain object");
    }
    writeSessionPrefsFile(prefs as Record<string, unknown>);
  });

  ipcMain.handle("desktop:load-ui-preferences", async () => {
    return readUiPreferencesFile();
  });

  ipcMain.handle("desktop:save-ui-preferences", async (_, prefs: unknown) => {
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
      throw new Error("prefs must be a plain object");
    }
    writeUiPreferencesFile(onlyStringValues(prefs as Record<string, unknown>));
  });
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    appState = "stopping";
    stopFrontendHealthMonitor();
    await stopFrontendServer(frontendServer);
    frontendServer = undefined;
  })();
  return shutdownPromise;
}

async function run(): Promise<void> {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (appState === "stopping") {
      relaunchAfterShutdown = true;
      return;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow) {
      void bootstrap();
    }
  });

  app.on("before-quit", (event) => {
    if (quitAfterShutdown) return;
    event.preventDefault();
    void shutdown()
      .catch((error) => {
        log.error(`Shutdown failed: ${error instanceof Error ? error.stack : String(error)}`);
      })
      .finally(() => {
        if (relaunchAfterShutdown) app.relaunch();
        quitAfterShutdown = true;
        app.quit();
      });
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    void logRenderProcessGone("App render-process-gone", details, webContents.getURL());
  });

  process.on("uncaughtException", (error) => {
    log.error(`Uncaught exception: ${error.stack ?? String(error)}`);
  });

  process.on("unhandledRejection", (error) => {
    log.error(`Unhandled rejection: ${String(error)}`);
  });

  registerIpcHandlers();

  await app.whenReady();

  initializeAutoUpdates();

  try {
    await bootstrap();
  } catch (error) {
    log.error(`Failed to bootstrap desktop app: ${String(error)}`);
    // Surface the failure instead of vanishing from the dock with no feedback
    // (port in use, unwritable userData, missing server.js, slow-start timeout).
    try {
      dialog.showErrorBox(
        "Local Studio failed to start",
        `${error instanceof Error ? error.message : String(error)}\n\nSee the app logs for details.`,
      );
    } catch {
      // dialog unavailable (very early failure) — the log above still records it.
    }
    app.quit();
  }
}

void run();

function sessionPrefsFilePath(): string {
  return path.join(app.getPath("userData"), "session-prefs.json");
}

function uiPreferencesFilePath(): string {
  return path.join(app.getPath("userData"), "ui-preferences.json");
}

function readSessionPrefsFile(): Record<string, unknown> {
  return readJsonObject(sessionPrefsFilePath());
}

function writeSessionPrefsFile(prefs: Record<string, unknown>): void {
  writeJsonAtomic(sessionPrefsFilePath(), prefs);
}

function readUiPreferencesFile(): Record<string, string> {
  return onlyStringValues(readJsonObject(uiPreferencesFilePath()));
}

/** UI prefs are a flat string map; drop anything the renderer sent that isn't. */
function onlyStringValues(prefs: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(prefs).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );
}

function writeUiPreferencesFile(prefs: Record<string, string>): void {
  writeJsonAtomic(uiPreferencesFilePath(), prefs);
}
