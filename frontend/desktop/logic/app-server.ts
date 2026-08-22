import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveStandaloneBaseDir, resolveStaticAssetsSource } from "../configs";
import type { DesktopServerRuntime } from "../types";
import { log } from "../helpers/logger";
import { registerOAuthVault } from "./oauth-vault";
import { resolveStablePort } from "../helpers/ports";
import {
  delay,
  forkChild,
  isProcessAlive,
  isSupervised,
  stopChild,
  waitUntilReady,
} from "./child-supervisor";
import {
  startOrReuseAgentRuntime,
  stopAgentRuntime,
  type AgentRuntimeHandle,
} from "./agent-runtime-server";

interface ServerHandle {
  agentRuntimeExitListener?: () => void;
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
  agentRuntime?: AgentRuntimeHandle;
  port?: number;
  onExit?: (details: ServerExitDetails) => void;
};

type StopFrontendServerOptions = {
  stopAgentRuntime?: boolean;
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

async function isFrontendServing(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.ok || response.status === 307 || response.status === 308;
  } catch {
    return false;
  }
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
    const agentRuntime = await startOrReuseAgentRuntime(
      { frontendUrl: runtime.url, preferredPort: 8081 },
      options.agentRuntime,
    );
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
  const agentRuntime = await startOrReuseAgentRuntime({ frontendUrl: url }, options.agentRuntime);

  log.info(`Starting embedded frontend server from ${serverScript} on ${url}`);

  const child = forkChild({
    label: "frontend",
    entry: serverScript,
    cwd: serverRoot,
    // Electron's bundled Node/undici races IPv4/IPv6 with a 250ms per-attempt
    // connect timeout. On hosts with broken IPv6 (or slow Cloudflare-fronted
    // backends that need ~1s to connect), every outbound fetch from the embedded
    // server aborts with ETIMEDOUT, surfacing as 500/502 from the proxy. Give the
    // family-autoselection enough time to fall back to a working address.
    execArgv: ["--network-family-autoselection-attempt-timeout=2000"],
    env: {
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_STUDIO_DESKTOP: "1",
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      LOCAL_STUDIO_PROJECTS_FILE: path.join(DESKTOP_CONFIG.userDataDir, "projects.json"),
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      LOCAL_STUDIO_AGENT_RUNTIME_URL: agentRuntime.url,
      LOCAL_STUDIO_FRONTEND_BASE: url,
    },
  });

  registerOAuthVault(child, DESKTOP_CONFIG.userDataDir);

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

  const agentRuntimeExitListener = () => {
    if (isSupervised(child) && !child.killed) child.kill("SIGTERM");
  };
  agentRuntime.process?.once("exit", agentRuntimeExitListener);

  try {
    await waitUntilReady({
      child,
      isReady: () => isFrontendServing(url),
      timeoutMs: DESKTOP_CONFIG.startupTimeoutMs,
      intervalMs: 300,
      label: `embedded frontend server: ${url}`,
    });
  } catch (error) {
    await stopFrontendServer(
      {
        agentRuntime,
        agentRuntimeExitListener,
        process: child,
        runtime: { mode: "embedded-standalone", port, url },
      },
      { stopAgentRuntime: agentRuntime !== options.agentRuntime },
    );
    throw error;
  }

  return {
    agentRuntime,
    agentRuntimeExitListener,
    runtime: {
      mode: "embedded-standalone",
      port,
      url,
    },
    process: child,
  };
}

export async function stopFrontendServer(
  handle?: ServerHandle,
  options: StopFrontendServerOptions = {},
): Promise<void> {
  if (!handle) return;
  if (handle.agentRuntimeExitListener) {
    handle.agentRuntime.process?.off("exit", handle.agentRuntimeExitListener);
  }
  if (handle.process) {
    const child = handle.process;
    try {
      if (readFileSync(embeddedServerPidPath(), "utf8") === String(child.pid ?? "")) {
        rmSync(embeddedServerPidPath(), { force: true });
      }
    } catch {}
    await stopChild(child);
  }
  if (options.stopAgentRuntime !== false) await stopAgentRuntime(handle.agentRuntime);
}

export type { ServerHandle };
