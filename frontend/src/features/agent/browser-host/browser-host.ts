// Server-side CDP browser host: drives a real headless Chromium so the pi agent
// (and the visible panel) can navigate, read, interact, and screencast a page
// without the old renderer-bridge embedded webview.
//
// CDP client and snapshot approach adapted from Ghostex (MIT, maddada).
//
// Server-only: imported from API routes, never from client components.

import { chromeManager } from "./chrome";
import { CdpClient, type CdpEvent } from "./cdp";
import {
  CLICK_SCRIPT,
  FILL_SCRIPT,
  SNAPSHOT_SCRIPT,
  type SnapshotElement,
  type SnapshotResult,
} from "./dom-scripts";

const TEXT_CAP_BYTES = 500 * 1024;
const HTML_CAP_BYTES = 1024 * 1024;
const LOAD_EVENT_TIMEOUT_MS = 8_000;
const CONSOLE_RING_SIZE = 1000;
const SNAPSHOT_LIMIT = 200;

export type ConsoleEntry = {
  timestamp: string;
  source: "console" | "exception" | "browser";
  level: string;
  text: string;
};

export type PageState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

export type ScreencastFrame = { data: string; metadata: Record<string, unknown> };
type FrameSubscriber = (frame: ScreencastFrame) => void;
type StateSubscriber = (state: PageState) => void;

// Stop compositing screencast frames once the panel stops polling for this long.
const POLL_IDLE_MS = 2_000;

type CdpTarget = {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
};

// Discover the headless Chromium's page targets over its HTTP control endpoint.
// A freshly launched browser can briefly report zero pages, so we poll a few
// times before giving up.
async function fetchTargets(port: number): Promise<CdpTarget[]> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Chromium /json returned HTTP ${response.status}`);
    const targets = (await response.json()) as CdpTarget[];
    const pages = Array.isArray(targets) ? targets.filter((target) => target.type === "page") : [];
    if (pages.length > 0 || attempt === 9) return pages;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

async function createBlankPage(port: number): Promise<CdpTarget> {
  // Newer Chromium requires PUT for /json/new (GET is blocked). The created
  // target must be a page with its own page-level WebSocket — never the
  // browser endpoint, which rejects Page.* with "Not attached to an active page".
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Chromium /json/new returned HTTP ${response.status}`);
  const created = (await response.json()) as CdpTarget;
  if (created.type !== "page" || !created.webSocketDebuggerUrl) {
    throw new Error("Chromium did not return a navigable page");
  }
  return created;
}

