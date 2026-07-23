import { Deferred, Effect, Fiber, Schedule, Semaphore } from "effect";
import type { Page } from "playwright-core";
import {
  browserNavigation,
  type BrowserNavigation,
  type BrowserNetworkMode,
} from "../../../../shared/agent/sanitize-embedded-browser-url";
import { decodeBrowserSessionKey, type BrowserSessionKey } from "../browser-session-contract";
import { getGlobalSingleton } from "../instances";
import { HostedPage, type PageState, type ScreencastFrame } from "./hosted-page";
import { browserSessionConfig, type BrowserSessionConfig } from "./browser-session";
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

export type BrowserHostManager<RawPage = Page> = {
  ensure: (
    mode: BrowserNetworkMode,
    scope: string,
  ) => Promise<ManagedPlaywrightSession<BrowserContextSurface<RawPage>>>;
  isAvailable: () => boolean;
  release: (scope: string) => Promise<void>;
  stop: () => Promise<void>;
};

type BrowserSessionHostOptions<RawPage> = {
  attachPage?: (page: RawPage) => BrowserPage<RawPage>;
};

export type BrowserHostOptions<RawPage> = BrowserSessionHostOptions<RawPage> & {
  cleanupIntervalMs?: number;
  config?: BrowserSessionConfig;
  now?: () => number;
};

class BrowserSessionHost<RawPage> {
  private readonly pages = new Map<string, BrowserPage<RawPage>>();
  private activeId: string | null = null;
  private activeGeneration = 0;
  private activeMode: BrowserNetworkMode | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private readonly navigationLock = Semaphore.makeUnsafe(1);
  private readonly transitionLock = Semaphore.makeUnsafe(1);

  constructor(
    private readonly manager: BrowserHostManager<RawPage>,
    private readonly scope: BrowserSessionKey,
    private readonly options: BrowserSessionHostOptions<RawPage>,
  ) {}

  page(pageId?: string): Promise<BrowserPage<RawPage>> {
    return this.pageForMode(this.activeMode ?? "public", pageId);
  }

  private pageForMode(
    mode: BrowserNetworkMode,
    pageId?: string,
  ): Promise<BrowserPage<RawPage>> {
    return this.withPermit(this.transitionLock, () => this.pageUnlocked(mode, pageId));
  }

  private async pageUnlocked(
    mode: BrowserNetworkMode,
    pageId?: string,
  ): Promise<BrowserPage<RawPage>> {
    this.assertRunning();
    const attachPage = this.options.attachPage;
    if (!attachPage) throw new Error("Browser page adapter unavailable");
    const session = await this.manager.ensure(mode, this.scope);
    this.assertRunning();
    if (session.generation !== this.activeGeneration) {
      this.pages.clear();
      this.activeId = null;
      this.activeGeneration = session.generation;
      this.activeMode = session.mode;
    }
    const targetId = pageId ?? this.activeId;
    const cached = targetId ? this.pages.get(targetId) : undefined;
    if (pageId && !cached) throw new Error("Browser page does not belong to session");
    if (cached && !cached.closed) {
      this.activeId = cached.id;
      return cached;
    }
    if (cached) this.pages.delete(cached.id);
    const existing = session.context
      .pages()
      .find((candidate) =>
        Array.from(this.pages.values()).every((hosted) => !hosted.matches(candidate)),
      );
    const rawPage = existing ?? (await session.context.newPage());
    this.assertRunning();
    const hosted = attachPage(rawPage);
    this.pages.set(hosted.id, hosted);
    this.activeId = hosted.id;
    return hosted;
  }

  navigate(url: string, pageId?: string): Promise<{ url: string; title: string }> {
    const navigation = browserNavigation(normalizeUrl(url));
    if (!navigation) return Promise.reject(new Error("Browser network policy blocked navigation URL"));
    return this.withPermit(this.navigationLock, async () => {
      const page = await this.pageForMode(navigation.mode, pageId);
      await page.navigate(navigation.url, NAVIGATION_TIMEOUT_MS);
      const state = await page.readState();
      return { title: state.title, url: state.url };
    });
  }

  async getUrl(pageId?: string): Promise<{ url: string; title: string }> {
    const state = await (await this.page(pageId)).readState();
    return { title: state.title, url: state.url };
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
    return { found: await (await this.page(pageId)).click(args.selector) };
  }

