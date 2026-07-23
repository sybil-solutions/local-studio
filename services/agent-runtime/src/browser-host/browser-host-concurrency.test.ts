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

const SESSION = "session-a";

class Deferred<T> {
  private readonly state = Promise.withResolvers<T>();
  readonly promise = this.state.promise;

  resolve(value: T): void {
    this.state.resolve(value);
  }
}

type Barrier = { release: Deferred<void>; started: Deferred<void> };

const barrier = (): Barrier => ({
  release: new Deferred<void>(),
  started: new Deferred<void>(),
});

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

  click(_selector: string): Promise<boolean> {
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

  evaluate(_expression: string): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  fill(_selector: string, _value: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  goBack(_timeout: number): Promise<void> {
    return Promise.resolve();
  }

  goForward(_timeout: number): Promise<void> {
    return Promise.resolve();
  }

  html(): Promise<string> {
    return Promise.resolve("<html></html>");
  }

  matches(page: RawPage): boolean {
    return page === this.raw;
  }

  async navigate(url: string, _timeout: number): Promise<void> {
    this.raw.navigationBarrier?.started.resolve();
    await this.raw.navigationBarrier?.release.promise;
    if (this.closed) throw new Error("Target closed");
    this.raw.state = state(url);
  }

  readState(): Promise<PageState> {
    if (this.closed) return Promise.reject(new Error("Target closed"));
    return Promise.resolve(this.raw.state);
  }

  reload(_timeout: number): Promise<void> {
    return Promise.resolve();
  }

  screenshot(_type: "png" | "jpeg", _quality?: number): Promise<string> {
    return Promise.resolve(Buffer.from(this.id).toString("base64"));
  }

  scroll(_deltaX: number, deltaY: number): Promise<number> {
    return Promise.resolve(deltaY);
  }

  setViewport(_width: number, _height: number): Promise<void> {
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
    return this.rawPages.filter((page) => !page.closed);
  }

  close(): void {
    for (const page of this.rawPages) page.closed = true;
  }
}

class FakeSession implements ManagedPlaywrightSession<BrowserContextSurface<RawPage>> {
  private isClosed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly context: FakeContext,
    readonly generation: number,
    readonly mode: BrowserNetworkMode,
    readonly scope: string,
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
  readonly launches: Array<{ mode: BrowserNetworkMode; scope: string }> = [];
  readonly sessions: FakeSession[] = [];
  stops = 0;
  private readonly active = new Map<string, FakeSession>();
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

  async ensure(mode: BrowserNetworkMode, scope: string): Promise<FakeSession> {
    const pending = this.ensureBarriers.shift();
    pending?.started.resolve();
    await pending?.release.promise;
    if (this.stopped) throw new Error("Browser manager stopped");
    const active = this.active.get(scope);
    if (active?.mode === mode && !active.closed()) return active;
    await active?.close();
    const context = new FakeContext(
      () => ({
        closed: false,
        id: `${scope}-page-${++this.pageSerial}`,
        navigationBarrier: this.navigationBarriers.shift() ?? null,
        state: state("about:blank"),
      }),
      this.pageCreationBarriers.shift() ?? null,
    );
    const session = new FakeSession(context, ++this.generation, mode, scope);
    this.active.set(scope, session);
    this.sessions.push(session);
    this.launches.push({ mode, scope });
    return session;
  }

  isAvailable(): boolean {
    return !this.stopped;
  }

  async release(scope: string): Promise<void> {
    const active = this.active.get(scope);
    await active?.close();
    if (this.active.get(scope) === active) this.active.delete(scope);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.stops += 1;
    await Promise.all([...this.active.values()].map((session) => session.close()));
    this.active.clear();
  }
}

const hostFor = (
  manager: FakeManager,
  options: {
    config?: { idleMs: number; maxSessions: number };
    now?: () => number;
  } = {},
): BrowserHost<RawPage> =>
  new BrowserHost(manager, {
    attachPage: (page) => new FakePage(page),
    ...options,
  });

const activeRawPages = (manager: FakeManager): RawPage[] =>
  manager.sessions.flatMap((session) => session.context.rawPages).filter((page) => !page.closed);

async function concurrentStartup(first: "navigate" | "poll"): Promise<void> {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextEnsure();
  const fixture = "https://public.test/visible";
  const firstRequest =
    first === "poll" ? host.pollFrame(SESSION) : host.navigate(SESSION, fixture);
  await pending.started.promise;
  const secondRequest =
    first === "poll" ? host.navigate(SESSION, fixture) : host.pollFrame(SESSION);
  pending.release.resolve();
  const results = await Promise.allSettled([firstRequest, secondRequest]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
  );
  assert.equal((await host.getUrl(SESSION)).url, fixture);
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

test("cross-mode navigation preserves order and replaces only that session context", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextNavigation();
  const first = host.navigate(SESSION, "https://public.test/first");
  await pending.started.promise;
  const second = host.navigate(SESSION, "http://localhost:4173/second");
  await Promise.resolve();
  assert.deepEqual(manager.launches, [{ mode: "public", scope: SESSION }]);
  pending.release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    { title: "https://public.test/first", url: "https://public.test/first" },
    { title: "http://localhost:4173/second", url: "http://localhost:4173/second" },
  ]);
  assert.deepEqual(manager.launches, [
    { mode: "public", scope: SESSION },
    { mode: "loopback", scope: SESSION },
  ]);
  assert.equal(activeRawPages(manager).length, 1);
  await host.stop();
});

