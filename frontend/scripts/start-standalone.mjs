import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import { resolveAccessPostureFromEnvironment } from "../src/lib/auth/access-posture.mjs";
import { resolveAgentRuntimeUrl } from "../src/lib/agent-runtime-url.mjs";
import { frontendSafeEnvironment } from "../../shared/agent/frontend-environment.mjs";

const CALLBACK_TOKEN_ENV = "LOCAL_STUDIO_FRONTEND_CALLBACK_TOKEN";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = resolve(projectRoot, ".next", "standalone");
const nestedRoot = resolve(standaloneRoot, "frontend");
const serverRoot = existsSync(nestedRoot) ? nestedRoot : standaloneRoot;
const localEnvironment = resolve(projectRoot, ".env.local");

if (existsSync(localEnvironment)) loadEnvironment({ path: localEnvironment });

const rawPort = process.env.PORT || "4783";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PORT must be an integer from 1024 through 65535");
}
const configuredEnvironment = {
  ...process.env,
  HOSTNAME: "127.0.0.1",
  NODE_ENV: "production",
  PORT: String(port),
  LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || resolve(projectRoot, ".."),
};
delete configuredEnvironment[CALLBACK_TOKEN_ENV];
const accessPosture = resolveAccessPostureFromEnvironment(configuredEnvironment);

if (accessPosture.kind === "configuration-error") {
  console.error(accessPosture.message);
  process.exit(1);
}

const runtimeDecision = resolveAgentRuntimeUrl(
  configuredEnvironment.LOCAL_STUDIO_AGENT_RUNTIME_URL,
);
if (!runtimeDecision.ok) throw new Error(runtimeDecision.error);
const runtimeUrl = runtimeDecision.url;
const runtimeIsLoopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
  runtimeDecision.hostname,
);
if (accessPosture.kind === "require-token" && !runtimeIsLoopback) {
  throw new Error("Token-gated frontend requires a frontend-owned loopback agent runtime.");
}
const callbackToken =
  accessPosture.kind === "require-token" ? randomBytes(32).toString("base64url") : "";
const callbackEnvironment = callbackToken ? { [CALLBACK_TOKEN_ENV]: callbackToken } : {};
const serverEnvironment = { ...configuredEnvironment, ...callbackEnvironment };

function copyDirectory(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function runtimeEnvironment() {
  return frontendSafeEnvironment(serverEnvironment);
}

async function runtimeHealthy() {
  try {
    const response = await fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload.service === "local-studio-agent-runtime";
  } catch {
    return false;
  }
}

async function waitForRuntime(child) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Agent runtime exited with code ${child.exitCode}`);
    if (await runtimeHealthy()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for the agent runtime.");
}

async function startRuntime() {
  if (await runtimeHealthy()) {
    if (accessPosture.kind === "require-token") {
      throw new Error("Token-gated frontend requires a frontend-owned loopback agent runtime.");
    }
    return null;
  }
  if (!runtimeIsLoopback) {
    throw new Error("Agent runtime is unavailable.");
  }
  const entry = resolve(projectRoot, "..", "services", "agent-runtime", "dist", "standalone.mjs");
  if (!existsSync(entry)) throw new Error(`Missing agent runtime bundle: ${entry}`);
  const child = spawn(process.execPath, [entry], {
    stdio: "inherit",
    env: {
      ...runtimeEnvironment(),
      PORT: runtimeDecision.port || "8081",
      LOCAL_STUDIO_FRONTEND_BASE: `http://127.0.0.1:${port}`,
      ...callbackEnvironment,
    },
  });
  try {
    await waitForRuntime(child);
    return child;
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
}

if (!existsSync(standaloneRoot)) {
  throw new Error('Missing ".next/standalone". Run "npm run build" first.');
}

copyDirectory(resolve(projectRoot, "public"), resolve(serverRoot, "public"));
copyDirectory(resolve(projectRoot, ".next", "static"), resolve(serverRoot, ".next", "static"));

const agentRuntime = await startRuntime();
const server = spawn(process.execPath, ["server.js"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: {
    ...serverEnvironment,
    LOCAL_STUDIO_AGENT_RUNTIME_URL: runtimeUrl,
  },
});
console.log(`Local Studio: http://127.0.0.1:${port}`);

function stopOwnedRuntime() {
  if (agentRuntime?.exitCode === null) agentRuntime.kill("SIGTERM");
}

let runtimeExitCode = 0;

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
