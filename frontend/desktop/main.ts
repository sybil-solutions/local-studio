import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DesktopAppState } from "./types";
import { log } from "./helpers/logger";
import { isHttpUrl } from "./helpers/url";
import { createMainWindow } from "./logic/window-manager";
import { registerNavigationPolicy } from "./logic/security";
import { startFrontendServer, stopFrontendServer, type ServerHandle } from "./logic/app-server";
import { checkForUpdates, getUpdateState, initializeAutoUpdates } from "./logic/update-manager";
import { addProject, listProjectsWithMeta, removeProject } from "./logic/projects-store";

let appState: DesktopAppState = "starting";
let mainWindow: BrowserWindow | null = null;
let frontendServer: ServerHandle | undefined;

async function bootstrap(): Promise<void> {
  if (!frontendServer) {
    frontendServer = await startFrontendServer();
    registerNavigationPolicy(new URL(frontendServer.runtime.url).origin);
  }
  if (!mainWindow) {
    mainWindow = createMainWindow(frontendServer.runtime.url);
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  appState = "ready";
  log.info(
    `Desktop ready (mode=${frontendServer.runtime.mode}, url=${frontendServer.runtime.url})`,
  );
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-runtime", async () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    chromeVersion: process.versions.chrome,
    electronVersion: process.versions.electron,
  }));

  ipcMain.handle("desktop:open-external", async (_, url: string) => {
    if (!isHttpUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("desktop:get-update-status", async () => getUpdateState());
  ipcMain.handle("desktop:check-for-updates", async () => checkForUpdates(true));

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

  ipcMain.handle("desktop:list-projects", async () => listProjectsWithMeta());

  ipcMain.handle("desktop:add-project", async (_, directoryPath: string) => {
    if (typeof directoryPath !== "string") {
      throw new Error("directoryPath must be a string");
    }
    return addProject(directoryPath);
  });

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
}

async function shutdown(): Promise<void> {
  if (appState === "stopping") return;
  appState = "stopping";
  await stopFrontendServer(frontendServer);
  frontendServer = undefined;
}

async function run(): Promise<void> {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
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

  app.on("before-quit", () => {
    void shutdown();
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
    app.quit();
  }
}

void run();

function sessionPrefsFilePath(): string {
  return path.join(app.getPath("userData"), "session-prefs.json");
}

function readSessionPrefsFile(): Record<string, unknown> {
  const filePath = sessionPrefsFilePath();
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeSessionPrefsFile(prefs: Record<string, unknown>): void {
  const filePath = sessionPrefsFilePath();
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(prefs)}\n`, "utf8");
  renameSync(tempPath, filePath);
}
