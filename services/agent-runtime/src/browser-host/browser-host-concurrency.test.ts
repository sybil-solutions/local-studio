import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserNetworkMode } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  BrowserHost,
  type BrowserContextSurface,
  type BrowserHostManager,
  type BrowserPage,
  type KeyInput,
  type MouseInput,
  type PageState,
  type ScreencastFrame,
} from "./browser-host";
import type { ManagedPlaywrightSession } from "./playwright";

class Deferred<T> {
  private readonly state = Promise.withResolvers<T>();
  readonly promise = this.state.promise;

  resolve(value: T): void {
    this.state.resolve(value);
  }
}

type Barrier = { release: Deferred<void>; started: Deferred<void> };

const barrier = (): Barrier => ({ release: new Deferred<void>(), started: new Deferred<void>() });

const state = (url: string): PageState => ({
  canGoBack: false,
  canGoForward: false,
  loading: false,
  title: url,
  url,
});

type RawPage = {
  closed: boolean;
  id: string;
  navigationBarrier: Barrier | null;
  state: PageState;
};

class FakePage implements BrowserPage<RawPage> {
  constructor(private readonly raw: RawPage) {}

  get closed(): boolean {
    return this.raw.closed;
  }

  get id(): string {
    return this.raw.id;
  }

  captureFrame(): Promise<ScreencastFrame> {
    return Promise.resolve({ data: `frame-${this.id}`, metadata: {} });
  }

  click(): Promise<boolean> {
    return Promise.resolve(true);
  }

  close(): void {
    this.raw.closed = true;
  }

  dispatchKey(_input: KeyInput): Promise<void> {
    return Promise.resolve();
  }

  dispatchMouse(_input: MouseInput): Promise<void> {
    return Promise.resolve();
  }

  evaluate(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  fill(): Promise<boolean> {
    return Promise.resolve(true);
  }

  goBack(): Promise<void> {
    return Promise.resolve();
  }

  goForward(): Promise<void> {
    return Promise.resolve();
  }

  html(): Promise<string> {
    return Promise.resolve("<html></html>");
  }

  matches(page: RawPage): boolean {
    return page === this.raw;
  }

  async navigate(url: string): Promise<void> {
    this.raw.navigationBarrier?.started.resolve();
    await this.raw.navigationBarrier?.release.promise;
    if (this.closed) throw new Error("Target closed");
    this.raw.state = state(url);
  }

  readState(): Promise<PageState> {
    if (this.closed) return Promise.reject(new Error("Target closed"));
    return Promise.resolve(this.raw.state);
  }

  reload(): Promise<void> {
    return Promise.resolve();
  }

  screenshot(): Promise<string> {
    return Promise.resolve(Buffer.from(this.id).toString("base64"));
  }

  scroll(_deltaX: number, deltaY: number): Promise<number> {
    return Promise.resolve(deltaY);
  }

  setViewport(): Promise<void> {
    return Promise.resolve();
  }

  text(): Promise<string> {
    return Promise.resolve(this.raw.state.url);
  }
}

class FakeContext implements BrowserContextSurface<RawPage> {
  readonly rawPages: RawPage[] = [];

  constructor(
    private readonly createRawPage: () => RawPage,
    private readonly pageCreationBarrier: Barrier | null,
  ) {}

  async newPage(): Promise<RawPage> {
    this.pageCreationBarrier?.started.resolve();
    await this.pageCreationBarrier?.release.promise;
    const page = this.createRawPage();
    this.rawPages.push(page);
    return page;
  }

  pages(): RawPage[] {
    return this.rawPages;
  }

  close(): void {
    for (const page of this.rawPages) page.closed = true;
  }
}

class FakeSession implements ManagedPlaywrightSession<BrowserContextSurface<RawPage>> {
  private isClosed = false;
  private listeners = new Set<() => void>();

  constructor(
    readonly context: FakeContext,
    readonly generation: number,
    readonly mode: BrowserNetworkMode,
  ) {}

  close(): Promise<void> {
    if (this.isClosed) return Promise.resolve();
    this.isClosed = true;
    this.context.close();
    for (const listener of this.listeners) listener();
    this.listeners.clear();
    return Promise.resolve();
  }

  closed(): boolean {
    return this.isClosed;
  }

  onClose(listener: () => void): void {
    this.listeners.add(listener);
  }
}

class FakeManager implements BrowserHostManager<RawPage> {
  readonly modes: BrowserNetworkMode[] = [];
  readonly sessions: FakeSession[] = [];
  stops = 0;
  private active: FakeSession | null = null;
  private generation = 0;
  private pageSerial = 0;
  private stopped = false;
  private readonly ensureBarriers: Barrier[] = [];
  private readonly navigationBarriers: Barrier[] = [];
  private readonly pageCreationBarriers: Barrier[] = [];

