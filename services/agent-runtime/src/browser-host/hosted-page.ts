import { randomUUID } from "node:crypto";
import { errors, type Page } from "playwright-core";

const CONSOLE_RING_SIZE = 1000;

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

type NavigationDirection = "back" | "forward" | "reload" | null;

export class HostedPage {
  readonly id = randomUUID();
  private consoleEntries: ConsoleEntry[] = [];
  private frameCapture: Promise<void> | null = null;
  private historyIndex = 0;
  private historyLength = 1;
  private historyInitialized = false;
  private navigationDirection: NavigationDirection = null;
  private lastUrl: string;
  private loading = false;
  latestFrame: ScreencastFrame | null = null;

  private constructor(private readonly playwrightPage: Page) {
    this.lastUrl = playwrightPage.url();
    this.bindEvents();
  }

  static attach(page: Page): HostedPage {
    return new HostedPage(page);
  }

  matches(page: Page): boolean {
    return this.playwrightPage === page;
  }

  get closed(): boolean {
    return this.playwrightPage.isClosed();
  }

  close(): void {
    if (!this.closed) void this.playwrightPage.close().catch(() => undefined);
  }

  private bindEvents(): void {
    this.playwrightPage.on("console", (message) => {
      this.pushConsole({
        timestamp: new Date().toISOString(),
        source: "console",
        level: message.type(),
        text: message.text(),
      });
    });
    this.playwrightPage.on("pageerror", (error) => {
      this.pushConsole({
        timestamp: new Date().toISOString(),
        source: "exception",
        level: "error",
        text: error.message,
      });
    });
    this.playwrightPage.on("crash", () => {
      this.pushConsole({
        timestamp: new Date().toISOString(),
        source: "browser",
        level: "error",
        text: "Page crashed",
      });
    });
    this.playwrightPage.on("framenavigated", (frame) => {
      if (frame !== this.playwrightPage.mainFrame()) return;
      const url = frame.url();
      if (url !== this.lastUrl) this.recordNavigation(url);
      this.loading = false;
    });
    this.playwrightPage.on("domcontentloaded", () => {
      this.loading = false;
    });
    this.playwrightPage.on("load", () => {
      this.loading = false;
    });
  }

  private recordNavigation(url: string): void {
    if (this.navigationDirection === "back") {
      this.historyIndex = Math.max(0, this.historyIndex - 1);
    } else if (this.navigationDirection === "forward") {
      this.historyIndex = Math.min(this.historyLength - 1, this.historyIndex + 1);
    } else if (this.navigationDirection !== "reload") {
      this.historyIndex += 1;
      this.historyLength = this.historyIndex + 1;
    }
    this.navigationDirection = null;
    this.lastUrl = url;
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleEntries.push(entry);
    if (this.consoleEntries.length > CONSOLE_RING_SIZE) {
      this.consoleEntries.splice(0, this.consoleEntries.length - CONSOLE_RING_SIZE);
    }
  }

  drainConsole(limit: number): ConsoleEntry[] {
    return this.consoleEntries.slice(Math.max(0, this.consoleEntries.length - limit));
  }

  async navigate(url: string, timeout: number): Promise<void> {
    this.loading = true;
    try {
      await this.playwrightPage.goto(url, { waitUntil: "domcontentloaded", timeout });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    } finally {
      this.loading = false;
    }
  }

  async goBack(timeout: number): Promise<void> {
    this.loading = true;
    this.navigationDirection = "back";
    try {
      await this.playwrightPage.goBack({ waitUntil: "domcontentloaded", timeout });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    } finally {
      this.loading = false;
      this.navigationDirection = null;
    }
  }

  async goForward(timeout: number): Promise<void> {
    this.loading = true;
    this.navigationDirection = "forward";
    try {
      await this.playwrightPage.goForward({ waitUntil: "domcontentloaded", timeout });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    } finally {
      this.loading = false;
      this.navigationDirection = null;
    }
  }