test("shutdown waits for in-flight navigation and closes every context once", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextNavigation();
  const navigation = host.navigate(SESSION, "https://public.test/page");
  await pending.started.promise;
  let stopped = false;
  const stopping = host.stop().then(() => {
    stopped = true;
  });
  assert.equal(host.stop(), host.stop());
  await Promise.resolve();
  assert.equal(stopped, false);
  pending.release.resolve();
  assert.deepEqual(await navigation, {
    title: "https://public.test/page",
    url: "https://public.test/page",
  });
  await stopping;
  assert.equal(manager.stops, 1);
  assert.equal(activeRawPages(manager).length, 0);
  await assert.rejects(host.page(SESSION), /Browser host stopped/u);
});

test("shutdown protects active manager and page creation", async () => {
  for (const pending of ["ensure", "page"] as const) {
    const manager = new FakeManager();
    const blocked =
      pending === "ensure" ? manager.blockNextEnsure() : manager.blockNextPageCreation();
    const host = hostFor(manager);
    const navigation = host.navigate(SESSION, "https://public.test/page");
    await blocked.started.promise;
    const stopping = host.stop();
    blocked.release.resolve();
    assert.deepEqual(await navigation, {
      title: "https://public.test/page",
      url: "https://public.test/page",
    });
    await stopping;
    assert.equal(activeRawPages(manager).length, 0);
  }
});

test("blocked top-level navigation never starts Playwright", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await assert.rejects(host.navigate(SESSION, "http://10.0.0.1/private"), /blocked navigation/u);
  assert.equal(manager.sessions.length, 0);
  await host.stop();
});

test("different session keys own distinct contexts and reject cross-session page ids", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await Promise.all([
    host.navigate("session-a", "https://public.test/a"),
    host.navigate("session-b", "https://public.test/b"),
  ]);
  const sessionA = manager.sessions.find((session) => session.scope === "session-a");
  const sessionB = manager.sessions.find((session) => session.scope === "session-b");
  const pageA = sessionA?.context.rawPages[0];
  const pageB = sessionB?.context.rawPages[0];
  assert.ok(pageA);
  assert.ok(pageB);
  assert.notEqual(sessionA?.context, sessionB?.context);
  assert.notEqual(pageA.id, pageB.id);
  assert.equal((await host.getUrl("session-a")).url, "https://public.test/a");
  assert.equal((await host.getUrl("session-b")).url, "https://public.test/b");
  await assert.rejects(host.getUrl("session-a", pageB.id), /does not belong to session/u);
  await host.stop();
});