function normalizeUrl(value: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

function remoteObjectText(value: unknown): string {
  const object = value as { value?: unknown; description?: string; type?: string } | undefined;
  if (!object) return "";
  if (Object.hasOwn(object, "value")) {
    return typeof object.value === "string" ? object.value : JSON.stringify(object.value);
  }
  return object.description ?? object.type ?? "";
}

function capString(value: string, maxBytes: number): string {
  return value.length > maxBytes ? value.slice(0, maxBytes) : value;
}

// Wraps a single CDP page connection: console ring, ref map, screencast fanout.
class HostedPage {
  readonly id: string;
  private client: CdpClient;
  private console: ConsoleEntry[] = [];
  private refMap = new Map<string, string>();
  private captureEnabled = false;
  private frameSubscribers = new Set<FrameSubscriber>();
  private stateSubscribers = new Set<StateSubscriber>();
  private screencasting = false;
  private screencastListenersBound = false;
  // The in-flight (or settled) Page.startScreencast + seed promise. pollFrame
  // awaits it so the very first poll returns a seeded frame instead of null.
  private screencastReady: Promise<void> | null = null;
  latestFrame: ScreencastFrame | null = null;

  private constructor(id: string, client: CdpClient) {
    this.id = id;
    this.client = client;
  }

  static async attach(target: CdpTarget, timeoutMs: number): Promise<HostedPage> {
    const client = await CdpClient.connect(target.webSocketDebuggerUrl as string, timeoutMs);
    const page = new HostedPage(target.id, client);
    await page.enableCapture();
    return page;
  }

  get closed(): boolean {
    return this.client.closed;
  }

  close(): void {
    this.client.close();
  }

  private async enableCapture(): Promise<void> {
    if (this.captureEnabled) return;
    await this.client.call("Runtime.enable");
    await this.client.call("Log.enable");
    await this.client.call("Page.enable");
    this.client.on("Runtime.consoleAPICalled", (event) => this.recordConsole(event));
    this.client.on("Runtime.exceptionThrown", (event) => this.recordException(event));
    this.client.on("Log.entryAdded", (event) => this.recordLog(event));
    this.captureEnabled = true;
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.console.push(entry);
    if (this.console.length > CONSOLE_RING_SIZE) {
      this.console.splice(0, this.console.length - CONSOLE_RING_SIZE);
    }
  }

  private recordConsole(event: CdpEvent): void {
    const args = (event.params?.args as unknown[]) ?? [];
    this.pushConsole({
      timestamp: new Date().toISOString(),
      source: "console",
      level: (event.params?.type as string) ?? "log",
      text: args.map(remoteObjectText).join(" "),
    });
  }

  private recordException(event: CdpEvent): void {
    const details = event.params?.exceptionDetails as { text?: string } | undefined;
    this.pushConsole({
      timestamp: new Date().toISOString(),
      source: "exception",
      level: "error",
      text: details?.text ?? "JavaScript exception",
    });
  }

  private recordLog(event: CdpEvent): void {
    const entry = event.params?.entry as { level?: string; text?: string } | undefined;
    this.pushConsole({
      timestamp: new Date().toISOString(),
      source: "browser",
      level: entry?.level ?? "info",
      text: entry?.text ?? "",
    });
  }

  drainConsole(limit: number): ConsoleEntry[] {
    return this.console.slice(Math.max(0, this.console.length - limit));
  }

  setRefMap(elements: SnapshotElement[]): void {
    this.refMap.clear();
    for (const element of elements) {
      if (element.ref && element.selector) this.refMap.set(element.ref, element.selector);
    }
  }

  resolveRef(ref: string): string | null {
    return this.refMap.get(ref) ?? null;
  }

  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.client.call(method, params);
  }

  // Invoke a page-realm script (an arrow-function string from dom-scripts.ts)
  // with JSON-serializable args. Throws on an exception inside the page.
  async invokeScript<T>(script: string, args: unknown[]): Promise<T> {
    const expression = `(${script})(...${JSON.stringify(args)})`;
    const result = await this.client.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = (result as { exceptionDetails?: { exception?: { description?: string } } })
      .exceptionDetails;
    if (exception) throw new Error(exception.exception?.description ?? "Browser evaluation failed");
    return (result.result as { value?: T } | undefined)?.value as T;
  }

  // Screencast fanout. The first frame subscriber starts Page.startScreencast;
  // the last one to leave stops it. Returns the unsubscribe alongside a promise
  // that resolves once the screencast is started and seeded, so a poller can
  // await a first frame.
  subscribeFrames(callback: FrameSubscriber): { unsubscribe: () => void; ready: Promise<void> } {
    this.frameSubscribers.add(callback);
    const ready = this.ensureScreencast();
    return {
      ready,
      unsubscribe: () => {
        this.frameSubscribers.delete(callback);
        if (this.frameSubscribers.size === 0) void this.stopScreencast();
      },
    };
  }

  subscribeState(callback: StateSubscriber): () => void {
    this.stateSubscribers.add(callback);
    return () => {
      this.stateSubscribers.delete(callback);
    };
  }

  // One-shot-friendly load listener (Page.enable is already on from capture).
  subscribeLoad(callback: () => void): () => void {
    return this.client.on("Page.loadEventFired", callback);
  }

  private bindScreencastListeners(): void {
    if (this.screencastListenersBound) return;
    this.screencastListenersBound = true;
    this.client.on("Page.screencastFrame", (event) => this.onScreencastFrame(event));
    this.client.on("Page.frameNavigated", () => void this.emitState());
    this.client.on("Page.loadEventFired", () => void this.emitState());
  }

  private onScreencastFrame(event: CdpEvent): void {
    const data = event.params?.data as string | undefined;
    const sessionId = event.params?.sessionId as number | undefined;
    if (typeof sessionId === "number") {
      void this.client.call("Page.screencastFrameAck", { sessionId }).catch(() => {});
    }
    if (typeof data !== "string") return;
    const frame: ScreencastFrame = {
      data,
      metadata: (event.params?.metadata as Record<string, unknown>) ?? {},
    };
    this.latestFrame = frame;
    for (const subscriber of this.frameSubscribers) subscriber(frame);
  }

  private async emitState(): Promise<void> {
    if (this.stateSubscribers.size === 0) return;
    try {
      const state = await this.readState();
      for (const subscriber of this.stateSubscribers) subscriber(state);
    } catch {
      // Page may be navigating; the next event will carry fresh state.
    }
  }

  private ensureScreencast(): Promise<void> {
    if (this.screencastReady) return this.screencastReady;
    this.screencasting = true;
    this.bindScreencastListeners();
    this.screencastReady = (async () => {
      await this.client.call("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 2,
      });
      // everyNthFrame: 2 skips the first composite, so a fully idle page would
      // never emit a frame. Seed latestFrame + subscribers with one immediate
      // capture so the panel always has something to render on connect.
      await this.seedScreencastFrame();
    })().catch(() => {
      // Let the next subscribe retry from scratch if startup failed.
      this.screencasting = false;
      this.screencastReady = null;
    });
    return this.screencastReady;
  }

  private async seedScreencastFrame(): Promise<void> {
    try {
      const result = (await this.client.call("Page.captureScreenshot", {
        format: "jpeg",
        quality: 60,
        fromSurface: true,
      })) as { data?: string };
      if (!result.data) return;
      const frame: ScreencastFrame = { data: result.data, metadata: {} };
      this.latestFrame = frame;
      for (const subscriber of this.frameSubscribers) subscriber(frame);
    } catch {
      // A live screencast frame will follow on the next composite.
    }
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencasting) return;
    this.screencasting = false;
    this.screencastReady = null;
    await this.client.call("Page.stopScreencast").catch(() => {});
  }

  async readState(): Promise<PageState> {
    const history = (await this.client.call("Page.getNavigationHistory")) as {
      currentIndex: number;
      entries: { url: string; title: string }[];
    };
    const current = history.entries[history.currentIndex];
    return {
      url: current?.url ?? "",
      title: current?.title ?? "",
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
      loading: false,
    };
  }
}

