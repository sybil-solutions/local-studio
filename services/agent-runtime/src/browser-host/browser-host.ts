import { getGlobalSingleton } from "../instances";
import { HostedPage, type PageState, type ScreencastFrame } from "./hosted-page";
import { playwrightManager } from "./playwright";

export type { PageState, ScreencastFrame };

const TEXT_CAP_BYTES = 500 * 1024;
const HTML_CAP_BYTES = 1024 * 1024;
const NAVIGATION_TIMEOUT_MS = 8_000;

// One isolated BrowserContext per agent session, so cookies, storage, and open
// pages never leak between sessions. The cua extension stamps every verb with
// its session id; panel routes (frame poll, input, viewport, state) carry no
// session and follow whichever session acted last — the panel is a window onto
// the browser the model is driving, exactly as before, and verbs without any
// session id land in a shared scope.
const SHARED_SESSION = "shared";
const MAX_SESSIONS = 8;
const IDLE_SESSION_MS = 15 * 60_000;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** A usable per-session scope key, or null when the value is absent/invalid. */
export function normalizeBrowserSessionKey(value: unknown): string | null {
  return typeof value === "string" && SESSION_KEY_PATTERN.test(value) ? value : null;
}

const normalizeUrl = (value: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

const capString = (value: string, maximum: number): string =>
  value.length > maximum ? value.slice(0, maximum) : value;

type SessionState = {
  pages: Map<string, HostedPage>;
  activeId: string | null;
  lastUsedAt: number;
};

class BrowserHost {
  private sessions = new Map<string, SessionState>();
  private activeSessionKey = SHARED_SESSION;

  isAvailable(): boolean {
    return playwrightManager.isAvailable();
  }

  private sessionState(key: string): SessionState {
    this.sweepIdleSessions();
    let state = this.sessions.get(key);
    if (!state) {
      this.evictOverflow();
      state = { pages: new Map(), activeId: null, lastUsedAt: Date.now() };
      this.sessions.set(key, state);
    }
    state.lastUsedAt = Date.now();
    this.activeSessionKey = key;
    return state;
  }

  private sweepIdleSessions(): void {
    const now = Date.now();
    for (const [key, state] of this.sessions) {
      if (key === this.activeSessionKey) continue;
      if (now - state.lastUsedAt > IDLE_SESSION_MS) void this.teardownSession(key, state);
    }
  }

  private evictOverflow(): void {
    while (this.sessions.size >= MAX_SESSIONS) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, state] of this.sessions) {
        if (key === this.activeSessionKey) continue;
        if (state.lastUsedAt < oldestAt) {
          oldestAt = state.lastUsedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      const state = this.sessions.get(oldestKey);
      if (state) void this.teardownSession(oldestKey, state);
    }
  }

  private async teardownSession(key: string, state: SessionState): Promise<void> {
    this.sessions.delete(key);
    for (const page of state.pages.values()) page.close();
    state.pages.clear();
    await playwrightManager.releaseContext(key).catch(() => undefined);
  }

  /** Close one session's browser context; used when the session ends. */
  async closeSession(sessionKey: string): Promise<void> {
    const key = normalizeBrowserSessionKey(sessionKey);
    if (!key) return;
    const state = this.sessions.get(key);
    if (state) await this.teardownSession(key, state);
    if (this.activeSessionKey === key) this.activeSessionKey = SHARED_SESSION;
  }

  private async page(session?: string, pageId?: string): Promise<HostedPage> {
    const key = session ?? this.activeSessionKey;
    const state = this.sessionState(key);
    const targetId = pageId ?? state.activeId;
    const cached = targetId ? state.pages.get(targetId) : undefined;
    if (cached && !cached.closed) {
      state.activeId = cached.id;
      return cached;
    }
    if (cached) state.pages.delete(cached.id);

    const context = await playwrightManager.context(key);
    const rawPage =
      context
        .pages()
        .find((candidate) =>
          Array.from(state.pages.values()).every((hosted) => !hosted.matches(candidate)),
        ) ?? (await context.newPage());
    const hosted = HostedPage.attach(rawPage);
    state.pages.set(hosted.id, hosted);
    state.activeId = hosted.id;
    return hosted;
  }

  async navigate(url: string, session?: string): Promise<{ url: string; title: string }> {
    const page = await this.page(session);
    await page.navigate(normalizeUrl(url), NAVIGATION_TIMEOUT_MS);
    const state = await page.readState();
    return { url: state.url, title: state.title };
  }

  async getUrl(session?: string): Promise<{ url: string; title: string }> {
    const state = await (await this.page(session)).readState();
    return { url: state.url, title: state.title };
  }

  async getState(session?: string): Promise<PageState> {
    return (await this.page(session)).readState();
  }

  async peekState(): Promise<PageState | null> {
    const state = this.sessions.get(this.activeSessionKey);
    const page = state?.activeId ? state.pages.get(state.activeId) : undefined;
    if (!page || page.closed) return null;
    return page.readState();
  }

  async goBack(session?: string): Promise<void> {
    await (await this.page(session)).goBack(NAVIGATION_TIMEOUT_MS);
  }

  async goForward(session?: string): Promise<void> {
    await (await this.page(session)).goForward(NAVIGATION_TIMEOUT_MS);
  }

  async reload(session?: string): Promise<void> {
    await (await this.page(session)).reload(NAVIGATION_TIMEOUT_MS);
  }

  async getText(session?: string): Promise<string> {
    return capString(await (await this.page(session)).text(), TEXT_CAP_BYTES);
  }

  async getHtml(session?: string): Promise<string> {
    return capString(await (await this.page(session)).html(), HTML_CAP_BYTES);
  }

  async click(args: { selector: string }, session?: string): Promise<{ found: boolean }> {
    const page = await this.page(session);
    return { found: await page.click(args.selector) };
  }

  async fill(
    args: { selector: string; value: string },
    session?: string,
  ): Promise<{ found: boolean }> {
    const page = await this.page(session);
    return { found: await page.fill(args.selector, args.value) };
  }

  async scroll(
    args: { deltaY: number; deltaX?: number },
    session?: string,
  ): Promise<{ deltaX: number; deltaY: number; scrollY: number }> {
    const deltaY = clampDelta(args.deltaY);
    const deltaX = clampDelta(args.deltaX ?? 0);
    const scrollY = await (await this.page(session)).scroll(deltaX, deltaY);
    return { deltaX, deltaY, scrollY };
  }

  async screenshot(session?: string): Promise<string> {
    const data = await (await this.page(session)).screenshot("png");
    return `data:image/png;base64,${data}`;
  }

  async setViewport(width: number, height: number, session?: string): Promise<void> {
    await (await this.page(session)).setViewport(width, height);
  }

  async pollFrame(session?: string): Promise<{ frame: ScreencastFrame | null; state: PageState }> {
    const page = await this.page(session);
    const [frame, state] = await Promise.all([page.captureFrame(), page.readState()]);
    return { frame, state };
  }

  async dispatchMouse(args: MouseInput, session?: string): Promise<void> {
    await (await this.page(session)).dispatchMouse(args);
  }

  async dispatchKey(args: KeyInput, session?: string): Promise<void> {
    await (await this.page(session)).dispatchKey(args);
  }

  stop(): void {
    for (const state of this.sessions.values()) {
      for (const page of state.pages.values()) page.close();
      state.pages.clear();
    }
    this.sessions.clear();
    this.activeSessionKey = SHARED_SESSION;
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

export type KeyInput = { type: "down" | "up"; key: string; code: string };

const clampDelta = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-10_000, Math.min(10_000, Math.trunc(value)));
};

export const browserHost = getGlobalSingleton("browserHost", () => new BrowserHost());
