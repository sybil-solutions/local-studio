import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveStandaloneBaseDir, resolveStaticAssetsSource } from "../configs";
import type { DesktopServerRuntime } from "../types";
import { log } from "../helpers/logger";
import { registerOAuthVault } from "./oauth-vault";
import { resolveStablePort } from "../helpers/ports";
import { resolveAugmentedPath } from "../helpers/resolve-path";
import {
  startAgentRuntime,
  stopAgentRuntime,
  type AgentRuntimeHandle,
} from "./agent-runtime-server";

// The most recently forked embedded server. A single process-exit hook kills
// whichever child is current — registering a fresh once("exit") per (re)start
// leaked listeners on every frontend restart.
let currentEmbeddedServer: ChildProcess | null = null;
process.once("exit", () => {
  if (currentEmbeddedServer && !currentEmbeddedServer.killed) {
    currentEmbeddedServer.kill("SIGTERM");
  }
});

interface ServerHandle {
  agentRuntime: AgentRuntimeHandle;
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
  try {
    mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
    writeFileSync(embeddedServerPidPath(), String(pid ?? ""));
  } catch {
    // Non-fatal: stale-pid cleanup just won't find a file next launch. The
    // server is already running; failing here would orphan it.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function killStaleEmbeddedServer(): Promise<void> {
  const pidFile = embeddedServerPidPath();
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !isProcessAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_500 && isProcessAlive(pid)) {
    await delay(100);
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
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
    } catch {}
    await delay(300);
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
    const agentRuntime = await startAgentRuntime({ frontendUrl: runtime.url, preferredPort: 8081 });
    return { agentRuntime, runtime };
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
  const agentRuntime = await startAgentRuntime({ frontendUrl: url });

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
      PATH: resolveAugmentedPath(),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_STUDIO_DESKTOP: "1",
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      LOCAL_STUDIO_AGENT_RUNTIME_URL: agentRuntime.url,
      LOCAL_STUDIO_FRONTEND_BASE: url,
    },
  });

  registerOAuthVault(child, DESKTOP_CONFIG.userDataDir);

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

  agentRuntime.process?.once("exit", () => {
    if (currentEmbeddedServer === child && !child.killed) child.kill("SIGTERM");
  });

  currentEmbeddedServer = child;

  try {
    await waitForServer(url, DESKTOP_CONFIG.startupTimeoutMs);
  } catch (error) {
    await stopFrontendServer({
      agentRuntime,
      process: child,
      runtime: { mode: "embedded-standalone", port, url },
    });
    throw error;
  }

  return {
    agentRuntime,
    runtime: {
      mode: "embedded-standalone",
      port,
      url,
    },
    process: child,
  };
}

export async function stopFrontendServer(handle?: ServerHandle): Promise<void> {
  if (!handle) return;
  if (handle.process) {
    const child = handle.process;
    const pid = child.pid;
    try {
      if (readFileSync(embeddedServerPidPath(), "utf8") === String(child.pid ?? "")) {
        rmSync(embeddedServerPidPath(), { force: true });
      }
    } catch {}
    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (pid && isProcessAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
        resolve();
      }, 5_000);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await stopAgentRuntime(handle.agentRuntime);
}

export type { ServerHandle };
