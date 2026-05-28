import "./app-identity";
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
import {
  closePty,
  isPtyAvailable,
  killAllPtys,
  openPty,
  ptyUnavailableReason,
  resizePty,
  writePty,
} from "./logic/pty-manager";

let appState: DesktopAppState = "starting";
let mainWindow: BrowserWindow | null = null;
let frontendServer: ServerHandle | undefined;

async function processMemorySummary(): Promise<string> {
  try {
    return `memory=${JSON.stringify(await process.getProcessMemoryInfo())}`;
  } catch {
    return "memory=unavailable";
  }
}

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

  ipcMain.handle("desktop:load-ui-preferences", async () => {
    return readUiPreferencesFile();
  });

  ipcMain.handle("desktop:save-ui-preferences", async (_, prefs: unknown) => {
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
      throw new Error("prefs must be a plain object");
    }
    const stringPrefs = Object.fromEntries(
      Object.entries(prefs as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
    writeUiPreferencesFile(stringPrefs);
  });

  ipcMain.handle("desktop:pty-status", async () => ({
    available: isPtyAvailable(),
    reason: ptyUnavailableReason(),
  }));

  ipcMain.handle(
    "desktop:pty-open",
    async (event, opts: { cwd?: string; cols?: number; rows?: number }) => {
      return openPty(event.sender, opts ?? {});
    },
  );

  ipcMain.handle("desktop:pty-write", async (_, id: string, data: string) => {
    if (typeof id !== "string" || typeof data !== "string") return;
    writePty(id, data);
  });

  ipcMain.handle("desktop:pty-resize", async (_, id: string, cols: number, rows: number) => {
    if (typeof id !== "string") return;
    resizePty(id, Number(cols), Number(rows));
  });

  ipcMain.handle("desktop:pty-close", async (_, id: string) => {
    if (typeof id !== "string") return;
    closePty(id);
  });
}

async function shutdown(): Promise<void> {
  if (appState === "stopping") return;
  appState = "stopping";
  killAllPtys();
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

  app.on("render-process-gone", (_event, webContents, details) => {
    void processMemorySummary().then((memory) => {
      log.error(
        [
          "App render-process-gone",
          `reason=${details.reason}`,
          `exitCode=${details.exitCode}`,
          `url=${webContents.getURL()}`,
          `appVersion=${app.getVersion()}`,
          memory,
        ].join(" "),
      );
    });
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

function uiPreferencesFilePath(): string {
  return path.join(app.getPath("userData"), "ui-preferences.json");
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
  writeJsonFile(filePath, prefs);
}

function readUiPreferencesFile(): Record<string, string> {
  const filePath = uiPreferencesFilePath();
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeUiPreferencesFile(prefs: Record<string, string>): void {
  const filePath = uiPreferencesFilePath();
  writeJsonFile(filePath, prefs);
}

function writeJsonFile(filePath: string, payload: Record<string, unknown>): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, "utf8");
  renameSync(tempPath, filePath);
}
