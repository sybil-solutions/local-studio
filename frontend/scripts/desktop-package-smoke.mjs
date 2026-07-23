import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error("Could not reserve a debugging port");
  return port;
}

async function waitForFile(file, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(file)) {
      const value = readFileSync(file, "utf8").trim();
      if (value) return value;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

async function waitForAgentRuntime(logFile, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(logFile)) {
      const log = readFileSync(logFile, "utf8");
      const matches = [
        ...log.matchAll(/agent-runtime: (?:\[agent-runtime\] )?listening on (http:\/\/127\.0\.0\.1:\d+)/g),
      ];
      const url = matches.at(-1)?.[1];
      if (url) {
        const payload = await waitForJson(`${url}/health`, 10_000);
        return { url, payload };
      }
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for agent runtime in ${logFile}`);
}

async function waitForPage(browser, origin, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().startsWith(origin)) return page;
      }
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for Electron page at ${origin}`);
}

async function smokeTerminal(page) {
  return page.evaluate(async () => {
    const bridge = globalThis.localStudioDesktop;
    if (!bridge) throw new Error("Desktop bridge is unavailable");
    const status = await bridge.terminal.status();
    if (!status.available) throw new Error(status.reason || "PTY is unavailable");

    const session = await bridge.terminal.open({
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      ownerKey: "desktop-package-smoke",
    });

    return new Promise((resolve, reject) => {
      let output = session.replay || "";
      const timer = setTimeout(() => {
        disposeData();
        disposeExit();
        reject(new Error(`PTY smoke timed out: ${output}`));
      }, 10_000);
      const finish = () => {
        if (!output.includes("LOCAL_STUDIO_PTY_OK")) return;
        clearTimeout(timer);
        disposeData();
        disposeExit();
        resolve({ available: true, output: "LOCAL_STUDIO_PTY_OK" });
      };
      const disposeData = bridge.terminal.onData((id, chunk) => {
        if (id !== session.id) return;
        output += chunk;
        finish();
      });
      const disposeExit = bridge.terminal.onExit((id) => {
        if (id !== session.id) return;
        finish();
      });
      void bridge.terminal.write(session.id, "printf 'LOCAL_STUDIO_PTY_OK\\n'; exit\\n");
      finish();
    });
  });
}

async function terminate(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  await Promise.race([
    child.exitCode === null && child.signalCode === null
      ? new Promise((resolve) => child.once("exit", resolve))
      : Promise.resolve(),
    delay(5_000),
  ]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
}

export async function runDesktopPackageSmoke(args = process.argv.slice(2)) {
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const requestedApp = valueAfter(args, "--app");
  const appPath = requestedApp
    ? path.resolve(requestedApp)
    : path.join(frontend, "dist-desktop", "mac-arm64", "Local Studio.app");
  const expectedVersion = valueAfter(args, "--expected-version");
  const executable = path.join(appPath, "Contents", "MacOS", "Local Studio");
  if (!existsSync(executable)) throw new Error(`Missing packaged executable: ${executable}`);

  const temp = mkdtempSync(path.join(os.tmpdir(), "local-studio-package-smoke-"));
  const userData = path.join(temp, "user-data");
  const logFile = path.join(userData, "logs", "desktop.log");
  const frontendPortFile = path.join(userData, "embedded-frontend.port");
  const debugPort = await reservePort();
  const stdout = [];
  const stderr = [];
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    path.join(userData, "api-settings.json"),
    `${JSON.stringify({
      backendUrl: "http://127.0.0.1:65534",
      apiKey: "",
      voiceUrl: "",
      voiceModel: "whisper-large-v3-turbo",
    })}\n`,
    { mode: 0o600 },
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    LOCAL_STUDIO_AGENT_CWD: temp,
    LOCAL_STUDIO_DESKTOP_APP_NAME: `Local Studio Smoke ${process.pid}`,
    LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE: "true",
    LOCAL_STUDIO_DESKTOP_USER_DATA_DIR: userData,
  });

  let child;
  let browser;
  try {
    child = spawn(executable, [`--remote-debugging-port=${debugPort}`], {
      cwd: temp,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

    const frontendPort = Number(await waitForFile(frontendPortFile, 60_000));
    if (!Number.isInteger(frontendPort) || frontendPort <= 0) {
      throw new Error(`Invalid embedded frontend port: ${frontendPort}`);
    }
    const origin = `http://127.0.0.1:${frontendPort}`;
    const desktopHealth = await waitForJson(`${origin}/api/desktop-health`, 30_000);
    const agentRuntime = await waitForAgentRuntime(logFile, 30_000);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const page = await waitForPage(browser, origin, 30_000);
    await page.waitForLoadState("domcontentloaded");
    const agentResponse = await page.goto(`${origin}/agent`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!agentResponse?.ok()) {
      throw new Error(`Agent route returned ${agentResponse?.status() ?? "no response"}`);
    }

    const runtime = await page.evaluate(async () => {
      if (!globalThis.localStudioDesktop) throw new Error("Desktop bridge is unavailable");
      return globalThis.localStudioDesktop.getRuntime();
    });
    if (expectedVersion && runtime.appVersion !== expectedVersion) {
      throw new Error(
        `Packaged app version ${runtime.appVersion} does not match ${expectedVersion}`,
      );
    }
    const terminal = await smokeTerminal(page);

    const result = {
      appPath,
      agentStatus: agentResponse.status(),
      desktopHealth,
      agentRuntime: agentRuntime.payload,
      runtime,
      terminal,
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const diagnostics = [
      existsSync(logFile) ? readFileSync(logFile, "utf8").slice(-12_000) : "",
      stdout.join("").slice(-4_000),
      stderr.join("").slice(-4_000),
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await terminate(child);
    rmSync(temp, { recursive: true, force: true });
  }
}

await runDesktopPackageSmoke();
