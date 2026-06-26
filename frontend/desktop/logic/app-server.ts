import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveStandaloneBaseDir, resolveStaticAssetsSource } from "../configs";
import type { DesktopServerRuntime } from "../types";
import { log } from "../helpers/logger";
import { resolveStablePort } from "../helpers/ports";
import { resolveAugmentedPath } from "../helpers/resolve-path";

interface ServerHandle {
  runtime: DesktopServerRuntime;
  process?: ChildProcess;
}

type ServerExitDetails = {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
};

type StartFrontendServerOptions = {
  port?: number;
  onExit?: (details: ServerExitDetails) => void;
};

function embeddedServerPidPath(): string {
  return path.join(DESKTOP_CONFIG.userDataDir, "embedded-frontend.pid");
}

function embeddedServerPortPath(): string {
  return path.join(DESKTOP_CONFIG.userDataDir, "embedded-frontend.port");
}

/**
 * The embedded server's origin (http://127.0.0.1:<port>) is the storage key for
 * all renderer state (selected controller, API key, sessions). Persisting the
 * port keeps that origin stable across launches and restarts so state survives.
 */
function readPersistedPort(): number | undefined {
  try {
    const raw = readFileSync(embeddedServerPortPath(), "utf8").trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 1024 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

function persistPort(port: number): void {
  try {
    mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
    writeFileSync(embeddedServerPortPath(), String(port));
  } catch {
    // Non-fatal: a fresh port will be chosen next launch.
  }
}

function writeEmbeddedServerPid(pid: number | undefined): void {
  mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
  writeFileSync(embeddedServerPidPath(), String(pid ?? ""));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killStaleEmbeddedServer(): Promise<void> {
  const pidFile = embeddedServerPidPath();
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_500 && isProcessAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function resolveStandaloneServerRoot(): string {
  const standaloneBase = resolveStandaloneBaseDir();
  const nestedRoot = path.join(standaloneBase, "frontend");
  if (existsSync(path.join(nestedRoot, "server.js"))) {
    return nestedRoot;
  }
  return standaloneBase;
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`Missing source directory: ${source}`);
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok || response.status === 307 || response.status === 308) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for embedded frontend server: ${url}`);
}

export async function startFrontendServer(
  options: StartFrontendServerOptions = {},
): Promise<ServerHandle> {
  if (process.env.LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL) {
    const runtime: DesktopServerRuntime = {
      mode: "dev-server",
      port: Number(new URL(DESKTOP_CONFIG.devServerUrl).port || "3000"),
      url: DESKTOP_CONFIG.devServerUrl,
    };
    return { runtime };
  }

  await killStaleEmbeddedServer();

  const serverRoot = resolveStandaloneServerRoot();
  const serverScript = path.join(serverRoot, "server.js");

  if (!existsSync(serverScript)) {
    throw new Error(`Missing standalone server build: ${serverScript}. Run npm run build first.`);
  }

  const { staticDir, publicDir } = resolveStaticAssetsSource();
  const targetStaticDir = path.join(serverRoot, ".next", "static");
  const targetPublicDir = path.join(serverRoot, "public");

  if (app.isPackaged) {
    if (!existsSync(targetStaticDir)) {
      throw new Error(`Missing packaged static assets: ${targetStaticDir}`);
    }
    if (!existsSync(targetPublicDir)) {
      throw new Error(`Missing packaged public assets: ${targetPublicDir}`);
    }
  } else {
    copyDirectory(staticDir, targetStaticDir);
    copyDirectory(publicDir, targetPublicDir);
  }

  const port = await resolveStablePort(options.port ?? readPersistedPort());
  persistPort(port);
  const url = `http://127.0.0.1:${port}`;

  log.info(`Starting embedded frontend server from ${serverScript} on ${url}`);

  const child = fork(serverScript, {
    cwd: serverRoot,
    stdio: "pipe",
    // Electron's bundled Node/undici races IPv4/IPv6 with a 250ms per-attempt
    // connect timeout. On hosts with broken IPv6 (or slow Cloudflare-fronted
    // backends that need ~1s to connect), every outbound fetch from the embedded
    // server aborts with ETIMEDOUT, surfacing as 500/502 from the proxy. Give the
    // family-autoselection enough time to fall back to a working address.
    execArgv: ["--network-family-autoselection-attempt-timeout=2000"],
    // Keep the embedded Next server attached to Electron. A detached child can
    // survive a main-process exit with closed stdio pipes and spin while the
    // desktop app itself is gone.
    detached: false,
    env: {
      ...process.env,
      // Restore the user's real login-shell PATH. A Finder/Dock/`open`-launched
      // app inherits a stripped PATH, so MCP servers spawned by the agent (e.g.
      // `npx -y <server>`) would otherwise fail with ENOENT and the model would
      // silently fall back to shell commands instead of the plugin's tools.
      PATH: resolveAugmentedPath(),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      // In packaged Electron, process.cwd() is "/" — pi-runtime.resolveDefaultAgentCwd
      // does the right thing (prefers the most-recently-added project, falls back
      // to $HOME) when this env is empty, so leave it unset unless the operator
      // explicitly supplied one.
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      // Expose the embedded server's own URL so the pi browser extension can
      // call back into /api/agent/browser/*.
      LOCAL_STUDIO_FRONTEND_BASE: url,
    },
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    log.info(`frontend: ${String(chunk).trim()}`);
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    log.warn(`frontend: ${String(chunk).trim()}`);
  });

  writeEmbeddedServerPid(child.pid);

  child.once("exit", (code, signal) => {
    try {
      if (readFileSync(embeddedServerPidPath(), "utf8") === String(child.pid ?? "")) {
        rmSync(embeddedServerPidPath(), { force: true });
      }
    } catch {
      // pid file already gone
    }
    log.warn(`Embedded frontend exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    options.onExit?.({ code, signal, pid: child.pid });
  });

  process.once("exit", () => {
    if (!child.killed) child.kill("SIGTERM");
  });

  await waitForServer(url, DESKTOP_CONFIG.startupTimeoutMs);

  return {
    runtime: {
      mode: "embedded-standalone",
      port,
      url,
    },
    process: child,
  };
}

export async function stopFrontendServer(handle?: ServerHandle): Promise<void> {
  if (!handle?.process) return;

  const child = handle.process;
  const pid = child.pid;
  try {
    if (readFileSync(embeddedServerPidPath(), "utf8") === String(child.pid ?? "")) {
      rmSync(embeddedServerPidPath(), { force: true });
    }
  } catch {
    // pid file already gone
  }
  child.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (pid && isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      resolve();
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export type { ServerHandle };
