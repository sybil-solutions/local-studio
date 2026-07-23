import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Semaphore } from "effect";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Route,
  type WebSocketRoute,
} from "playwright-core";
import type { BrowserNetworkMode } from "../../../../shared/agent/sanitize-embedded-browser-url";
import { getGlobalSingleton } from "../instances";
import { browserNetworkPolicy, type BrowserNetworkPolicy } from "./network-policy";
import { createBrowserPinningProxies, type PinningProxy } from "./pinning-proxy";

const LAUNCH_TIMEOUT_MS = 15_000;
const REVOCATION_TIMEOUT_MS = 5_000;
const PROXY_BYPASS_LIST = "<-loopback>";
const DEFAULT_SCOPE = "default";

type BrowserPinningProxies = Record<BrowserNetworkMode, PinningProxy>;

export type ManagedPlaywrightSession<Context> = {
  close: () => Promise<void>;
  closed: () => boolean;
  context: Context;
  generation: number;
  mode: BrowserNetworkMode;
  onClose: (listener: () => void) => void;
};

export type LaunchPlaywrightSession<Context> = (
  executablePath: string,
  mode: BrowserNetworkMode,
  proxy: PinningProxy,
  policy: BrowserNetworkPolicy,
) => Promise<Omit<ManagedPlaywrightSession<Context>, "generation">>;

export type PlaywrightManagerOptions<Context> = {
  closeTimeoutMs?: number;
  createProxies?: (policy: BrowserNetworkPolicy) => Promise<BrowserPinningProxies>;
  launch: LaunchPlaywrightSession<Context>;
  policy?: BrowserNetworkPolicy;
  resolveBinary?: () => string | null;
};

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

export const playwrightArguments = (): string[] => [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-quic",
  "--disable-sync",
  "--no-pings",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  `--proxy-bypass-list=${PROXY_BYPASS_LIST}`,
];

export const playwrightProxySettings = (server: string): { bypass: string; server: string } => ({
  bypass: PROXY_BYPASS_LIST,
  server,
});

