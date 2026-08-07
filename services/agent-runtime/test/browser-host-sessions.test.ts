import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  BrowserHost,
  type BrowserContextSurface,
  type BrowserHostManager,
  type BrowserPage,
  type KeyInput,
  type MouseInput,
  type PageState,
  type ScreencastFrame,
} from "../src/browser-host/browser-host";
import type { ManagedPlaywrightSession } from "../src/browser-host/playwright";

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

type Settlement<A> =
  | { status: "fulfilled"; value: A }
  | { error: unknown; status: "rejected" }
  | { status: "timed-out" };

const settleWithin = <A>(promise: Promise<A>, timeoutMs = 250): Promise<Settlement<A>> =>
  Promise.race([
    promise.then<Settlement<A>>(
      (value) => ({ status: "fulfilled", value }),
      (error: unknown) => ({ error, status: "rejected" }),
    ),
    Bun.sleep(timeoutMs).then<Settlement<A>>(() => ({ status: "timed-out" })),
  ]);

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
  private isClosed = false;

  constructor(
    private readonly createRawPage: () => RawPage,
    private readonly pageCreationBarrier: Barrier | null,
  ) {}

  async newPage(): Promise<RawPage> {
    this.pageCreationBarrier?.started.resolve();
    await this.pageCreationBarrier?.release.promise;
    if (this.isClosed) throw new Error("Target closed");
    const page = this.createRawPage();
    this.rawPages.push(page);
    return page;
  }

  pages(): RawPage[] {
    return this.rawPages.filter((page) => !page.closed);
  }

  close(): void {
    this.isClosed = true;
    for (const page of this.rawPages) page.closed = true;
  }
}

class FakeSession implements ManagedPlaywrightSession<BrowserContextSurface<RawPage>> {
  private isClosed = false;
  private readonly listeners = new Set<() => void>();
  closeCalls = 0;

  constructor(
    readonly context: FakeContext,
    readonly generation: number,
    readonly scope: string,
  ) {}

  close(): Promise<void> {
    this.closeCalls += 1;
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
  readonly launches: string[] = [];
  readonly sessions: FakeSession[] = [];
  stops = 0;
  private readonly active = new Map<string, FakeSession>();
  private generation = 0;
  private pageSerial = 0;
  private stopped = false;
  private readonly ensureBarriers: Barrier[] = [];
  private readonly navigationBarriers: Barrier[] = [];
  private readonly pageCreationBarriers: Barrier[] = [];
  private readonly releaseBarriers: Barrier[] = [];

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

  blockNextRelease(): Barrier {
    const next = barrier();
    this.releaseBarriers.push(next);
    return next;
  }

  async ensure(scope: string): Promise<FakeSession> {
    const pending = this.ensureBarriers.shift();
    pending?.started.resolve();
    await pending?.release.promise;
    if (this.stopped) throw new Error("Browser manager stopped");
    const active = this.active.get(scope);
    if (active && !active.closed()) return active;
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
    const session = new FakeSession(context, ++this.generation, scope);
    this.active.set(scope, session);
    this.sessions.push(session);
    this.launches.push(scope);
    return session;
  }

  isAvailable(): boolean {
    return !this.stopped;
  }

  async release(scope: string): Promise<void> {
    const active = this.active.get(scope);
    await active?.close();
    const pending = this.releaseBarriers.shift();
    pending?.started.resolve();
    await pending?.release.promise;
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
  const firstRequest = first === "poll" ? host.pollFrame(SESSION) : host.navigate(SESSION, fixture);
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

test("navigation preserves order inside one session context", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextNavigation();
  const first = host.navigate(SESSION, "https://public.test/first");
  await pending.started.promise;
  const second = host.navigate(SESSION, "http://localhost:4173/second");
  await Promise.resolve();
  assert.deepEqual(manager.launches, [SESSION]);
  pending.release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    { title: "https://public.test/first", url: "https://public.test/first" },
    { title: "http://localhost:4173/second", url: "http://localhost:4173/second" },
  ]);
  assert.deepEqual(manager.launches, [SESSION]);
  assert.equal(activeRawPages(manager).length, 1);
  await host.stop();
});

test("shutdown closes a context without waiting forever for hung navigation", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextNavigation();
  const navigation = host.navigate(SESSION, "https://public.test/page");
  await pending.started.promise;
  const stopping = host.stop();
  assert.equal(host.stop(), host.stop());
  const settlement = await settleWithin(stopping);
  pending.release.resolve();
  await Promise.allSettled([navigation, stopping]);
  assert.equal(settlement.status, "fulfilled");
  assert.equal(manager.stops, 1);
  assert.equal(activeRawPages(manager).length, 0);
  await assert.rejects(host.getState(SESSION), /Browser host stopped/u);
});

