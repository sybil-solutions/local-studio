import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Semaphore } from "effect";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { getGlobalSingleton } from "../instances";

const LAUNCH_TIMEOUT_MS = 15_000;
const REVOCATION_TIMEOUT_MS = 5_000;

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

export type ManagedPlaywrightSession<Context> = {
  close: () => Promise<void>;
  closed: () => boolean;
  context: Context;
  generation: number;
  onClose: (listener: () => void) => void;
};

export type LaunchPlaywrightSession<Context> = (
  executablePath: string,
) => Promise<Omit<ManagedPlaywrightSession<Context>, "generation">>;

export type PlaywrightManagerOptions<Context> = {
  closeTimeoutMs?: number;
  launch: LaunchPlaywrightSession<Context>;
  resolveBinary?: () => string | null;
};

type SessionRevocation<Context> = {
  session: ManagedPlaywrightSession<Context>;
  settlement: Promise<void>;
};

export const createPlaywrightSessionLauncher = (): LaunchPlaywrightSession<BrowserContext> => {
  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;
  const contexts = new Set<BrowserContext>();

  const ensureBrowser = (executablePath: string): Promise<Browser> => {
    if (browser?.isConnected()) return Promise.resolve(browser);
    launching ??= chromium
      .launch({
        executablePath,
        headless: true,
        timeout: LAUNCH_TIMEOUT_MS,
        args: ["--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage"],
      })
      .then((launched) => {
        browser = launched;
        launched.once("disconnected", () => {
          if (browser === launched) browser = null;
        });
        return launched;
      })
      .finally(() => {
        launching = null;
      });
    return launching;
  };

  return async (executablePath) => {
    const activeBrowser = await ensureBrowser(executablePath);
    const context = await activeBrowser.newContext({ viewport: { width: 1280, height: 800 } });
    contexts.add(context);
    let isClosed = false;
    const listeners = new Set<() => void>();
    context.once("close", () => {
      isClosed = true;
      contexts.delete(context);
      for (const listener of listeners) listener();
      listeners.clear();
      if (contexts.size === 0 && browser === activeBrowser) {
        browser = null;
        void activeBrowser.close().catch(() => undefined);
      }
    });
    return {
      close: () => context.close(),
      closed: () => isClosed,
      context,
      onClose: (listener) => listeners.add(listener),
    };
  };
};

const launchPlaywrightSession = createPlaywrightSessionLauncher();

export class PlaywrightManager<Context = BrowserContext> {
  private readonly active = new Map<string, ManagedPlaywrightSession<Context>>();
  private readonly revocations = new Map<string, SessionRevocation<Context>>();
  private generation = 0;
  private poison: { error: unknown } | null = null;
  private stopping: Promise<void> | null = null;
  private stopped = false;
  private readonly transitionLock = Semaphore.makeUnsafe(1);
  private readonly closeTimeoutMs: number;
  private readonly launch: LaunchPlaywrightSession<Context>;
  private readonly resolveBinary: () => string | null;

  constructor({
    closeTimeoutMs = REVOCATION_TIMEOUT_MS,
    launch,
    resolveBinary = findBrowserBinary,
  }: PlaywrightManagerOptions<Context>) {
    this.closeTimeoutMs = closeTimeoutMs;
    this.launch = launch;
    this.resolveBinary = resolveBinary;
  }

  isAvailable(): boolean {
    return !this.stopped && this.poison === null && this.resolveBinary() !== null;
  }

  ensure(scope: string): Promise<ManagedPlaywrightSession<Context>> {
    return this.withPermit(() => this.ensureUnlocked(scope));
  }

  current(scope: string): ManagedPlaywrightSession<Context> | null {
    return this.active.get(scope) ?? null;
  }

  release(scope: string): Promise<void> {
    return this.withPermit(() => this.revokeActive(scope));
  }

  stop(): Promise<void> {
    this.stopping ??= this.withPermit(() => this.stopUnlocked());
    return this.stopping;
  }

  private async ensureUnlocked(scope: string): Promise<ManagedPlaywrightSession<Context>> {
    this.assertUsable();
    const active = this.active.get(scope);
    if (active?.closed()) this.active.delete(scope);
    const current = this.active.get(scope);
    if (current) return current;
    this.revocations.delete(scope);
    const executablePath = this.resolveBinary();
    if (!executablePath) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
    const launched = await this.launch(executablePath);
    const session: ManagedPlaywrightSession<Context> = {
      close: () => launched.close(),
      closed: () => launched.closed(),
      context: launched.context,
      generation: ++this.generation,
      onClose: (listener) => launched.onClose(listener),
    };
    session.onClose(() => {
      if (this.active.get(scope) === session) this.active.delete(scope);
    });
    this.active.set(scope, session);
    return session;
  }

  private async revokeActive(scope: string): Promise<void> {
    const session = this.active.get(scope);
    const cached = this.revocations.get(scope);
    if (cached && (!session || cached.session === session)) return cached.settlement;
    if (!session) return;
    const settlement = this.revokeSession(scope, session);
    const revocation = { session, settlement };
    this.revocations.set(scope, revocation);
    void settlement.then(
      () => {
        if (this.revocations.get(scope) === revocation) this.revocations.delete(scope);
      },
      () => undefined,
    );
    return settlement;
  }

  private async revokeSession(
    scope: string,
    session: ManagedPlaywrightSession<Context>,
  ): Promise<void> {
    try {
      await Effect.runPromise(
        Effect.tryPromise({ try: session.close, catch: (error) => error }).pipe(
          Effect.timeoutOrElse({
            duration: this.closeTimeoutMs,
            orElse: () => Effect.fail(new Error("Timed out confirming Chromium termination")),
          }),
        ),
      );
      if (!session.closed()) throw new Error("Chromium termination was not confirmed");
      if (this.active.get(scope) === session) this.active.delete(scope);
    } catch (error) {
      this.poison = { error };
      throw error;
    }
  }

  private async stopUnlocked(): Promise<void> {
    this.stopped = true;
    let failure = this.poison;
    for (const scope of [...this.active.keys()]) {
      try {
        await this.revokeActive(scope);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  }

  private assertUsable(): void {
    if (this.poison) throw this.poison.error;
    if (this.stopped) throw new Error("Browser manager stopped");
  }

  private withPermit<A>(task: () => Promise<A>): Promise<A> {
    return Effect.runPromise(
      this.transitionLock.withPermit(Effect.tryPromise({ try: task, catch: (error) => error })),
    );
  }
}

export const playwrightManager = getGlobalSingleton(
  "playwrightManager",
  () => new PlaywrightManager({ launch: launchPlaywrightSession }),
);

getGlobalSingleton("playwrightExitHook", () => {
  if (typeof process !== "undefined") process.on("exit", () => void playwrightManager.stop());
  return true;
});
