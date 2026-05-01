import { app } from "electron";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveStandaloneBaseDir, resolveStaticAssetsSource } from "../configs";
import type { DesktopServerRuntime } from "../types";
import { log } from "../helpers/logger";
import { allocatePort } from "../helpers/ports";

interface ServerHandle {
  runtime: DesktopServerRuntime;
  process?: ChildProcess;
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

export async function startFrontendServer(): Promise<ServerHandle> {
  if (process.env.VLLM_STUDIO_DESKTOP_DEV_SERVER_URL) {
    const runtime: DesktopServerRuntime = {
      mode: "dev-server",
      port: Number(new URL(DESKTOP_CONFIG.devServerUrl).port || "3000"),
      url: DESKTOP_CONFIG.devServerUrl,
    };
    return { runtime };
  }

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

  const port = await allocatePort();
  const url = `http://127.0.0.1:${port}`;

  log.info(`Starting embedded frontend server from ${serverScript} on ${url}`);

  const child = fork(serverScript, {
    cwd: serverRoot,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      VLLM_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      // In packaged Electron, process.cwd() is "/" — pi-runtime.resolveDefaultAgentCwd
      // does the right thing (prefers the most-recently-added project, falls back
      // to $HOME) when this env is empty, so leave it unset unless the operator
      // explicitly supplied one.
      VLLM_STUDIO_AGENT_CWD: process.env.VLLM_STUDIO_AGENT_CWD || app.getPath("home"),
      // Expose the embedded server's own URL so the pi browser extension can
      // call back into /api/agent/browser/*.
      VLLM_STUDIO_FRONTEND_BASE: url,
    },
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    log.info(`frontend: ${String(chunk).trim()}`);
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    log.warn(`frontend: ${String(chunk).trim()}`);
  });

  child.once("exit", (code, signal) => {
    log.warn(`Embedded frontend exited code=${code ?? "null"} signal=${signal ?? "null"}`);
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
  if (!handle?.process || handle.process.killed) return;

  const child = handle.process;
  child.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      resolve();
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export type { ServerHandle };