  async fill(
    args: { selector: string; value: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    return { found: await (await this.page(pageId)).fill(args.selector, args.value) };
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

  async setViewport(
    width: number,
    height: number,
    pageId?: string,
  ): Promise<void> {
    await (await this.page(pageId)).setViewport(width, height);
  }

  async pollFrame(
    pageId?: string,
  ): Promise<{ frame: ScreencastFrame | null; state: PageState }> {
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

  release(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = this.withPermit(this.transitionLock, async () => {
      this.pages.clear();
      this.activeId = null;
      this.activeMode = null;
      await this.manager.release(this.scope);
    });
    return this.stopping;
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error("Browser host stopped");
  }

  private withPermit<A>(
    semaphore: Semaphore.Semaphore,
    task: () => Promise<A>,
  ): Promise<A> {
    return Effect.runPromise(
      semaphore.withPermit(Effect.tryPromise({ try: task, catch: (error) => error })),
    );
  }
}

type SessionRecord<RawPage> = {
  closing: Promise<void> | null;
  fallback: BrowserNavigation | null;
  fallbackLock: Semaphore.Semaphore;
  host: BrowserSessionHost<RawPage>;
  inFlight: number;
  key: BrowserSessionKey;
  lastAccess: number;
  releaseRequested: boolean;
  releaseStarted: boolean;
  released: Deferred.Deferred<void>;
};

export type BrowserFallbackResult<A> = {
  navigation?: BrowserNavigation;
  result: A;
};

type AcquireDecision<RawPage> =
  | { type: "acquired"; record: SessionRecord<RawPage> }
  | { type: "evict"; record: SessionRecord<RawPage> }
  | { type: "wait"; record: SessionRecord<RawPage> };

export class BrowserHost<RawPage = Page> {
  private readonly sessions = new Map<BrowserSessionKey, SessionRecord<RawPage>>();
  private readonly registryLock = Semaphore.makeUnsafe(1);
  private readonly config: BrowserSessionConfig;
  private readonly now: () => number;
  private readonly cleanupIntervalMs: number;
  private cleanupFiber: ReturnType<typeof Effect.runFork> | null = null;
  private stopping: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly manager: BrowserHostManager<RawPage>,
    private readonly options: BrowserHostOptions<RawPage> = {},
  ) {
    this.config = options.config ?? browserSessionConfig();
    this.now = options.now ?? Date.now;
    this.cleanupIntervalMs =
      options.cleanupIntervalMs ??
      Math.min(60_000, Math.max(1_000, Math.floor(this.config.idleMs / 2)));
  }

  isAvailable(): boolean {
    return this.manager.isAvailable();
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error("Browser host stopped");
  }

  private withPermit<A>(task: () => Promise<A>): Promise<A> {
    return Effect.runPromise(
      this.registryLock.withPermit(Effect.tryPromise({ try: task, catch: (error) => error })),
    );
  }

  private startCleanup(): void {
    if (this.cleanupFiber || this.stopped) return;
    this.cleanupFiber = Effect.runFork(
      Effect.tryPromise({
        try: () => this.cleanupIdleSessions(),
        catch: (error) => error,
      }).pipe(
        Effect.catch(() => Effect.void),
        Effect.repeat(Schedule.spaced(this.cleanupIntervalMs)),
        Effect.asVoid,
      ),
    );
  }

  private record(key: BrowserSessionKey): SessionRecord<RawPage> {
    return {
      closing: null,
      fallback: null,
      fallbackLock: Semaphore.makeUnsafe(1),
      host: new BrowserSessionHost(this.manager, key, this.options),
      inFlight: 0,
      key,
      lastAccess: this.now(),
      releaseRequested: false,
      releaseStarted: false,
      released: Deferred.makeUnsafe<void>(),
    };
  }

  private lruIdleRecord(): SessionRecord<RawPage> | null {
    return (
      [...this.sessions.values()]
        .filter((record) => record.inFlight === 0 && !record.releaseRequested)
        .sort((left, right) =>
          left.lastAccess === right.lastAccess
            ? left.key.localeCompare(right.key)
            : left.lastAccess - right.lastAccess,
        )[0] ?? null
    );
  }

  private acquireDecision(key: BrowserSessionKey): AcquireDecision<RawPage> {
    this.assertRunning();
    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.releaseRequested) return { type: "wait", record: existing };
      existing.inFlight += 1;
      existing.lastAccess = this.now();
      return { type: "acquired", record: existing };
    }
    if (this.sessions.size >= this.config.maxSessions) {
      const idle = this.lruIdleRecord();
      if (idle) {
        idle.releaseRequested = true;
        idle.releaseStarted = true;
        return { type: "evict", record: idle };
      }
      const releasing = [...this.sessions.values()].find((record) => record.releaseRequested);
      if (releasing) return { type: "wait", record: releasing };
      throw new Error("Browser session capacity reached while all sessions are active");
    }
    const created = this.record(key);
    created.inFlight = 1;
    this.sessions.set(key, created);
    return { type: "acquired", record: created };
  }