  blockNextEnsure(): Barrier {
    const next = barrier();
    this.ensureBarriers.push(next);
    return next;
  }

  blockNextNavigation(): Barrier {
    const next = barrier();
    this.navigationBarriers.push(next);
    return next;
  }

  blockNextPageCreation(): Barrier {
    const next = barrier();
    this.pageCreationBarriers.push(next);
    return next;
  }

  async ensure(mode: BrowserNetworkMode): Promise<FakeSession> {
    const pending = this.ensureBarriers.shift();
    pending?.started.resolve();
    await pending?.release.promise;
    if (this.stopped) throw new Error("Browser manager stopped");
    if (this.active?.mode === mode && !this.active.closed()) return this.active;
    await this.active?.close();
    const context = new FakeContext(
      () => ({
        closed: false,
        id: `page-${++this.pageSerial}`,
        navigationBarrier: this.navigationBarriers.shift() ?? null,
        state: state("about:blank"),
      }),
      this.pageCreationBarriers.shift() ?? null,
    );
    const session = new FakeSession(context, ++this.generation, mode);
    this.active = session;
    this.sessions.push(session);
    this.modes.push(mode);
    return session;
  }

  isAvailable(): boolean {
    return !this.stopped;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stops += 1;
    await this.active?.close();
    this.active = null;
  }
}

const hostFor = (manager: FakeManager): BrowserHost<RawPage> =>
  new BrowserHost(manager, { attachPage: (page) => new FakePage(page) });

const activeRawPages = (manager: FakeManager): RawPage[] =>
  manager.sessions.flatMap((session) => session.context.rawPages).filter((page) => !page.closed);

async function concurrentStartup(first: "navigate" | "poll"): Promise<void> {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextEnsure();
  const firstRequest =
    first === "poll" ? host.pollFrame() : host.navigate("https://public.test/first");
  await pending.started.promise;
  const secondRequest =
    first === "poll" ? host.navigate("https://public.test/second") : host.pollFrame();
  pending.release.resolve();
  const results = await Promise.allSettled([firstRequest, secondRequest]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
  );
  assert.equal(manager.sessions.length, 1);
  assert.equal(activeRawPages(manager).length, 1);
  await host.stop();
}

test("first frame and navigation share one page when frame starts first", async () => {
  await concurrentStartup("poll");
});

test("first frame and navigation share one page when navigation starts first", async () => {
  await concurrentStartup("navigate");
});

test("cross-mode navigation preserves request order", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextNavigation();
  const first = host.navigate("https://public.test/first");
  await pending.started.promise;
  const second = host.navigate("http://localhost:4173/second");
  await Promise.resolve();
  assert.deepEqual(manager.modes, ["public"]);
  pending.release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    { title: "https://public.test/first", url: "https://public.test/first" },
    { title: "http://localhost:4173/second", url: "http://localhost:4173/second" },
  ]);
  assert.deepEqual(manager.modes, ["public", "loopback"]);
  assert.equal(activeRawPages(manager).length, 1);
  await host.stop();
});

test("trust-mode replacement clears pages from the revoked generation", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await host.navigate("http://localhost:4173/private");
  const loopbackPage = manager.sessions[0]?.context.rawPages[0];
  assert.ok(loopbackPage);
  await host.navigate("https://public.test/page");
  assert.equal(loopbackPage.closed, true);
  assert.equal(activeRawPages(manager).length, 1);
  assert.equal((await host.getUrl()).url, "https://public.test/page");
  await host.stop();
});

test("stop during context creation prevents page publication", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextEnsure();
  const navigation = host.navigate("https://public.test/page");
  await pending.started.promise;
  const stopping = host.stop();
  pending.release.resolve();
  await assert.rejects(navigation, /Browser host stopped/u);
  await stopping;
  assert.equal(manager.sessions[0]?.context.rawPages.length ?? 0, 0);
  assert.equal(activeRawPages(manager).length, 0);
});

test("stop during page creation prevents page publication", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextPageCreation();
  const navigation = host.navigate("https://public.test/page");
  await pending.started.promise;
  const stopping = host.stop();
  pending.release.resolve();
  await assert.rejects(navigation, /Browser host stopped/u);
  await stopping;
  assert.equal(manager.sessions[0]?.context.rawPages.length, 1);
  assert.equal(activeRawPages(manager).length, 0);
});

test("stop is terminal and idempotent", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await host.navigate("https://public.test/page");
  await Promise.all([host.stop(), host.stop()]);
  assert.equal(manager.stops, 1);
  await assert.rejects(host.page(), /Browser host stopped/u);
});

test("blocked top-level navigation never starts Playwright", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await assert.rejects(host.navigate("http://10.0.0.1/private"), /blocked navigation/u);
  assert.equal(manager.sessions.length, 0);
  await host.stop();
});