const guardRoute = async (
  route: Route,
  mode: BrowserNetworkMode,
  policy: BrowserNetworkPolicy,
): Promise<void> => {
  try {
    await policy.resolve(route.request().url(), mode);
  } catch {
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
};

const guardWebSocket = async (
  route: WebSocketRoute,
  mode: BrowserNetworkMode,
  policy: BrowserNetworkPolicy,
): Promise<void> => {
  try {
    await policy.resolve(route.url(), mode);
  } catch {
    await route.close({ code: 1008, reason: "Browser network policy blocked destination" });
    return;
  }
  route.connectToServer();
};

const installNetworkGuards = async (
  context: BrowserContext,
  mode: BrowserNetworkMode,
  policy: BrowserNetworkPolicy,
): Promise<void> => {
  await context.route(/^https?:\/\//u, (route) => guardRoute(route, mode, policy));
  await context.routeWebSocket(/^wss?:\/\//u, (route) => guardWebSocket(route, mode, policy));
};

const closeBrowserContext = async (context: BrowserContext): Promise<void> => {
  try {
    await context.close();
  } catch (contextError) {
    const browser = context.browser();
    if (!browser) throw contextError;
    await browser.close();
  }
};

export const createPlaywrightSessionLauncher = (): LaunchPlaywrightSession<BrowserContext> => {
  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;
  const contexts = new Set<BrowserContext>();

  const ensureBrowser = (executablePath: string): Promise<Browser> => {
    if (browser?.isConnected()) return Promise.resolve(browser);
    launching ??= chromium
      .launch({
        args: playwrightArguments(),
        executablePath,
        headless: true,
        timeout: LAUNCH_TIMEOUT_MS,
      })
      .then((launched) => {
        browser = launched;
        return launched;
      })
      .finally(() => {
        launching = null;
      });
    return launching;
  };

  return async (executablePath, mode, proxy, policy) => {
    const activeBrowser = await ensureBrowser(executablePath);
    const context = await activeBrowser.newContext({
      proxy: playwrightProxySettings(proxy.url),
      serviceWorkers: "block",
      viewport: { width: 1280, height: 800 },
    });
    try {
      await installNetworkGuards(context, mode, policy);
    } catch (error) {
      await closeBrowserContext(context).catch(() => undefined);
      throw error;
    }
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
      close: () => closeBrowserContext(context),
      closed: () => isClosed,
      context,
      mode,
      onClose: (listener) => listeners.add(listener),
    };
  };
};

const launchPlaywrightSession = createPlaywrightSessionLauncher();

const closeProxies = async (proxies: BrowserPinningProxies): Promise<void> => {
  const results = await Promise.allSettled([proxies.public.close(), proxies.loopback.close()]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
};

export class PlaywrightManager<Context = BrowserContext> {
  private readonly active = new Map<string, ManagedPlaywrightSession<Context>>();
  private generation = 0;
  private poisoned: unknown = null;
  private proxies: BrowserPinningProxies | null = null;
  private stopped = false;
  private readonly transitionLock = Semaphore.makeUnsafe(1);
  private readonly closeTimeoutMs: number;
  private readonly createProxies: (policy: BrowserNetworkPolicy) => Promise<BrowserPinningProxies>;
  private readonly launch: LaunchPlaywrightSession<Context>;
  private readonly policy: BrowserNetworkPolicy;
  private readonly resolveBinary: () => string | null;

  constructor({
    closeTimeoutMs = REVOCATION_TIMEOUT_MS,
    createProxies = createBrowserPinningProxies,
    launch,
    policy = browserNetworkPolicy,
    resolveBinary = findBrowserBinary,
  }: PlaywrightManagerOptions<Context>) {
    this.closeTimeoutMs = closeTimeoutMs;
    this.createProxies = createProxies;
    this.launch = launch;
    this.policy = policy;
    this.resolveBinary = resolveBinary;
  }

  isAvailable(): boolean {
    return !this.stopped && this.poisoned === null && this.resolveBinary() !== null;
  }

  ensure(
    mode: BrowserNetworkMode = "public",
    scope: string = DEFAULT_SCOPE,
  ): Promise<ManagedPlaywrightSession<Context>> {
    return this.withPermit(() => this.ensureUnlocked(mode, scope));
  }

  current(scope: string = DEFAULT_SCOPE): ManagedPlaywrightSession<Context> | null {
    return this.active.get(scope) ?? null;
  }

  release(scope: string = DEFAULT_SCOPE): Promise<void> {
    return this.withPermit(() => this.revokeActive(scope));
  }

  stop(): Promise<void> {
    return this.withPermit(() => this.stopUnlocked());
  }

  private async ensureUnlocked(
    mode: BrowserNetworkMode,
    scope: string,
  ): Promise<ManagedPlaywrightSession<Context>> {
    this.assertUsable();
    const active = this.active.get(scope);
    if (active?.closed()) this.active.delete(scope);
    const current = this.active.get(scope);
    if (current?.mode === mode) return current;
    if (current) await this.revokeActive(scope);
    const executablePath = this.resolveBinary();
    if (!executablePath) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
    const proxies = await this.ensureProxies();
    const launched = await this.launch(executablePath, mode, proxies[mode], this.policy);
    const session: ManagedPlaywrightSession<Context> = {
      close: () => launched.close(),
      closed: () => launched.closed(),
      context: launched.context,
      generation: ++this.generation,
      mode: launched.mode,
      onClose: (listener) => launched.onClose(listener),
    };
    session.onClose(() => {
      if (this.active.get(scope) === session) this.active.delete(scope);
    });
    this.active.set(scope, session);
    return session;
  }

  private async ensureProxies(): Promise<BrowserPinningProxies> {
    if (!this.proxies) this.proxies = await this.createProxies(this.policy);
    return this.proxies;
  }

  private async revokeActive(scope: string): Promise<void> {
    const session = this.active.get(scope);
    if (!session) return;
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
      this.poisoned = error;
      throw error;
    }
  }

  private async stopUnlocked(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    let failure: unknown = null;
    for (const scope of [...this.active.keys()]) {
      try {
        await this.revokeActive(scope);
      } catch (error) {
        failure ??= error;
      }
    }
    const proxies = this.proxies;
    this.proxies = null;
    if (proxies) {
      try {
        await closeProxies(proxies);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }

  private assertUsable(): void {
    if (this.poisoned) throw this.poisoned;
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