test("release closes a context without waiting forever for hung page creation", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  const pending = manager.blockNextPageCreation();
  const navigation = host.navigate(SESSION, "https://public.test/page");
  await pending.started.promise;
  const releasing = host.releaseSession(SESSION);
  const settlement = await settleWithin(releasing);
  pending.release.resolve();
  await Promise.allSettled([navigation, releasing]);
  assert.equal(settlement.status, "fulfilled");
  assert.equal(manager.sessions[0]?.closed(), true);
  await host.stop();
});

test("release rejects work that arrives while context closure is pending", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await host.navigate(SESSION, "https://public.test/page");
  const pending = manager.blockNextRelease();
  const releasing = host.releaseSession(SESSION);
  await pending.started.promise;
  const request = host.navigate(SESSION, "https://public.test/recreated");
  const settlement = await settleWithin(request);
  pending.release.resolve();
  await releasing;
  await Promise.allSettled([request]);
  assert.equal(settlement.status, "rejected");
  assert.match(String(settlement.status === "rejected" ? settlement.error : ""), /releasing/u);
  await host.stop();
});

test("shutdown rejects work blocked in manager and page creation", async () => {
  for (const pending of ["ensure", "page"] as const) {
    const manager = new FakeManager();
    const blocked =
      pending === "ensure" ? manager.blockNextEnsure() : manager.blockNextPageCreation();
    const host = hostFor(manager);
    const navigation = host.navigate(SESSION, "https://public.test/page");
    await blocked.started.promise;
    const stopping = host.stop();
    blocked.release.resolve();
    await assert.rejects(navigation, /stopped|closed/u);
    await stopping;
    assert.equal(activeRawPages(manager).length, 0);
  }
});

test("blocked top-level navigation never starts Playwright", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await assert.rejects(host.navigate(SESSION, "http://10.0.0.1/private"), /not allowed/u);
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
      url: "https://public.test/a",
      result: undefined,
    };
  });
  await pending.started.promise;
  let secondStarted = false;
  const second = host.withFallbackSession("session-a", async () => {
    secondStarted = true;
    return {
      url: "https://public.test/second",
      result: undefined,
    };
  });
  await host.withFallbackSession("session-b", async () => ({
    url: "http://localhost:4173/b",
    result: undefined,
  }));
  assert.equal(secondStarted, false);
  pending.release.resolve();
  await Promise.all([first, second]);
  const fallbackA = await host.withFallbackSession("session-a", async (url) => ({
    result: url,
  }));
  const fallbackB = await host.withFallbackSession("session-b", async (url) => ({
    result: url,
  }));
  assert.equal(fallbackA, "https://public.test/second");
  assert.equal(fallbackB, "http://localhost:4173/b");
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

test("release is idempotent and permits later same-key recreation", async () => {
  const manager = new FakeManager();
  const host = hostFor(manager);
  await host.navigate(SESSION, "https://public.test/a");
  const firstRelease = host.releaseSession(SESSION);
  const secondRelease = host.releaseSession(SESSION);
  await Promise.all([firstRelease, secondRelease]);
  assert.deepEqual(await host.navigate(SESSION, "https://public.test/recreated"), {
    title: "https://public.test/recreated",
    url: "https://public.test/recreated",
  });
  const scoped = manager.sessions.filter((session) => session.scope === SESSION);
  assert.equal(scoped.length, 2);
  assert.equal(scoped[0]?.closed(), true);
  assert.equal(scoped[0]?.closeCalls, 1);
  assert.equal(scoped[1]?.closed(), false);
  await host.stop();
  assert.equal(scoped[1]?.closeCalls, 1);
});

test("late work completion cannot remove or close a recreated same-key session", async () => {
  const manager = new FakeManager();
  const pending = manager.blockNextNavigation();
  const host = hostFor(manager);
  const oldNavigation = host.navigate(SESSION, "https://public.test/old");
  await pending.started.promise;
  await host.releaseSession(SESSION);
  await host.navigate(SESSION, "https://public.test/recreated");
  pending.release.resolve();
  await assert.rejects(oldNavigation, /closed/u);
  assert.deepEqual(await host.getUrl(SESSION), {
    title: "https://public.test/recreated",
    url: "https://public.test/recreated",
  });
  const scoped = manager.sessions.filter((session) => session.scope === SESSION);
  assert.equal(scoped.length, 2);
  assert.equal(scoped[0]?.closeCalls, 1);
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
