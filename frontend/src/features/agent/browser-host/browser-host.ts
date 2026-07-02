// Server-side CDP browser host: drives a real headless Chromium so the pi agent
// (and the visible panel) can navigate, read, interact, and screencast a page
// without the old renderer-bridge embedded webview.
//
// CDP client and snapshot approach adapted from Ghostex (MIT, maddada).
//
// Server-only: imported from API routes, never from client components.

import { delay } from "@/lib/async";
import { chromeManager } from "./chrome";
import { CLICK_SCRIPT, FILL_SCRIPT, SNAPSHOT_SCRIPT, type SnapshotResult } from "./dom-scripts";
import {
  HostedPage,
  type CdpTarget,
  type ConsoleEntry,
  type FrameSubscriber,
  type PageState,
  type ScreencastFrame,
  type StateSubscriber,
} from "./hosted-page";

export type { ConsoleEntry, PageState, ScreencastFrame };

const TEXT_CAP_BYTES = 500 * 1024;
const HTML_CAP_BYTES = 1024 * 1024;
const LOAD_EVENT_TIMEOUT_MS = 8_000;
const SNAPSHOT_LIMIT = 200;

// Stop compositing screencast frames once the panel stops polling for this long.
const POLL_IDLE_MS = 2_000;

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
    await delay(100);
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

function capString(value: string, maxBytes: number): string {
  return value.length > maxBytes ? value.slice(0, maxBytes) : value;
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
    // freshPage is a recovery path: the current active page is unusable ("Not
    // attached"). Close it so its CDP WebSocket doesn't leak — a new attach
    // below replaces it.
    const previous = this.activeId ? this.pages.get(this.activeId) : undefined;
    if (previous) {
      this.pages.delete(previous.id);
      previous.close();
    }
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
