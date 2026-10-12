import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { getGlobalSingleton } from "../instances";
import {
  resolveBrowserEngine,
  tryResolveBrowserEngine,
  type ResolvedBrowserEngine,
} from "./browser-engines";
import { startPinningProxy, type PinningProxy } from "./pinning-proxy";

const LAUNCH_TIMEOUT_MS = 15_000;

// One Chromium process, one BrowserContext per agent session. Contexts are
// ephemeral (no user-data directory), which is what the browser tool has
// always promised — "a throwaway profile: no saved logins, no cookies" — and
// what keeps one session's cookies and storage out of another's.
//
// All traffic is forced through the pinning proxy (pinning-proxy.ts): the
// bypass "<-loopback>" removes Chromium's implicit localhost bypass so even
// loopback goes through policy, --disable-quic keeps HTTP/3 from skipping the
// proxy, and the WebRTC policy flag stops pages opening raw UDP paths around
// it. Service workers are blocked because they can outlive a page and issue
// fetches with less oversight; nothing in the tool surface needs them.
class PlaywrightManager {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private proxy: PinningProxy | null = null;
  private contexts = new Map<string, BrowserContext>();
  private creating = new Map<string, Promise<BrowserContext>>();
  private active: ResolvedBrowserEngine | null = null;
  // Bumped by stop(); a launch that completes under a stale generation closes
  // its browser instead of adopting it, so an engine swap or shutdown during
  // launch cannot leak a live Chromium the manager no longer tracks.
  private generation = 0;

  isAvailable(): boolean {
    return tryResolveBrowserEngine() !== null;
  }

  /** The engine backing the live browser, or the one the next launch will use. */
  activeEngine(): ResolvedBrowserEngine | null {
    return this.active ?? tryResolveBrowserEngine();
  }

  /** The isolated BrowserContext for one session scope, launching on demand. */
  context(scope: string): Promise<BrowserContext> {
    const existing = this.contexts.get(scope);
    if (existing && existing.browser()?.isConnected()) return Promise.resolve(existing);
    if (existing) this.contexts.delete(scope);
    // Concurrent verbs on one scope must share the same context, not race two
    // into existence and leak the loser.
    const pending = this.creating.get(scope);
    if (pending) return pending;
    const creation = this.createContext(scope).finally(() => {
      if (this.creating.get(scope) === creation) this.creating.delete(scope);
    });
    this.creating.set(scope, creation);
    return creation;
  }

  private async createContext(scope: string): Promise<BrowserContext> {
    const generation = this.generation;
    const browser = await this.ensureBrowser();
    if (generation !== this.generation) throw new Error("Browser was stopped during launch");
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
    });
    this.contexts.set(scope, context);
    context.once("close", () => {
      if (this.contexts.get(scope) === context) this.contexts.delete(scope);
    });
    return context;
  }

  /** Close one scope's context (cookies, storage, and pages go with it). */
  async releaseContext(scope: string): Promise<void> {
    const context = this.contexts.get(scope);
    this.contexts.delete(scope);
    if (context) await context.close().catch(() => undefined);
  }

  private ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return Promise.resolve(this.browser);
    if (this.launching) return this.launching;
    const generation = this.generation;
    this.launching = (async () => {
      // Throws a message naming the exact problem (missing override path, no
      // browser installed); browser-handlers surfaces it verbatim.
      const engine = resolveBrowserEngine();
      const proxy = this.proxy ?? (await startPinningProxy("pane"));
      if (generation !== this.generation) {
        await proxy.close().catch(() => undefined);
        throw new Error("Browser was stopped during launch");
      }
      this.proxy = proxy;
      const browser = await chromium.launch({
        executablePath: engine.path,
        headless: true,
        timeout: LAUNCH_TIMEOUT_MS,
        proxy: { server: proxy.url, bypass: "<-loopback>" },
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      });
      if (generation !== this.generation) {
        await browser.close().catch(() => undefined);
        throw new Error("Browser was stopped during launch");
      }
      this.browser = browser;
      this.active = engine;
      browser.once("disconnected", () => {
        if (this.browser === browser) {
          this.browser = null;
          this.active = null;
        }
      });
      return browser;
    })().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  stop(): void {
    this.generation += 1;
    const browser = this.browser;
    const proxy = this.proxy;
    const contexts = [...this.contexts.values()];
    this.browser = null;
    this.proxy = null;
    this.active = null;
    this.contexts.clear();
    void (async () => {
      for (const context of contexts) await context.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
      if (proxy) await proxy.close().catch(() => undefined);
    })();
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
