// The production launcher: validate the environment, complete the standalone
// tree's static assets, bring up the agent runtime, then the Next server, and
// keep their lifecycles tied together.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resolveAccessPostureFromEnvironment } from "../../src/lib/auth/access-posture.mjs";
import { frontendDir, repoRoot } from "./lib.mjs";

function copyDirectory(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

export async function start() {
  const standaloneRoot = path.resolve(frontendDir, ".next", "standalone");
  const nestedRoot = path.resolve(standaloneRoot, "frontend");
  const serverRoot = existsSync(nestedRoot) ? nestedRoot : standaloneRoot;
  const rawPort = process.env.PORT || "4783";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw Error("PORT must be an integer from 1024 through 65535");
  }

  const serverEnvironment = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
    PORT: String(port),
  };
  const accessPosture = resolveAccessPostureFromEnvironment(serverEnvironment);
  if (accessPosture.kind === "configuration-error") throw Error(accessPosture.message);

  const runtimeUrl = (serverEnvironment.LOCAL_STUDIO_AGENT_RUNTIME_URL || "http://127.0.0.1:8081").replace(
    /\/+$/,
    "",
  );
  if (!existsSync(standaloneRoot)) {
    throw Error('Missing ".next/standalone". Run "npm run build" first.');
  }
  copyDirectory(path.resolve(frontendDir, "public"), path.resolve(serverRoot, "public"));
  copyDirectory(path.resolve(frontendDir, ".next", "static"), path.resolve(serverRoot, ".next", "static"));

  const runtimeHealthy = async () => {
    try {
      const response = await fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) return false;
      return (await response.json()).service === "local-studio-agent-runtime";
    } catch {
      return false;
    }
  };

  const startRuntime = async () => {
    if (await runtimeHealthy()) return null;
    const url = new URL(runtimeUrl);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw Error(`Agent runtime is unavailable: ${runtimeUrl}`);
    }
    const entry = path.resolve(repoRoot, "services", "agent-runtime", "dist", "standalone.mjs");
    if (!existsSync(entry)) throw Error(`Missing agent runtime bundle: ${entry}`);
    const child = spawn(process.execPath, [entry], {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: url.port || "8081",
        LOCAL_STUDIO_FRONTEND_BASE: `http://127.0.0.1:${port}`,
      },
    });
    try {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        if (child.exitCode !== null) throw Error(`Agent runtime exited with code ${child.exitCode}`);
        if (await runtimeHealthy()) return child;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      throw Error(`Timed out waiting for agent runtime: ${runtimeUrl}`);
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGTERM");
      throw error;
    }
  };

  let runtimeExitCode = 0;
  const agentRuntime = await startRuntime();
  const server = spawn(process.execPath, ["server.js"], {
    cwd: serverRoot,
    stdio: "inherit",
    env: {
      ...serverEnvironment,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || repoRoot,
      LOCAL_STUDIO_AGENT_RUNTIME_URL: runtimeUrl,
    },
  });
  console.log(`Local Studio: http://127.0.0.1:${port}`);

  const stopOwnedRuntime = () => {
    if (agentRuntime?.exitCode === null) agentRuntime.kill("SIGTERM");
  };
  server.on("exit", (code) => {
    stopOwnedRuntime();
    process.exit(runtimeExitCode || code || 0);
  });
  agentRuntime?.on("exit", (code) => {
    runtimeExitCode = code || 1;
    if (server.exitCode === null) server.kill("SIGTERM");
  });
  process.on("SIGINT", () => server.kill("SIGINT"));
  process.on("SIGTERM", () => server.kill("SIGTERM"));
}
