import { Effect, Semaphore } from "effect";
import type { Page } from "playwright-core";
import {
  browserNavigation,
  type BrowserNetworkMode,
} from "../../../../shared/agent/sanitize-embedded-browser-url";
import { getGlobalSingleton } from "../instances";
import { HostedPage, type PageState, type ScreencastFrame } from "./hosted-page";
import { playwrightManager, type ManagedPlaywrightSession } from "./playwright";

export type { PageState, ScreencastFrame };

const TEXT_CAP_BYTES = 500 * 1024;
const HTML_CAP_BYTES = 1024 * 1024;
const NAVIGATION_TIMEOUT_MS = 8_000;

const normalizeUrl = (value: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

const capString = (value: string, maximum: number): string =>
  value.length > maximum ? value.slice(0, maximum) : value;

export type BrowserContextSurface<RawPage> = {
  newPage: () => Promise<RawPage>;
  pages: () => RawPage[];
};

export type BrowserPage<RawPage> = {
  captureFrame: () => Promise<ScreencastFrame | null>;
  click: (selector: string) => Promise<boolean>;
  close: () => void;
  readonly closed: boolean;
  dispatchKey: (input: KeyInput) => Promise<void>;
  dispatchMouse: (input: MouseInput) => Promise<void>;
  evaluate: (expression: string) => Promise<unknown>;
  fill: (selector: string, value: string) => Promise<boolean>;
  goBack: (timeout: number) => Promise<void>;
  goForward: (timeout: number) => Promise<void>;
  html: () => Promise<string>;
  readonly id: string;
  matches: (page: RawPage) => boolean;
  navigate: (url: string, timeout: number) => Promise<void>;
  readState: () => Promise<PageState>;
  reload: (timeout: number) => Promise<void>;
  screenshot: (type: "png" | "jpeg", quality?: number) => Promise<string>;
  scroll: (deltaX: number, deltaY: number) => Promise<number>;
  setViewport: (width: number, height: number) => Promise<void>;
  text: () => Promise<string>;
};

export type BrowserHostManager<RawPage> = {
  ensure: (
    mode: BrowserNetworkMode,
  ) => Promise<ManagedPlaywrightSession<BrowserContextSurface<RawPage>>>;
  isAvailable: () => boolean;
  stop: () => Promise<void>;
};

export type BrowserHostOptions<RawPage> = {
  attachPage: (page: RawPage) => BrowserPage<RawPage>;
};

export class BrowserHost<RawPage> {
  private pages = new Map<string, BrowserPage<RawPage>>();
  private activeId: string | null = null;
  private activeGeneration = 0;
  private activeMode: BrowserNetworkMode | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private readonly navigationLock = Semaphore.makeUnsafe(1);
  private readonly transitionLock = Semaphore.makeUnsafe(1);

  private readonly attachPage: (page: RawPage) => BrowserPage<RawPage>;

  constructor(
    private readonly manager: BrowserHostManager<RawPage>,
    { attachPage }: BrowserHostOptions<RawPage>,
  ) {
    this.attachPage = attachPage;
  }

  isAvailable(): boolean {
    return this.manager.isAvailable();
  }

  async page(pageId?: string): Promise<BrowserPage<RawPage>> {
    return this.pageForMode(this.activeMode ?? "public", pageId);
  }

  private pageForMode(mode: BrowserNetworkMode, pageId?: string): Promise<BrowserPage<RawPage>> {
    return this.withPermit(this.transitionLock, () => this.pageUnlocked(mode, pageId));
  }

  private async pageUnlocked(
    mode: BrowserNetworkMode,
    pageId?: string,
  ): Promise<BrowserPage<RawPage>> {
    this.assertRunning();
    const session = await this.manager.ensure(mode);
    this.assertRunning();
    if (session.generation !== this.activeGeneration) {
      this.pages.clear();
      this.activeId = null;
      this.activeGeneration = session.generation;
      this.activeMode = session.mode;
    }
    const targetId = pageId ?? this.activeId;
    const cached = targetId ? this.pages.get(targetId) : undefined;
    if (cached && !cached.closed) {
      this.activeId = cached.id;
      return cached;
    }
    if (cached) this.pages.delete(cached.id);

    const rawPage =
      session.context
        .pages()
        .find((candidate) =>
          Array.from(this.pages.values()).every((hosted) => !hosted.matches(candidate)),
        ) ?? (await session.context.newPage());
    this.assertRunning();
    const hosted = this.attachPage(rawPage);
    this.pages.set(hosted.id, hosted);
    this.activeId = hosted.id;
    return hosted;
  }

  async navigate(url: string, pageId?: string): Promise<{ url: string; title: string }> {
    const navigation = browserNavigation(normalizeUrl(url));
    if (!navigation) throw new Error("Browser network policy blocked navigation URL");
    return this.withPermit(this.navigationLock, async () => {
      const page = await this.pageForMode(navigation.mode, pageId);
      await page.navigate(navigation.url, NAVIGATION_TIMEOUT_MS);
      const state = await page.readState();
      return { url: state.url, title: state.title };
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
    await (await this.page(pageId)).goBack(NAVIGATION_TIMEOUT_MS);
  }

  async goForward(pageId?: string): Promise<void> {
    await (await this.page(pageId)).goForward(NAVIGATION_TIMEOUT_MS);
  }

  async reload(pageId?: string): Promise<void> {
    await (await this.page(pageId)).reload(NAVIGATION_TIMEOUT_MS);
  }

  async getText(pageId?: string): Promise<string> {
    return capString(await (await this.page(pageId)).text(), TEXT_CAP_BYTES);
  }

  async getHtml(pageId?: string): Promise<string> {
    return capString(await (await this.page(pageId)).html(), HTML_CAP_BYTES);
  }

  async evaluate(expression: string, pageId?: string): Promise<unknown> {
    return (await this.page(pageId)).evaluate(expression);
  }

  async click(args: { selector: string }, pageId?: string): Promise<{ found: boolean }> {
    const page = await this.page(pageId);
    return { found: await page.click(args.selector) };
  }

  async fill(
    args: { selector: string; value: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    const page = await this.page(pageId);
    return { found: await page.fill(args.selector, args.value) };
  }

  async scroll(
    args: { deltaY: number; deltaX?: number },
    pageId?: string,
  ): Promise<{ deltaX: number; deltaY: number; scrollY: number }> {
    const deltaY = clampDelta(args.deltaY);
    const deltaX = clampDelta(args.deltaX ?? 0);
    const scrollY = await (await this.page(pageId)).scroll(deltaX, deltaY);
    return { deltaX, deltaY, scrollY };
  }

  async screenshot(pageId?: string): Promise<string> {
    const data = await (await this.page(pageId)).screenshot("png");
    return `data:image/png;base64,${data}`;
  }

  async setViewport(width: number, height: number, pageId?: string): Promise<void> {
    await (await this.page(pageId)).setViewport(width, height);
  }

  async pollFrame(pageId?: string): Promise<{ frame: ScreencastFrame | null; state: PageState }> {
    const page = await this.page(pageId);
    const [frame, state] = await Promise.all([page.captureFrame(), page.readState()]);
    return { frame, state };
  }

  async dispatchMouse(args: MouseInput, pageId?: string): Promise<void> {
    await (await this.page(pageId)).dispatchMouse(args);
  }

  async dispatchKey(args: KeyInput, pageId?: string): Promise<void> {
    await (await this.page(pageId)).dispatchKey(args);
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = this.withPermit(this.transitionLock, async () => {
      this.pages.clear();
      this.activeId = null;
      this.activeMode = null;
      await this.manager.stop();
    });
    return this.stopping;
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error("Browser host stopped");
  }

  private withPermit<A>(semaphore: Semaphore.Semaphore, task: () => Promise<A>): Promise<A> {
    return Effect.runPromise(
      semaphore.withPermit(Effect.tryPromise({ try: task, catch: (error) => error })),
    );
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

const clampDelta = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-10_000, Math.min(10_000, Math.trunc(value)));
};

export const browserHost = getGlobalSingleton(
  "browserHost",
  () => new BrowserHost(playwrightManager, { attachPage: HostedPage.attach }),
);