// Top-level manager: owns the active page id, a per-page cache with
// reconnect-when-closed, and the exported tool surface.
class BrowserHost {
  private pages = new Map<string, HostedPage>();
  private activeId: string | null = null;
  private timeoutMs = 10_000;

  isAvailable(): boolean {
    return chromeManager.isAvailable();
  }

  private async port(): Promise<number> {
    const proc = await chromeManager.ensure();
    return proc.port;
  }

  // Resolve a hosted page, reconnecting if the cached client closed. With no
  // pageId, picks the active page, then the first target, creating one if none.
  async page(pageId?: string): Promise<HostedPage> {
    const port = await this.port();
    const targetId = pageId ?? this.activeId;
    const cached = targetId ? this.pages.get(targetId) : undefined;
    if (cached && !cached.closed) {
      this.activeId = cached.id;
      return cached;
    }
    if (cached) this.pages.delete(cached.id);
    const target = await this.resolveTarget(port, targetId);
    const hosted = await HostedPage.attach(target, this.timeoutMs);
    this.pages.set(hosted.id, hosted);
    this.activeId = hosted.id;
    return hosted;
  }

  private async resolveTarget(port: number, targetId: string | null): Promise<CdpTarget> {
    const targets = await fetchTargets(port);
    const navigable = targets.filter((target) =>
      target.webSocketDebuggerUrl?.includes("/devtools/page/"),
    );
    const match = targetId ? navigable.find((target) => target.id === targetId) : navigable[0];
    const target = match ?? navigable[0];
    if (target) return target;
    return createBlankPage(port);
  }

  async ensurePage(): Promise<HostedPage> {
    return this.page();
  }

  async navigate(url: string, pageId?: string): Promise<{ url: string; title: string }> {
    try {
      return await this.navigateOnce(await this.page(pageId), url);
    } catch (error) {
      // A target discovered at launch can briefly report "Not attached to an
      // active page"; recover by opening a fresh tab and retrying once.
      if (!String(error).includes("Not attached")) throw error;
      return this.navigateOnce(await this.freshPage(), url);
    }
  }

  private async navigateOnce(
    page: HostedPage,
    url: string,
  ): Promise<{ url: string; title: string }> {
    const loaded = this.waitForLoad(page);
    await page.call("Page.navigate", { url: normalizeUrl(url) });
    await loaded;
    const state = await page.readState();
    return { url: state.url, title: state.title };
  }

  private async freshPage(): Promise<HostedPage> {
    const port = await this.port();
    const target = await createBlankPage(port);
    const hosted = await HostedPage.attach(target, this.timeoutMs);
    this.pages.set(hosted.id, hosted);
    this.activeId = hosted.id;
    return hosted;
  }