  async reload(timeout: number): Promise<void> {
    this.loading = true;
    this.navigationDirection = "reload";
    try {
      await this.playwrightPage.reload({ waitUntil: "domcontentloaded", timeout });
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    } finally {
      this.loading = false;
      this.navigationDirection = null;
    }
  }

  async text(): Promise<string> {
    return this.playwrightPage
      .locator("body")
      .innerText()
      .catch(() => "");
  }

  async html(): Promise<string> {
    return this.playwrightPage.content();
  }

  async click(selector: string): Promise<boolean> {
    const locator = this.playwrightPage.locator(selector).first();
    if ((await locator.count()) === 0) return false;
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    return true;
  }

  async fill(selector: string, value: string): Promise<boolean> {
    const locator = this.playwrightPage.locator(selector).first();
    if ((await locator.count()) === 0) return false;
    const tag = await locator.evaluate((element) => element.tagName);
    await locator.scrollIntoViewIfNeeded();
    if (tag === "SELECT") await locator.selectOption(value);
    else await locator.fill(value);
    return true;
  }

  pressKey(key: string): Promise<void> {
    return this.playwrightPage.keyboard.press(key);
  }

  async scroll(deltaX: number, deltaY: number): Promise<number> {
    return this.playwrightPage.evaluate(
      ({ x, y }) => {
        window.scrollBy(x, y);
        return window.scrollY;
      },
      { x: deltaX, y: deltaY },
    );
  }

  async screenshot(type: "png" | "jpeg", quality?: number): Promise<string> {
    const data = await this.playwrightPage.screenshot({
      type,
      ...(type === "jpeg" && quality ? { quality } : {}),
    });
    return data.toString("base64");
  }

  evaluate(expression: string): Promise<unknown> {
    return this.playwrightPage.evaluate(expression);
  }

  setViewport(width: number, height: number): Promise<void> {
    return this.playwrightPage.setViewportSize({
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  async dispatchMouse(input: {
    type: "down" | "up" | "move" | "wheel";
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
  }): Promise<void> {
    await this.playwrightPage.mouse.move(input.x, input.y);
    if (input.type === "down") {
      await this.playwrightPage.mouse.down({
        button: input.button ?? "left",
        clickCount: input.clickCount ?? 1,
      });
    } else if (input.type === "up") {
      await this.playwrightPage.mouse.up({
        button: input.button ?? "left",
        clickCount: input.clickCount ?? 1,
      });
    } else if (input.type === "wheel") {
      await this.playwrightPage.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0);
    }
  }

  async dispatchKey(input: {
    type: "down" | "up" | "char";
    key: string;
    text?: string;
  }): Promise<void> {
    if (input.type === "down") await this.playwrightPage.keyboard.down(input.key);
    else if (input.type === "up") await this.playwrightPage.keyboard.up(input.key);
    else await this.playwrightPage.keyboard.insertText(input.text ?? input.key);
  }

  async captureFrame(): Promise<ScreencastFrame | null> {
    if (this.closed) return null;
    if (!this.frameCapture) {
      this.frameCapture = this.screenshot("jpeg", 60)
        .then((data) => {
          const frame = { data, metadata: {} };
          this.latestFrame = frame;
        })
        .finally(() => {
          this.frameCapture = null;
        });
    }
    await this.frameCapture;
    return this.latestFrame;
  }

  private async initializeHistory(): Promise<void> {
    if (this.historyInitialized) return;
    const length = await this.playwrightPage.evaluate(() => window.history.length).catch(() => 1);
    this.historyLength = Math.max(1, length);
    this.historyIndex = this.historyLength - 1;
    this.historyInitialized = true;
  }

  async readState(): Promise<PageState> {
    await this.initializeHistory();
    return {
      url: this.playwrightPage.url(),
      title: await this.playwrightPage.title().catch(() => ""),
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.historyLength - 1,
      loading: this.loading,
    };
  }
}
