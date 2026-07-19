import "./app-identity";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import type { DesktopAppState } from "./types";
import { DESKTOP_CONFIG } from "./configs";
import { writeJsonAtomic } from "./helpers/fs-json";
import { log } from "./helpers/logger";
import { isHttpUrl } from "./helpers/url";
import { createMainWindow } from "./logic/window-manager";
import { registerNavigationPolicy } from "./logic/security";
import { startFrontendServer, stopFrontendServer, type ServerHandle } from "./logic/app-server";
import { checkForUpdates, getUpdateState, initializeAutoUpdates } from "./logic/update-manager";
import { addProject, listProjectsWithMeta, removeProject } from "./logic/projects-store";
import { deployController } from "./logic/controller-deploy";
import {
  hideQuickPanel,
  getQuickPanelWindow,
  resetQuickPanel,
  resizeQuickPanelToHome,
  resizeQuickPanelToThread,
  toggleQuickPanel,
} from "./logic/quick-panel-window";
import { getStoredQuickPanelHotkey, setStoredQuickPanelHotkey } from "./logic/desktop-settings";
import {
  closePty,
  closePtyByOwner,
  isPtyAvailable,
  killAllPtys,
  openPty,
  ptyUnavailableReason,
  resizePty,
  writePty,
} from "./logic/pty-manager";
import {
  decodeConnectorApprovalDecisionBridgeInput,
  decodeConnectorApprovalListBridgeInput,
  decodeConnectorListBridgeInput,
  decodeConnectorProbeBridgeInput,
  decodeConnectorRemoveBridgeInput,
  decodeConnectorSaveBridgeInput,
  decodeGoogleAccountGetBridgeInput,
  decodeGoogleAccountOperationBridgeInput,
  decodeGoogleClientSaveBridgeInput,
  decodeGitHubArtifactInstallBridgeInput,
  decodeGitHubArtifactStatusBridgeInput,
  decodePluginListBridgeInput,
  decodePluginSetEnabledBridgeInput,
} from "./logic/connector-approval-ipc-contract";
import {
  allowsConnectorApprovalSender,
  allowsConnectorManagementSender,
} from "./logic/connector-approval-ipc-sender";
import { rendererNavigationGeneration } from "./logic/renderer-navigation-generation";

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

async function processMemorySummary(): Promise<string> {
  try {
    return `memory=${JSON.stringify(await process.getProcessMemoryInfo())}`;
  } catch {
    return "memory=unavailable";
  }
}