  private waitForLoad(page: HostedPage): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        dispose();
        resolve();
      }, LOAD_EVENT_TIMEOUT_MS);
      const off = page.subscribeLoad(() => {
        clearTimeout(timer);
        dispose();
        resolve();
      });
      const dispose = () => off();
    });
  }

  async getUrl(pageId?: string): Promise<{ url: string; title: string }> {
    const state = await (await this.page(pageId)).readState();
    return { url: state.url, title: state.title };
  }

  async getState(pageId?: string): Promise<PageState> {
    return (await this.page(pageId)).readState();
  }

  async goBack(pageId?: string): Promise<void> {
    await this.navigateHistory(pageId, -1);
  }

  async goForward(pageId?: string): Promise<void> {
    await this.navigateHistory(pageId, 1);
  }

  private async navigateHistory(pageId: string | undefined, direction: -1 | 1): Promise<void> {
    const page = await this.page(pageId);
    const history = (await page.call("Page.getNavigationHistory")) as {
      currentIndex: number;
      entries: { id: number }[];
    };
    const target = history.entries[history.currentIndex + direction];
    if (target) await page.call("Page.navigateToHistoryEntry", { entryId: target.id });
  }

  async reload(pageId?: string): Promise<void> {
    await (await this.page(pageId)).call("Page.reload", {});
  }

  async getText(pageId?: string): Promise<string> {
    const value = await this.evaluateRaw("document.body ? document.body.innerText : ''", pageId);
    return capString(typeof value === "string" ? value : "", TEXT_CAP_BYTES);
  }

  async getHtml(pageId?: string): Promise<string> {
    const value = await this.evaluateRaw(
      "document.documentElement ? document.documentElement.outerHTML : ''",
      pageId,
    );
    return capString(typeof value === "string" ? value : "", HTML_CAP_BYTES);
  }

  async snapshot(pageId?: string): Promise<SnapshotResult> {
    const page = await this.page(pageId);
    const result = await page.invokeScript<SnapshotResult>(SNAPSHOT_SCRIPT, [SNAPSHOT_LIMIT]);
    page.setRefMap(result.elements);
    return result;
  }

  async click(
    args: { selector?: string; ref?: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    const page = await this.page(pageId);
    const selector = this.resolveSelector(page, args);
    return page.invokeScript<{ found: boolean }>(CLICK_SCRIPT, [selector]);
  }

  async fill(
    args: { selector?: string; ref?: string; value: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    const page = await this.page(pageId);
    const selector = this.resolveSelector(page, args);
    return page.invokeScript<{ found: boolean }>(FILL_SCRIPT, [selector, args.value]);
  }

  private resolveSelector(page: HostedPage, args: { selector?: string; ref?: string }): string {
    if (args.selector) return args.selector;
    if (!args.ref) throw new Error("selector or ref required");
    const selector = page.resolveRef(args.ref);
    if (!selector) throw new Error("ref stale — re-snapshot");
    return selector;
  }

  async pressKey(key: string, pageId?: string): Promise<void> {
    const page = await this.page(pageId);
    const event = keyEvent(key);
    await page.call("Input.dispatchKeyEvent", { ...event, type: "keyDown" });
    await page.call("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
  }

  // Agent-facing scroll. Uses window.scrollBy via Runtime.evaluate rather than
  // Input.dispatchMouseEvent(mouseWheel): in headless Chromium the synthetic
  // wheel event can hang the input pipeline (especially after a key event), and
  // scrollBy also lets us return the resulting scrollY the old contract exposes.
  // The panel's true wheel forwarding still uses dispatchMouse below.
  async scroll(
    args: { deltaY: number; deltaX?: number },
    pageId?: string,
  ): Promise<{ deltaX: number; deltaY: number; scrollY: number }> {
    const deltaY = clampDelta(args.deltaY);
    const deltaX = clampDelta(args.deltaX ?? 0);
    const scrollY = await this.evaluateRaw(
      `window.scrollBy(${deltaX}, ${deltaY}); window.scrollY`,
      pageId,
    );
    return { deltaX, deltaY, scrollY: typeof scrollY === "number" ? scrollY : 0 };
  }

  async screenshot(pageId?: string): Promise<string> {
    const page = await this.page(pageId);
    const result = (await page.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    })) as { data?: string };
    return `data:image/png;base64,${result.data ?? ""}`;
  }

  async evaluate(expression: string, pageId?: string): Promise<unknown> {
    return this.evaluateRaw(expression, pageId);
  }

  private async evaluateRaw(expression: string, pageId?: string): Promise<unknown> {
    const page = await this.page(pageId);
    const result = await page.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = (result as { exceptionDetails?: { text?: string } }).exceptionDetails;
    if (exception) throw new Error(exception.text ?? "Browser evaluation failed");
    const object = result.result as { value?: unknown } | undefined;
    return object?.value;
  }

  async consoleLogs(limit = 200, pageId?: string): Promise<ConsoleEntry[]> {
    return (await this.page(pageId)).drainConsole(limit);
  }

  async setViewport(width: number, height: number, pageId?: string): Promise<void> {
    await (
      await this.page(pageId)
    ).call("Page.setDeviceMetricsOverride", {
      width: Math.round(width),
      height: Math.round(height),
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  // Screencast bridge for the visible panel.
  async startScreencast(onFrame: FrameSubscriber, pageId?: string): Promise<() => void> {
    return (await this.page(pageId)).subscribeFrames(onFrame).unsubscribe;
  }

  async subscribeState(onState: StateSubscriber, pageId?: string): Promise<() => void> {
    return (await this.page(pageId)).subscribeState(onState);
  }

  async latestFrame(pageId?: string): Promise<ScreencastFrame | null> {
    return (await this.page(pageId)).latestFrame;
  }

  // Poll bridge for the visible panel. Next's standalone server buffers
  // locally-built SSE streams, so the panel polls this instead of subscribing.
  // A poll keeps the screencast running via a self-renewing frame subscription
  // that auto-stops once polling lapses (POLL_IDLE_MS) — Chrome stops
  // compositing screencast frames when nobody is watching.
  private pollUnsubscribe: (() => void) | null = null;
  private pollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  async pollFrame(pageId?: string): Promise<{ frame: ScreencastFrame | null; state: PageState }> {
    const page = await this.page(pageId);
    if (!this.pollUnsubscribe) {
      // A no-op subscriber is enough to make the page start Page.startScreencast;
      // we read latestFrame rather than receiving pushes. Await the screencast
      // seed so this first poll already carries a frame instead of null.
      const { unsubscribe, ready } = page.subscribeFrames(() => undefined);
      this.pollUnsubscribe = unsubscribe;
      await ready;
    }
    if (this.pollIdleTimer) clearTimeout(this.pollIdleTimer);
    this.pollIdleTimer = setTimeout(() => {
      this.pollUnsubscribe?.();
      this.pollUnsubscribe = null;
      this.pollIdleTimer = null;
    }, POLL_IDLE_MS);
    return { frame: page.latestFrame, state: await page.readState() };
  }

  async dispatchMouse(args: MouseInput, pageId?: string): Promise<void> {
    const page = await this.page(pageId);
    await page.call("Input.dispatchMouseEvent", mouseEvent(args));
  }

  async dispatchKey(args: KeyInput, pageId?: string): Promise<void> {
    const page = await this.page(pageId);
    await page.call("Input.dispatchKeyEvent", {
      type: args.type === "char" ? "char" : args.type === "down" ? "keyDown" : "keyUp",
      key: args.key,
      code: args.code,
      ...(args.text ? { text: args.text } : {}),
    });
  }

  stop(): void {
    for (const page of this.pages.values()) page.close();
    this.pages.clear();
    this.activeId = null;
    chromeManager.stop();
  }
}

export type MouseInput = {
  type: "down" | "up" | "move" | "wheel";
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
};

export type KeyInput = { type: "down" | "up" | "char"; key: string; code: string; text?: string };

function mouseEvent(args: MouseInput): Record<string, unknown> {
  const cdpType =
    args.type === "down"
      ? "mousePressed"
      : args.type === "up"
        ? "mouseReleased"
        : args.type === "wheel"
          ? "mouseWheel"
          : "mouseMoved";
  return {
    type: cdpType,
    x: args.x,
    y: args.y,
    button: args.button ?? "left",
    clickCount: args.clickCount ?? (args.type === "down" || args.type === "up" ? 1 : 0),
    ...(args.type === "wheel" ? { deltaX: args.deltaX ?? 0, deltaY: args.deltaY ?? 0 } : {}),
  };
}

function clampDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-10_000, Math.min(10_000, Math.trunc(value)));
}

const SPECIAL_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> =
  {
    Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
    Tab: { key: "Tab", code: "Tab", keyCode: 9, text: "\t" },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  };

function keyEvent(key: string): Record<string, unknown> {
  const special = SPECIAL_KEYS[key];
  if (special) {
    return {
      key: special.key,
      code: special.code,
      windowsVirtualKeyCode: special.keyCode,
      nativeVirtualKeyCode: special.keyCode,
      ...(special.text ? { text: special.text } : {}),
    };
  }
  const text = key.length === 1 ? key : "";
  return {
    key,
    code: text ? `Key${key.toUpperCase()}` : key,
    text,
    windowsVirtualKeyCode: text ? key.toUpperCase().charCodeAt(0) : 0,
  };
}

const globalForHost = globalThis as typeof globalThis & { __localStudioBrowserHost?: BrowserHost };
export const browserHost = globalForHost.__localStudioBrowserHost ?? new BrowserHost();
globalForHost.__localStudioBrowserHost = browserHost;
