const { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const HOME = require("node:os").homedir();
process.env.PATH = [...new Set([...(process.env.PATH || "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", path.join(HOME, ".local/bin"), path.join(HOME, ".bun/bin")])].filter(Boolean).join(":");

const PORT = Number(process.env.LOCAL_STUDIO_PORT || 8080);
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;
let win = null;
let quitting = false;
let backoff = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isLocalStudio() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.service === "local-studio";
  } catch {
    return false;
  }
}

function binaryPath() {
  if (process.env.LOCAL_STUDIO_BIN) return process.env.LOCAL_STUDIO_BIN;
  return path.join(process.resourcesPath, "local-studio", "local-studio");
}

function spawnController() {
  const bin = binaryPath();
  if (!fs.existsSync(bin)) throw new Error(`bundled controller not found at ${bin}`);
  const logPath = path.join(app.getPath("userData"), "controller.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, "a");
  const proc = spawn(bin, ["serve", "--host", "127.0.0.1", "--port", String(PORT), "--tailnet"], {
    stdio: ["ignore", fd, fd],
    env: { ...process.env, LOCAL_STUDIO_UI_DIR: process.env.LOCAL_STUDIO_UI_DIR || path.join(path.dirname(bin), "ui") },
  });
  fs.closeSync(fd);
  const born = Date.now();
  proc.on("exit", () => {
    if (child !== proc) return;
    child = null;
    if (quitting) return;
    if (Date.now() - born > 60_000) backoff = 1000;
    const wait = backoff;
    backoff = Math.min(backoff * 2, 30_000);
    setTimeout(async () => {
      if (quitting || child || (await isLocalStudio())) return;
      try {
        child = spawnController();
      } catch {}
    }, wait);
  });
  return proc;
}

async function ensureController() {
  if (await isLocalStudio()) return;
  child = spawnController();
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await isLocalStudio()) return;
    if (!child) break;
  }
  throw new Error(`controller did not answer ${BASE}/health; see ${path.join(app.getPath("userData"), "controller.log")}`);
}

function openOutside(url) {
  try {
    if (["http:", "https:"].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {}
}

function isInternal(url) {
  try {
    return new URL(url).origin === new URL(BASE).origin;
  } catch {
    return false;
  }
}

function openWindow(url) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: area.width,
    height: area.height,
    minWidth: 360,
    fullscreenable: true,
    backgroundColor: "#000000",
    title: "Local Studio",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isInternal(target)) openOutside(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!isInternal(target)) {
      event.preventDefault();
      openOutside(target);
    }
  });
  let hung = null;
  win.on("unresponsive", () => {
    clearTimeout(hung);
    hung = setTimeout(() => win && win.webContents.forcefullyCrashRenderer(), 10_000);
  });
  win.on("responsive", () => clearTimeout(hung));
  win.webContents.on("render-process-gone", (_e, d) => {
    if (d.reason !== "clean-exit") setTimeout(() => win && !win.isDestroyed() && win.reload(), 500);
  });
  win.on("closed", () => {
    clearTimeout(hung);
    win = null;
  });
  win.loadURL(url);
}

function openPairing() {
  const w = new BrowserWindow({ width: 380, height: 440, backgroundColor: "#000000", title: "Phone", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  w.setMenuBarVisibility(false);
  w.loadURL(`${BASE}/pair`);
}

function errorPage(message) {
  const html = `<!doctype html><meta charset="utf-8"><title>Local Studio</title><body style="background:#000;color:#d4d4d4;font:13px ui-monospace,monospace;padding:24px"><p>LOCAL STUDIO</p><p>${message.replace(/[<>&]/g, "")}</p></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function stopChild(done) {
  const proc = child;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return done();
  const timer = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }, 3000);
  proc.once("exit", () => {
    clearTimeout(timer);
    child = null;
    done();
  });
  proc.kill("SIGTERM");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  ipcMain.handle("pick-folder", async (e) => {
    if (!isInternal(e.senderFrame.url)) return null;
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0] || null;
  });

  app.whenReady().then(async () => {
    try {
      await ensureController();
      const menu = Menu.getApplicationMenu();
      if (menu) {
        menu.append(new MenuItem({ label: "Phone", submenu: [{ label: "Sign In on Phone", accelerator: "CmdOrCtrl+Shift+P", click: openPairing }] }));
        Menu.setApplicationMenu(menu);
      }
      openWindow(`${BASE}/`);
    } catch (e) {
      openWindow(errorPage(String(e && e.message ? e.message : e)));
    }
  });

  app.on("activate", () => {
    if (!win && app.isReady()) openWindow(`${BASE}/`);
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    const was = quitting;
    quitting = true;
    if (was || !child) return;
    event.preventDefault();
    stopChild(() => app.quit());
  });

  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());
}
