const { app, BrowserWindow, Menu, MenuItem, screen, shell } = require("electron");
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
  proc.on("exit", () => {
    if (child === proc) child = null;
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isInternal(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!isInternal(target)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });
  win.on("closed", () => {
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
    if (quitting || !child) return;
    event.preventDefault();
    quitting = true;
    stopChild(() => app.quit());
  });

  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());
}