test("fallback state and ordering are isolated by session", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = barrier();
  const first = host.withFallbackSession("session-a", async () => {
    pending.started.resolve();
    await pending.release.promise;
    return {
      navigation: { mode: "public" as const, url: "https://public.test/a" },
      result: undefined,
    };
  });
  await pending.started.promise;
  let secondStarted = false;
  const second = host.withFallbackSession("session-a", async () => {
    secondStarted = true;
    return {
      navigation: { mode: "public" as const, url: "https://public.test/second" },
      result: undefined,
    };
  });
  await host.withFallbackSession("session-b", async () => ({
    navigation: { mode: "loopback", url: "http://localhost:4173/b" },
    result: undefined,
  }));
  assert.equal(secondStarted, false);
  pending.release.resolve();
  await Promise.all([first, second]);
  const fallbackA = await host.withFallbackSession("session-a", async (navigation) => ({
    result: navigation,
  }));
  const fallbackB = await host.withFallbackSession("session-b", async (navigation) => ({
    result: navigation,
  }));
  assert.deepEqual(fallbackA, {
    mode: "public",
    url: "https://public.test/second",
  });
  assert.deepEqual(fallbackB, {
    mode: "loopback",
    url: "http://localhost:4173/b",
  });
  assert.equal(manager.sessions.length, 0);
  await host.stop();
});

test("capacity evicts the least-recently-used idle session", async () => {
  const manager = new FakeManager();
  let now = 0;
  const host = hostFor(manager, {
    config: { idleMs: 60_000, maxSessions: 2 },
    now: () => now,
  });
  await host.navigate("session-a", "https://public.test/a");
  now = 10;
  await host.navigate("session-b", "https://public.test/b");
  now = 20;
  await host.getUrl("session-a");
  now = 30;
  await host.navigate("session-c", "https://public.test/c");
  const activeScopes = manager.sessions
    .filter((session) => !session.closed())
    .map((session) => session.scope)
    .sort();
  assert.deepEqual(activeScopes, ["session-a", "session-c"]);
  await host.stop();
});

test("capacity fails closed while every session has in-flight work", async () => {
  const manager = new FakeManager();
  const navigationA = manager.blockNextNavigation();
  const navigationB = manager.blockNextNavigation();
  const host = hostFor(manager, {
    config: { idleMs: 60_000, maxSessions: 2 },
  });
  const activeA = host.navigate("session-a", "https://public.test/a");
  const activeB = host.navigate("session-b", "https://public.test/b");
  await Promise.all([navigationA.started.promise, navigationB.started.promise]);
  await assert.rejects(
    host.navigate("session-c", "https://public.test/c"),
    /all sessions are active/u,
  );
  navigationA.release.resolve();
  navigationB.release.resolve();
  await Promise.all([activeA, activeB]);
  await host.stop();
});

test("release waits for work, is idempotent, and serializes same-key recreation", async () => {
  const manager = new FakeManager();
  const navigation = manager.blockNextNavigation();
  const host = hostFor(manager);
  const active = host.navigate(SESSION, "https://public.test/a");
  await navigation.started.promise;
  let released = false;
  const firstRelease = host.releaseSession(SESSION).then(() => {
    released = true;
  });
  const secondRelease = host.releaseSession(SESSION);
  const recreated = host.navigate(SESSION, "https://public.test/recreated");
  await Promise.resolve();
  assert.equal(released, false);
  assert.equal(manager.sessions.filter((session) => session.scope === SESSION).length, 1);
  navigation.release.resolve();
  await active;
  await Promise.all([firstRelease, secondRelease]);
  assert.deepEqual(await recreated, {
    title: "https://public.test/recreated",
    url: "https://public.test/recreated",
  });
  const scoped = manager.sessions.filter((session) => session.scope === SESSION);
  assert.equal(scoped.length, 2);
  assert.equal(scoped[0]?.closed(), true);
  assert.equal(scoped[1]?.closed(), false);
  await host.stop();
});

test("idle cleanup skips active work and releases expired sessions", async () => {
  const manager = new FakeManager();
  let now = 0;
  const host = hostFor(manager, {
    config: { idleMs: 60_000, maxSessions: 2 },
    now: () => now,
  });
  await host.navigate("session-idle", "https://public.test/idle");
  now = 1;
  const navigation = manager.blockNextNavigation();
  const active = host.navigate("session-active", "https://public.test/active");
  await navigation.started.promise;
  now = 60_001;
  await host.cleanupIdleSessions();
  const idle = manager.sessions.find((session) => session.scope === "session-idle");
  const busy = manager.sessions.find((session) => session.scope === "session-active");
  assert.equal(idle?.closed(), true);
  assert.equal(busy?.closed(), false);
  navigation.release.resolve();
  await active;
  await host.stop();
});
