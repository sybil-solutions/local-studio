import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { getGlobalSingleton } from "../instances";

const LAUNCH_TIMEOUT_MS = 15_000;

class BrowserContextRecoveryError extends Error {
  readonly name = "BrowserContextRecoveryError";
}

const browserDataDirectory = (): string => path.join(os.tmpdir(), "local-studio-browser-profile");

const resolveOnPath = (binary: string): string | null => {
  try {
    const resolved = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const platformBrowserCandidates = (): string[] => {
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
};

export const findBrowserBinary = (): string | null => {
  const override = process.env["LOCAL_STUDIO_CHROME_PATH"]?.trim();
  if (override) return existsSync(override) ? override : null;
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return bundled;
  return platformBrowserCandidates().find((candidate) => existsSync(candidate)) ?? null;
};

class PlaywrightManager {
  private context: BrowserContext | null = null;
  private contextGeneration = 0;
  private generation = 0;
  private launching: { generation: number; promise: Promise<BrowserContext> } | null = null;

  isAvailable(): boolean {
    return findBrowserBinary() !== null;
  }

  async ensure(): Promise<BrowserContext> {
    const generation = this.generation;
    if (this.context && this.contextGeneration === generation) return this.context;
    if (this.launching?.generation === generation) return this.launching.promise;
    if (this.launching) {
      await this.launching.promise.catch(() => undefined);
      return this.ensure();
    }
    const executablePath = findBrowserBinary();
    if (!executablePath) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
    const launch = (userDataDir: string): Promise<BrowserContext> =>
      chromium.launchPersistentContext(userDataDir, {
        executablePath,
        headless: true,
        viewport: { width: 1280, height: 800 },
        timeout: LAUNCH_TIMEOUT_MS,
        args: ["--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage"],
      });
    const dataDirectory = browserDataDirectory();
    const promise = launch(dataDirectory)
      .catch((error: unknown) => {
        if (!String(error).includes("ProcessSingleton")) throw error;
        return launch(`${dataDirectory}-${process.pid}`);
      })
      .then(async (context) => {
        if (generation !== this.generation) {
          try {
            await context.close();
          } catch (error) {
            throw new BrowserContextRecoveryError("Failed to close invalidated browser context", {
              cause: error,
            });
          }
          throw new Error("Browser context invalidated during launch");
        }
        this.context = context;
        this.contextGeneration = generation;
        context.once("close", () => {
          if (this.context === context) this.context = null;
        });
        return context;
      });
    const launching = { generation, promise };
    this.launching = launching;
    try {
      return await promise;
    } finally {
      if (this.launching === launching) this.launching = null;
    }
  }

  async invalidate(): Promise<void> {
    this.generation += 1;
    const context = this.context;
    this.context = null;
    const launching = this.launching?.promise;
    const closures: Promise<unknown>[] = [];
    if (context) closures.push(context.close());
    if (launching) {
      closures.push(
        launching.catch((error: unknown) => {
          if (error instanceof BrowserContextRecoveryError) throw error;
        }),
      );
    }
    await Promise.all(closures);
  }

  stop(): void {
    void this.invalidate().catch(() => undefined);
  }
}

export const playwrightManager = getGlobalSingleton(
  "playwrightManager",
  () => new PlaywrightManager(),
);

getGlobalSingleton("playwrightExitHook", () => {
  if (typeof process !== "undefined") {
    process.on("exit", () => playwrightManager.stop());
  }
  return true;
});