  private async acquire(key: BrowserSessionKey): Promise<SessionRecord<RawPage>> {
    this.startCleanup();
    for (;;) {
      const decision = await this.withPermit(async () => this.acquireDecision(key));
      if (decision.type === "acquired") return decision.record;
      if (decision.type === "evict") await this.closeRecord(decision.record);
      else await Effect.runPromise(Deferred.await(decision.record.released));
    }
  }

  private async closeRecord(record: SessionRecord<RawPage>): Promise<void> {
    record.closing ??= this.closeRecordOnce(record);
    await record.closing;
  }

  private async closeRecordOnce(record: SessionRecord<RawPage>): Promise<void> {
    let failure: unknown;
    try {
      await record.host.release();
    } catch (error) {
      failure = error;
      await this.manager.stop().catch(() => undefined);
    } finally {
      await this.withPermit(async () => {
        if (this.sessions.get(record.key) === record) this.sessions.delete(record.key);
        Deferred.doneUnsafe(record.released, Effect.void);
      });
    }
    if (failure) throw failure;
  }

  private async finish(record: SessionRecord<RawPage>): Promise<void> {
    const close = await this.withPermit(async () => {
      record.inFlight = Math.max(0, record.inFlight - 1);
      record.lastAccess = this.now();
      if (!record.releaseRequested || record.inFlight > 0 || record.releaseStarted) return false;
      record.releaseStarted = true;
      return true;
    });
    if (close) await this.closeRecord(record);
  }

  private async withSession<A>(
    sessionKey: BrowserSessionKey,
    task: (session: BrowserSessionHost<RawPage>, record: SessionRecord<RawPage>) => Promise<A>,
  ): Promise<A> {
    const key = decodeBrowserSessionKey(sessionKey);
    const record = await this.acquire(key);
    try {
      return await task(record.host, record);
    } finally {
      await this.finish(record);
    }
  }

  private withFallbackPermit<A>(
    record: SessionRecord<RawPage>,
    task: () => Promise<A>,
  ): Promise<A> {
    return Effect.runPromise(
      record.fallbackLock.withPermit(
        Effect.tryPromise({ try: task, catch: (error) => error }),
      ),
    );
  }

  page(
    sessionKey: BrowserSessionKey,
    pageId?: string,
  ): Promise<BrowserPage<RawPage>> {
    return this.withSession(sessionKey, (session) => session.page(pageId));
  }

  navigate(
    sessionKey: BrowserSessionKey,
    url: string,
    pageId?: string,
  ): Promise<{ url: string; title: string }> {
    return this.withSession(sessionKey, (session) => session.navigate(url, pageId));
  }

  getUrl(
    sessionKey: BrowserSessionKey,
    pageId?: string,
  ): Promise<{ url: string; title: string }> {
    return this.withSession(sessionKey, (session) => session.getUrl(pageId));
  }

  getState(sessionKey: BrowserSessionKey, pageId?: string): Promise<PageState> {
    return this.withSession(sessionKey, (session) => session.getState(pageId));
  }

  goBack(sessionKey: BrowserSessionKey, pageId?: string): Promise<void> {
    return this.withSession(sessionKey, (session) => session.goBack(pageId));
  }

  goForward(sessionKey: BrowserSessionKey, pageId?: string): Promise<void> {
    return this.withSession(sessionKey, (session) => session.goForward(pageId));
  }

  reload(sessionKey: BrowserSessionKey, pageId?: string): Promise<void> {
    return this.withSession(sessionKey, (session) => session.reload(pageId));
  }

  getText(sessionKey: BrowserSessionKey, pageId?: string): Promise<string> {
    return this.withSession(sessionKey, (session) => session.getText(pageId));
  }

  getHtml(sessionKey: BrowserSessionKey, pageId?: string): Promise<string> {
    return this.withSession(sessionKey, (session) => session.getHtml(pageId));
  }

  evaluate(
    sessionKey: BrowserSessionKey,
    expression: string,
    pageId?: string,
  ): Promise<unknown> {
    return this.withSession(sessionKey, (session) => session.evaluate(expression, pageId));
  }