async function bootstrap(): Promise<void> {
  if (!frontendServer) {
    frontendServer = await startFrontendServer({ onExit: handleFrontendServerExit });
    registerNavigationPolicy(new URL(frontendServer.runtime.url).origin);
    startFrontendHealthMonitor();
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

function stopFrontendHealthMonitor(): void {
  if (!frontendHealthTimer) return;
  clearInterval(frontendHealthTimer);
  frontendHealthTimer = undefined;
  frontendHealthFailures = 0;
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
  frontendHealthFailures = 0;
  log.error(`Embedded frontend health check failed; restarting ${stalledServer.runtime.url}`);
  const pid = stalledServer.process?.pid;
  if (pid) {
    expectedFrontendStopPids.add(pid);
    setTimeout(() => expectedFrontendStopPids.delete(pid), 30_000);
  }
  await stopFrontendServer(stalledServer);
  if (frontendServer === stalledServer) frontendServer = undefined;
  await restartFrontendServer(stalledServer.runtime.port);
}

function handleFrontendServerExit(details: {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
}) {
  if (appState === "stopping") return;
  if (details.pid && expectedFrontendStopPids.delete(details.pid)) return;
  if (frontendServer?.process && frontendServer.process.pid !== details.pid) return;

  const previousRuntime = frontendServer?.runtime;
  frontendServer = undefined;
  log.error(
    `Embedded frontend stopped unexpectedly code=${details.code ?? "null"} signal=${details.signal ?? "null"}`,
  );
  void restartFrontendServer(previousRuntime?.port);
}

async function restartFrontendServer(port?: number): Promise<void> {
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
    const started = await startFrontendServer({ port, onExit: handleFrontendServerExit });
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
      await mainWindow.loadURL(nextUrl);
    } else {
      mainWindow = createMainWindow(nextUrl);
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
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

type TrustedConnectorPin = {
  server: ServerHandle;
  client: NonNullable<ServerHandle["connectorApprovals"]>;
  senderWindow: BrowserWindow;
  senderFrame: NonNullable<IpcMainInvokeEvent["senderFrame"]>;
  senderUrl: string;
  navigationGeneration: number;
  allowQuickPanel: boolean;
};

function isTrustedConnectorEvent(event: IpcMainInvokeEvent, allowQuickPanel: boolean): boolean {
  if (!frontendServer) return false;
  const senderFrame = event.senderFrame;
  if (!senderFrame) return false;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const input = {
    currentFrontendUrl: frontendServer.runtime.url,
    mainWindow,
    quickPanelWindow: getQuickPanelWindow(),
    senderWindow,
    senderFrame,
    mainFrame: event.sender.mainFrame,
    senderUrl: senderFrame.url,
    senderDestroyed: event.sender.isDestroyed(),
    senderWindowDestroyed: senderWindow?.isDestroyed() ?? true,
  };
  return allowQuickPanel
    ? allowsConnectorApprovalSender(input)
    : allowsConnectorManagementSender(input);
}

function trustedConnectorPin(
  event: IpcMainInvokeEvent,
  allowQuickPanel: boolean,
): TrustedConnectorPin {
  const server = frontendServer;
  const client = server?.connectorApprovals;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const senderFrame = event.senderFrame;
  if (!server || !client || !senderWindow || !senderFrame) {
    throw new Error("Private connector transport is unavailable");
  }
  if (!isTrustedConnectorEvent(event, allowQuickPanel)) {
    throw new Error("Private connector sender is unavailable");
  }
  return {
    server,
    client,
    senderWindow,
    senderFrame,
    senderUrl: senderFrame.url,
    navigationGeneration: rendererNavigationGeneration(event.sender),
    allowQuickPanel,
  };
}

function connectorPinIsCurrent(event: IpcMainInvokeEvent, pin: TrustedConnectorPin): boolean {
  return (
    frontendServer === pin.server &&
    frontendServer.connectorApprovals === pin.client &&
    BrowserWindow.fromWebContents(event.sender) === pin.senderWindow &&
    event.senderFrame === pin.senderFrame &&
    event.sender.mainFrame === pin.senderFrame &&
    pin.senderFrame.url === pin.senderUrl &&
    rendererNavigationGeneration(event.sender) === pin.navigationGeneration &&
    isTrustedConnectorEvent(event, pin.allowQuickPanel)
  );
}

async function runPinnedConnectorEffect<A>(
  event: IpcMainInvokeEvent,
  pin: TrustedConnectorPin,
  effect: Effect.Effect<A, unknown>,
): Promise<A> {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  const abortNavigation = (
    _event: Electron.Event,
    _url: string,
    _inPlace: boolean,
    main: boolean,
  ) => {
    if (main) abort();
  };
  event.sender.once("destroyed", abort);
  event.sender.on("did-start-navigation", abortNavigation);
  try {
    const result = await Effect.runPromise(effect, { signal: abortController.signal });
    if (!connectorPinIsCurrent(event, pin)) throw new Error("Private connector sender changed");
    return result;
  } finally {
    event.sender.off("destroyed", abort);
    event.sender.off("did-start-navigation", abortNavigation);
  }
}

async function runConnectorRequest<A>(
  event: IpcMainInvokeEvent,
  allowQuickPanel: boolean,
  request: (client: TrustedConnectorPin["client"]) => Effect.Effect<A, unknown>,
): Promise<A> {
  const pin = trustedConnectorPin(event, allowQuickPanel);
  return runPinnedConnectorEffect(event, pin, request(pin.client));
}

async function decideConnectorApproval(
  event: IpcMainInvokeEvent,
  requestId: string,
  decision: "approve" | "deny",
): Promise<void> {
  const pin = trustedConnectorPin(event, true);
  const transactionId = randomUUID();
  let released = false;
  try {
    await runPinnedConnectorEffect(
      event,
      pin,
      pin.client.prepareDecision(transactionId, requestId, decision),
    );
    await runPinnedConnectorEffect(event, pin, pin.client.armDecision(transactionId));
    if (!connectorPinIsCurrent(event, pin)) throw new Error("Private connector sender changed");
    await Effect.runPromise(pin.client.commitDecision(transactionId));
    released = true;
  } finally {
    if (!released) {
      await Effect.runPromise(
        pin.client.cancelDecision(transactionId).pipe(Effect.catch(() => Effect.void)),
      );
    }
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-runtime", async () => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    chromeVersion: process.versions.chrome,
    electronVersion: process.versions.electron,
    mode: frontendServer?.runtime.mode,
  }));

  ipcMain.handle("desktop:connector-approvals:list", async (event, input: unknown) => {
    decodeConnectorApprovalListBridgeInput(input);
    return runConnectorRequest(event, true, (client) => client.list());
  });

  ipcMain.handle("desktop:connector-approvals:decide", async (event, input: unknown) => {
    const decision = decodeConnectorApprovalDecisionBridgeInput(input);
    await decideConnectorApproval(event, decision.request_id, decision.decision);
  });

  ipcMain.handle("desktop:connectors:list", async (event, input: unknown) => {
    decodeConnectorListBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.listConnectors());
  });

  ipcMain.handle("desktop:connectors:save", async (event, input: unknown) => {
    const payload = decodeConnectorSaveBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.saveConnector(payload));
  });

  ipcMain.handle("desktop:connectors:remove", async (event, input: unknown) => {
    const { id } = decodeConnectorRemoveBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.removeConnector(id));
  });

  ipcMain.handle("desktop:connectors:probe", async (event, input: unknown) => {
    const { id } = decodeConnectorProbeBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.probeConnector(id));
  });

  ipcMain.handle("desktop:plugins:list", async (event, input: unknown) => {
    decodePluginListBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.listPlugins());
  });

  ipcMain.handle("desktop:plugins:set-enabled", async (event, input: unknown) => {
    const { id, enabled } = decodePluginSetEnabledBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.setPluginEnabled(id, enabled));
  });

  ipcMain.handle("desktop:github-artifact:status", async (event, input: unknown) => {
    decodeGitHubArtifactStatusBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.githubArtifactStatus());
  });

  ipcMain.handle("desktop:github-artifact:install", async (event, input: unknown) => {
    decodeGitHubArtifactInstallBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.installGitHubArtifact());
  });

  ipcMain.handle("desktop:google-account:get", async (event, input: unknown) => {
    decodeGoogleAccountGetBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.getGoogleAccount());
  });

  ipcMain.handle("desktop:google-account:save-client", async (event, input: unknown) => {
    const payload = decodeGoogleClientSaveBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.saveGoogleClient(payload));
  });

  ipcMain.handle("desktop:google-account:disconnect", async (event, input: unknown) => {
    const { account } = decodeGoogleAccountOperationBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.disconnectGoogleAccount(account));
  });

  ipcMain.handle("desktop:google-account:begin-authorization", async (event, input: unknown) => {
    const { account } = decodeGoogleAccountOperationBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.beginGoogleAuthorization(account));
  });

  ipcMain.handle("desktop:google-account:cancel-authorization", async (event, input: unknown) => {
    const { account } = decodeGoogleAccountOperationBridgeInput(input);
    return runConnectorRequest(event, false, (client) => client.cancelGoogleAuthorization(account));
  });

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
    async (event, opts: { cwd?: string; cols?: number; rows?: number; ownerKey?: string }) => {
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

  ipcMain.handle("desktop:pty-close-owner", async (_, ownerKey: string) => {
    if (typeof ownerKey !== "string") return;
    closePtyByOwner(ownerKey);
  });

  ipcMain.handle("desktop:quick-panel-expand", async () => {
    resizeQuickPanelToThread();
  });

  ipcMain.handle("desktop:quick-panel-dismiss", async () => {
    hideQuickPanel();
    resizeQuickPanelToHome();
    resetQuickPanel();
  });

  ipcMain.handle("desktop:quick-panel-get-hotkey", async () => ({
    hotkey: quickPanelHotkey ?? getStoredQuickPanelHotkey() ?? DESKTOP_CONFIG.quickPanel.hotkey,
    defaultHotkey: DESKTOP_CONFIG.quickPanel.hotkey,
  }));

  ipcMain.handle("desktop:quick-panel-set-hotkey", async (_, hotkey: unknown) =>
    setQuickPanelHotkey(hotkey),
  );

  ipcMain.handle(
    "desktop:focus-main-and-navigate",
    async (_, projectId: string, sessionId?: string) => {
      if (typeof projectId !== "string" || !frontendServer) return;
      const query =
        typeof sessionId === "string" && sessionId
          ? `?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(sessionId)}`
          : `?project=${encodeURIComponent(projectId)}&new=1`;
      const targetUrl = `${frontendServer.runtime.url}/agent${query}`;
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(targetUrl);
      } else {
        mainWindow = createMainWindow(targetUrl);
        mainWindow.on("closed", () => {
          mainWindow = null;
        });
      }
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      hideQuickPanel();
      resizeQuickPanelToHome();
      // The thread now lives in the main window; next quick-panel open starts fresh.
      resetQuickPanel();
    },
  );
}

