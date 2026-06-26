// Locate and launch a headless Chromium for the server-side CDP browser host.
//
// CDP client and snapshot approach adapted from Ghostex (MIT, maddada).
//
// The frontend's pi agent drives a real headless Chromium over raw CDP instead
// of the old renderer-bridge embedded webview. This module owns binary
// discovery + process lifecycle; the actual protocol work lives in cdp.ts and
// browser-host.ts. Server-only: never import from client components.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  // Linux (and anything else): resolve common binary names on PATH.
  return ["chromium-browser", "chromium", "google-chrome-stable", "google-chrome"]
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

// Launch headless Chromium with remote debugging on an ephemeral port and parse
// the `DevTools listening on ws://...` line from stderr to learn the endpoint.
export function launchChrome(binary: string): Promise<ChromeProcess> {
  const dataDir = chromeDataDir();
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

    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for Chromium DevTools endpoint"));
    }, CHROME_LAUNCH_TIMEOUT_MS);

    child.stderr?.on("data", onStderr);
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (!settled) finish(new Error(`Chromium exited before ready (code ${code ?? "null"})`));
    });
  });
}

// Singleton process manager. Lazy-launches on first use, detects process exit
// and clears state so the next caller relaunches, and exposes stop()/isAvailable().
class ChromeManager {
  private process: ChromeProcess | null = null;
  private launching: Promise<ChromeProcess> | null = null;

  isAvailable(): boolean {
    return findChromeBinary() !== null;
  }

  async ensure(): Promise<ChromeProcess> {
    if (this.process) return this.process;
    if (this.launching) return this.launching;
    const binary = findChromeBinary();
    if (!binary) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
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
  }
}

const globalForChrome = globalThis as typeof globalThis & {
  __localStudioChromeManager?: ChromeManager;
};

export const chromeManager = globalForChrome.__localStudioChromeManager ?? new ChromeManager();
globalForChrome.__localStudioChromeManager = chromeManager;
