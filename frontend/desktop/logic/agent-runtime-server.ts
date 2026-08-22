import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG } from "../configs";
import { log } from "../helpers/logger";
import { resolveStablePort } from "../helpers/ports";
import { forkChild, stopChild, waitUntilReady } from "./child-supervisor";

export type AgentRuntimeHandle = {
  frontendUrl: string;
  process?: ChildProcess;
  url: string;
};

type StartAgentRuntimeOptions = {
  frontendUrl: string;
  preferredPort?: number;
};

function agentRuntimeEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "agent-runtime", "standalone.mjs")
    : path.resolve(app.getAppPath(), "..", "services", "agent-runtime", "dist", "standalone.mjs");
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

export async function startAgentRuntime(
  options: StartAgentRuntimeOptions,
): Promise<AgentRuntimeHandle> {
  const preferredUrl = options.preferredPort ? `http://127.0.0.1:${options.preferredPort}` : null;
  if (preferredUrl && (await isAgentRuntimeHealthy(preferredUrl))) {
    log.info(`Using agent runtime at ${preferredUrl}`);
    return { frontendUrl: options.frontendUrl, url: preferredUrl };
  }

  const entry = agentRuntimeEntry();
  if (!existsSync(entry)) {
    throw new Error(`Missing agent runtime bundle: ${entry}`);
  }

  const port = await resolveStablePort(options.preferredPort);
  const url = `http://127.0.0.1:${port}`;
  const child = forkChild({
    label: "agent-runtime",
    entry,
    env: {
      PORT: String(port),
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      PI_CODING_AGENT_DIR: path.join(DESKTOP_CONFIG.userDataDir, "pi-agent"),
      LOCAL_STUDIO_PROJECTS_FILE: path.join(DESKTOP_CONFIG.userDataDir, "projects.json"),
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      LOCAL_STUDIO_FRONTEND_BASE: options.frontendUrl,
    },
  });

  child.once("exit", (code, signal) => {
    log.warn(`Agent runtime exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  try {
    await waitUntilReady({
      child,
      isReady: () => isAgentRuntimeHealthy(url),
      timeoutMs: DESKTOP_CONFIG.startupTimeoutMs,
      intervalMs: 200,
      label: `agent runtime: ${url}`,
    });
    return { frontendUrl: options.frontendUrl, process: child, url };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export async function startOrReuseAgentRuntime(
  options: StartAgentRuntimeOptions,
  existing?: AgentRuntimeHandle,
): Promise<AgentRuntimeHandle> {
  if (
    existing?.frontendUrl === options.frontendUrl &&
    (await isAgentRuntimeHealthy(existing.url))
  ) {
    log.info(`Reusing agent runtime at ${existing.url}`);
    return existing;
  }
  if (existing) await stopAgentRuntime(existing);
  return startAgentRuntime(options);
}

export async function stopAgentRuntime(handle?: AgentRuntimeHandle): Promise<void> {
  if (handle?.process) await stopChild(handle.process);
}
