import { getGlobalSingleton } from "../instances";
import { HostedPage, type PageState, type ScreencastFrame } from "./hosted-page";
import { playwrightManager } from "./playwright";

export type { PageState, ScreencastFrame };

const TEXT_CAP_BYTES = 500 * 1024;
const HTML_CAP_BYTES = 1024 * 1024;
const NAVIGATION_TIMEOUT_MS = 8_000;

const normalizeUrl = (value: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

const capString = (value: string, maximum: number): string =>
  value.length > maximum ? value.slice(0, maximum) : value;

class BrowserHost {
  private pages = new Map<string, HostedPage>();
  private activeId: string | null = null;

  isAvailable(): boolean {
    return playwrightManager.isAvailable();
  }

  async page(pageId?: string): Promise<HostedPage> {
    const targetId = pageId ?? this.activeId;
    const cached = targetId ? this.pages.get(targetId) : undefined;
    if (cached && !cached.closed) {
      this.activeId = cached.id;
      return cached;
    }
    if (cached) this.pages.delete(cached.id);

    const context = await playwrightManager.ensure();
    const rawPage =
      context
        .pages()
        .find((candidate) =>
          Array.from(this.pages.values()).every((hosted) => !hosted.matches(candidate)),
        ) ?? (await context.newPage());
    const hosted = HostedPage.attach(rawPage);
    this.pages.set(hosted.id, hosted);
    this.activeId = hosted.id;
    return hosted;
  }

  async navigate(url: string, pageId?: string): Promise<{ url: string; title: string }> {
    const page = await this.page(pageId);
    await page.navigate(normalizeUrl(url), NAVIGATION_TIMEOUT_MS);
    const state = await page.readState();
    return { url: state.url, title: state.title };
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

  stop(): void {
    for (const page of this.pages.values()) page.close();
    this.pages.clear();
    this.activeId = null;
    playwrightManager.stop();
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

export const browserHost = getGlobalSingleton("browserHost", () => new BrowserHost());