  click(
    sessionKey: BrowserSessionKey,
    args: { selector: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    return this.withSession(sessionKey, (session) => session.click(args, pageId));
  }

  fill(
    sessionKey: BrowserSessionKey,
    args: { selector: string; value: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    return this.withSession(sessionKey, (session) => session.fill(args, pageId));
  }

  scroll(
    sessionKey: BrowserSessionKey,
    args: { deltaY: number; deltaX?: number },
    pageId?: string,
  ): Promise<{ deltaX: number; deltaY: number; scrollY: number }> {
    return this.withSession(sessionKey, (session) => session.scroll(args, pageId));
  }

  screenshot(sessionKey: BrowserSessionKey, pageId?: string): Promise<string> {
    return this.withSession(sessionKey, (session) => session.screenshot(pageId));
  }

  setViewport(
    sessionKey: BrowserSessionKey,
    width: number,
    height: number,
    pageId?: string,
  ): Promise<void> {
    return this.withSession(sessionKey, (session) =>
      session.setViewport(width, height, pageId),
    );
  }

  pollFrame(
    sessionKey: BrowserSessionKey,
    pageId?: string,
  ): Promise<{ frame: ScreencastFrame | null; state: PageState }> {
    return this.withSession(sessionKey, (session) => session.pollFrame(pageId));
  }

  dispatchMouse(
    sessionKey: BrowserSessionKey,
    args: MouseInput,
    pageId?: string,
  ): Promise<void> {
    return this.withSession(sessionKey, (session) => session.dispatchMouse(args, pageId));
  }

  dispatchKey(
    sessionKey: BrowserSessionKey,
    args: KeyInput,
    pageId?: string,
  ): Promise<void> {
    return this.withSession(sessionKey, (session) => session.dispatchKey(args, pageId));
  }

  withFallbackSession<A>(
    sessionKey: BrowserSessionKey,
    task: (navigation: BrowserNavigation | null) => Promise<BrowserFallbackResult<A>>,
  ): Promise<A> {
    return this.withSession(sessionKey, async (_session, record) =>
      this.withFallbackPermit(record, async () => {
        const transition = await task(record.fallback);
        if (transition.navigation) record.fallback = transition.navigation;
        return transition.result;
      }),
    );
  }

  async releaseSession(sessionKey: BrowserSessionKey): Promise<void> {
    const key = decodeBrowserSessionKey(sessionKey);
    const decision = await this.withPermit(async () => {
      const record = this.sessions.get(key);
      if (!record) return null;
      record.releaseRequested = true;
      if (record.inFlight > 0 || record.releaseStarted) return { close: false, record };
      record.releaseStarted = true;
      return { close: true, record };
    });
    if (!decision) return;
    if (decision.close) await this.closeRecord(decision.record);
    await Effect.runPromise(Deferred.await(decision.record.released));
  }

  async cleanupIdleSessions(): Promise<void> {
    const expired = await this.withPermit(async () => {
      const threshold = this.now() - this.config.idleMs;
      return [...this.sessions.values()].filter((record) => {
        if (record.inFlight > 0 || record.releaseRequested || record.lastAccess > threshold) {
          return false;
        }
        record.releaseRequested = true;
        record.releaseStarted = true;
        return true;
      });
    });
    await Promise.all(expired.map((record) => this.closeRecord(record)));
  }

  stop(): Promise<void> {
    this.stopping ??= this.stopOnce();
    return this.stopping;
  }

  private async stopOnce(): Promise<void> {
    this.stopped = true;
    const cleanup = this.cleanupFiber;
    this.cleanupFiber = null;
    if (cleanup) await Effect.runPromise(Fiber.interrupt(cleanup));
    const records = await this.withPermit(async () =>
      [...this.sessions.values()].map((record) => {
        record.releaseRequested = true;
        if (record.inFlight === 0) record.releaseStarted = true;
        return record;
      }),
    );
    await Promise.all(
      records.filter((record) => record.releaseStarted).map((record) => this.closeRecord(record)),
    );
    await Promise.all(records.map((record) => Effect.runPromise(Deferred.await(record.released))));
    await this.manager.stop();
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

export type KeyInput = {
  type: "down" | "up" | "char";
  key: string;
  code: string;
  text?: string;
};

const clampDelta = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-10_000, Math.min(10_000, Math.trunc(value)));
};

export const browserHost = getGlobalSingleton(
  "browserHost",
  () => new BrowserHost(playwrightManager, { attachPage: HostedPage.attach }),
);
