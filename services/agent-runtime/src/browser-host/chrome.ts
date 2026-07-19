// Locate and launch a headless Chromium for the server-side CDP browser host.
//
// CDP client and snapshot approach adapted from Ghostex (MIT, maddada).
//
// The frontend's pi agent drives a real headless Chromium over raw CDP instead
// of the old renderer-bridge embedded webview. This module owns binary
// discovery + process lifecycle; the actual protocol work lives in cdp.ts and
// browser-host.ts. Server-only: never import from client components.

import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getGlobalSingleton } from "../instances";

const CHROME_LAUNCH_TIMEOUT_MS = 15_000;

// Where Chromium keeps its profile. Stable so we reuse one profile dir and the
// smoke/cleanup steps can target it via `pkill -f local-studio-browser-profile`.
function chromeDataDir(): string {
  return path.join(os.tmpdir(), "local-studio-browser-profile");
}

function platformChromeCandidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Arc.app/Contents/MacOS/Arc",
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter((value): value is string => Boolean(value));
    const suffixes = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Google\\Chrome Beta\\Application\\chrome.exe",
      "Chromium\\Application\\chrome.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Vivaldi\\Application\\vivaldi.exe",
    ];
    return roots.flatMap((root) => suffixes.map((suffix) => path.join(root, suffix)));
  }
  return [
    "chromium-browser",
    "chromium",
    "google-chrome-stable",
    "google-chrome",
    "brave-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "vivaldi-stable",
  ]
    .map(resolveOnPath)
    .filter((value): value is string => Boolean(value));
}

function resolveOnPath(binary: string): string | null {
  if (binary.includes("/")) return existsSync(binary) ? binary : null;
  try {
    const resolved = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

// Discovery order: explicit env override first, then platform defaults.
export function findChromeBinary(): string | null {
  const override = process.env.LOCAL_STUDIO_CHROME_PATH?.trim();
  if (override) return existsSync(override) ? override : null;
  for (const candidate of platformChromeCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type ChromeProcess = {
  child: ChildProcess;
  wsEndpoint: string;
  port: number;
};

function parseDevToolsEndpoint(line: string): string | null {
  const match = line.match(/DevTools listening on (ws:\/\/\S+)/);
  return match ? match[1] : null;
}

function portFromWsEndpoint(endpoint: string): number {
  try {
    return Number(new URL(endpoint).port) || 0;
  } catch {
    return 0;
  }
}

function devToolsPortFile(dataDir: string): string {
  return path.join(dataDir, "DevToolsActivePort");
}

function endpointFromPortFile(dataDir: string): string | null {
  try {
    const [port, wsPath] = readFileSync(devToolsPortFile(dataDir), "utf8").split(/\r?\n/);
    if (!port?.trim() || !wsPath?.trim()) return null;
    return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
  } catch {
    return null;
  }
}

function windowsLaunchFlags(): string[] {
  return process.platform === "win32" ? ["--do-not-de-elevate"] : [];
}

// Launch headless Chromium with remote debugging on an ephemeral port and parse
// the `DevTools listening on ws://...` line from stderr to learn the endpoint.
// Windows launchers can hand off to a relaunched browser process and exit 0
// (elevation drop), leaving stderr empty — the DevToolsActivePort file in the
// profile dir is the fallback endpoint source for that path.
export function launchChrome(binary: string): Promise<ChromeProcess> {
  const dataDir = chromeDataDir();
  rmSync(devToolsPortFile(dataDir), { force: true });
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
      `--user-data-dir=${dataDir}`,
      ...windowsLaunchFlags(),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  return new Promise<ChromeProcess>((resolve, reject) => {
    let settled = false;
    let stderrBuffer = "";

    const finish = (error: Error | null, endpoint?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(portFilePoll);
      child.stderr?.off("data", onStderr);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
        return;
      }
      const wsEndpoint = endpoint as string;
      resolve({ child, wsEndpoint, port: portFromWsEndpoint(wsEndpoint) });
    };

    const onStderr = (chunk: Buffer | string) => {
      stderrBuffer += String(chunk);
      const endpoint = parseDevToolsEndpoint(stderrBuffer);
      if (endpoint) finish(null, endpoint);
    };

    let launcherExitCode: number | null = null;

    const timer = setTimeout(() => {
      const detail =
        launcherExitCode === null
          ? ""
          : ` (launcher exited ${launcherExitCode}; stderr: ${stderrBuffer.slice(-200).trim() || "empty"})`;
      finish(new Error(`Timed out waiting for Chromium DevTools endpoint${detail}`));
    }, CHROME_LAUNCH_TIMEOUT_MS);

    const portFilePoll = setInterval(() => {
      const endpoint = endpointFromPortFile(dataDir);
      if (endpoint) finish(null, endpoint);
    }, 250);

    child.stderr?.on("data", onStderr);
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (settled) return;
      launcherExitCode = code;
      if (process.platform === "win32" && code === 0) return;
      finish(new Error(`Chromium exited before ready (code ${code ?? "null"})`));
    });
  });
}

// Singleton process manager. Lazy-launches on first use, detects process exit
// and clears state so the next caller relaunches, and exposes stop()/isAvailable().
class ChromeManager {
  private process: ChromeProcess | null = null;
  private launching: Promise<ChromeProcess> | null = null;
  private launchAttempted = false;

  isAvailable(): boolean {
    return findChromeBinary() !== null;
  }

  async ensure(): Promise<ChromeProcess> {
    if (this.process) {
      if (this.process.child.exitCode === null) return this.process;
      if (await isBrowserResponding(this.process.port)) return this.process;
      this.process = null;
    }
    if (this.launching) return this.launching;
    const binary = findChromeBinary();
    if (!binary) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
    this.launchAttempted = true;
    killDetachedWindowsChromes();
    this.launching = launchChrome(binary)
      .then((proc) => {
        this.process = proc;
        proc.child.once("exit", () => {
          if (this.process === proc) this.process = null;
        });
        return proc;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  current(): ChromeProcess | null {
    return this.process;
  }

  stop(): void {
    const proc = this.process;
    this.process = null;
    if (proc) proc.child.kill("SIGKILL");
    if (proc || this.launchAttempted) killDetachedWindowsChromes();
  }
}

async function isBrowserResponding(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function killDetachedWindowsChromes(): void {
  if (process.platform !== "win32") return;
  spawnSync("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*local-studio-browser-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
  ], { timeout: 10_000 });
}

export const chromeManager = getGlobalSingleton("chromeManager", () => new ChromeManager());

// Kill the spawned Chromium when the server process exits, so a normal
// shutdown / restart doesn't orphan a headless browser holding the fixed
// profile-dir lock. Registered once (guarded through the package's global
// singleton registry), synchronous (safe in "exit"). Next's graceful
// SIGTERM/SIGINT handling calls process.exit, which fires this; a raw SIGKILL
// can't be intercepted by anything.
getGlobalSingleton("chromeExitHook", () => {
  if (typeof process !== "undefined") {
    process.on("exit", () => chromeManager.stop());
  }
  return true;
});
