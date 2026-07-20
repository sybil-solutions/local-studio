import { app } from "electron";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG } from "../configs";
import { log } from "../helpers/logger";
import { resolveStablePort } from "../helpers/ports";
import { resolveAugmentedPath } from "../helpers/resolve-path";

export type AgentRuntimeHandle = {
  process?: ChildProcess;
  url: string;
};

type StartAgentRuntimeOptions = {
  frontendUrl: string;
  preferredPort?: number;
};

let currentAgentRuntime: ChildProcess | null = null;

process.once("exit", () => {
  if (currentAgentRuntime && !currentAgentRuntime.killed) {
    currentAgentRuntime.kill("SIGTERM");
  }
});

function agentRuntimeEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "agent-runtime", "server.mjs")
    : path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "services",
        "agent-runtime",
        "dist",
        "standalone.mjs",
      );
}

async function isAgentRuntimeHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const payload = (await response.json()) as { service?: unknown };
    return payload.service === "local-studio-agent-runtime";
  } catch {
    return false;
  }
}

async function waitForAgentRuntime(
  child: ChildProcess,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Agent runtime exited with code ${child.exitCode}`);
    }
    if (await isAgentRuntimeHealthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for agent runtime: ${url}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const pid = child.pid;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (pid) {
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

export async function startAgentRuntime(
  options: StartAgentRuntimeOptions,
): Promise<AgentRuntimeHandle> {
  const preferredUrl = options.preferredPort ? `http://127.0.0.1:${options.preferredPort}` : null;
  if (preferredUrl && (await isAgentRuntimeHealthy(preferredUrl))) {
    log.info(`Using agent runtime at ${preferredUrl}`);
    return { url: preferredUrl };
  }

  const entry = agentRuntimeEntry();
  if (!existsSync(entry)) {
    throw new Error(`Missing agent runtime bundle: ${entry}`);
  }

  const port = await resolveStablePort(options.preferredPort);
  const url = `http://127.0.0.1:${port}`;
  const litterBridgeSecret = randomBytes(32).toString("base64url");
  const child = fork(entry, {
    stdio: "pipe",
    detached: false,
    env: {
      ...process.env,
      PATH: resolveAugmentedPath(),
      PORT: String(port),
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      LOCAL_STUDIO_FRONTEND_BASE: options.frontendUrl,
      LOCAL_STUDIO_LITTER_BRIDGE_SECRET: litterBridgeSecret,
    },
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    log.info(`agent-runtime: ${String(chunk).trim()}`);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    log.warn(`agent-runtime: ${String(chunk).trim()}`);
  });
  child.once("exit", (code, signal) => {
    log.warn(`Agent runtime exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  currentAgentRuntime = child;
  try {
    await waitForAgentRuntime(child, url, DESKTOP_CONFIG.startupTimeoutMs);
    return { process: child, url };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export async function stopAgentRuntime(handle?: AgentRuntimeHandle): Promise<void> {
  if (!handle?.process) return;
  await stopChild(handle.process);
  if (currentAgentRuntime === handle.process) currentAgentRuntime = null;
}