let quickPanelHotkey: string | null = null;

function onQuickPanelHotkey(): void {
  if (!frontendServer) return;
  toggleQuickPanel(frontendServer.runtime.url);
}

function registerQuickPanelHotkey(): void {
  const accelerator = getStoredQuickPanelHotkey() ?? DESKTOP_CONFIG.quickPanel.hotkey;
  if (globalShortcut.register(accelerator, onQuickPanelHotkey)) {
    quickPanelHotkey = accelerator;
    return;
  }
  log.warn(`Failed to register quick panel hotkey: ${accelerator}`);
  // A stored hotkey can become unregisterable (claimed by another app, or a
  // stale/invalid accelerator). Fall back to the default so the panel keeps
  // a working hotkey instead of silently having none.
  const fallback = DESKTOP_CONFIG.quickPanel.hotkey;
  if (accelerator !== fallback && globalShortcut.register(fallback, onQuickPanelHotkey)) {
    quickPanelHotkey = fallback;
  }
}

function setQuickPanelHotkey(hotkey: unknown): { ok: boolean; hotkey: string; error?: string } {
  const current = quickPanelHotkey ?? DESKTOP_CONFIG.quickPanel.hotkey;
  if (typeof hotkey !== "string" || !hotkey.trim()) {
    return { ok: false, hotkey: current, error: "Hotkey must be a non-empty string" };
  }
  const next = hotkey.trim();
  if (next === quickPanelHotkey) {
    setStoredQuickPanelHotkey(next);
    return { ok: true, hotkey: next };
  }

  let registered = false;
  try {
    registered = globalShortcut.register(next, onQuickPanelHotkey);
  } catch {
    registered = false; // invalid accelerator strings throw
  }
  if (!registered) {
    return {
      ok: false,
      hotkey: current,
      error: `Could not register "${next}" — it may be invalid or already in use by another app`,
    };
  }

  if (quickPanelHotkey && quickPanelHotkey !== next) {
    try {
      globalShortcut.unregister(quickPanelHotkey);
    } catch {
      // best effort; unregisterAll on quit still cleans up
    }
  }
  quickPanelHotkey = next;
  setStoredQuickPanelHotkey(next);
  log.info(`Quick panel hotkey set to ${next}`);
  return { ok: true, hotkey: next };
}

async function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    appState = "stopping";
    stopFrontendHealthMonitor();
    globalShortcut.unregisterAll();
    killAllPtys();
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
    registerQuickPanelHotkey();
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
  writeJsonAtomic(sessionPrefsFilePath(), prefs);
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
  writeJsonAtomic(uiPreferencesFilePath(), prefs);
}
