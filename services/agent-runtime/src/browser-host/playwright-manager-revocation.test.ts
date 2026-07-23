import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserNetworkMode } from "../../../../shared/agent/sanitize-embedded-browser-url";
import { createBrowserNetworkPolicy } from "./network-policy";
import type { PinningProxy } from "./pinning-proxy";
import { PlaywrightManager, type ManagedPlaywrightSession } from "./playwright";

class Deferred<T> {
  private readonly state = Promise.withResolvers<T>();
  readonly promise = this.state.promise;

  resolve(value: T): void {
    this.state.resolve(value);
  }
}

type ClosePlan = {
  error?: Error;
  release: Deferred<void>;
  started: Deferred<void>;
};

const closePlan = (error?: Error): ClosePlan => ({
  error,
  release: new Deferred<void>(),
  started: new Deferred<void>(),
});

type FakeContext = { id: string };

class FakeSession implements Omit<ManagedPlaywrightSession<FakeContext>, "generation"> {
  private isClosed = false;
  private listeners = new Set<() => void>();
  private nextClose: ClosePlan | null = null;
  readonly context: FakeContext;

  constructor(
    readonly mode: BrowserNetworkMode,
    id: number,
  ) {
    this.context = { id: `context-${id}` };
  }

  blockNextClose(): ClosePlan {
    const plan = closePlan();
    this.nextClose = plan;
    return plan;
  }

  rejectNextClose(error: Error): void {
    const plan = closePlan(error);
    plan.release.resolve();
    this.nextClose = plan;
  }

  async close(): Promise<void> {
    const plan = this.nextClose;
    this.nextClose = null;
    plan?.started.resolve();
    await plan?.release.promise;
    if (plan?.error) throw plan.error;
    this.finishClose();
  }

  closed(): boolean {
    return this.isClosed;
  }

  onClose(listener: () => void): void {
    this.listeners.add(listener);
  }

  finishClose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}

class ManagerFixture {
  readonly sessions: FakeSession[] = [];
  readonly proxyCloses = { loopback: 0, public: 0 };
  private serial = 0;

  private proxy(mode: BrowserNetworkMode): PinningProxy {
    return {
      close: async () => {
        this.proxyCloses[mode] += 1;
      },
      mode,
      port: mode === "public" ? 1 : 2,
      url: `http://127.0.0.1:${mode === "public" ? 1 : 2}`,
    };
  }

  manager(closeTimeoutMs = 1_000): PlaywrightManager<FakeContext> {
    const proxies = { loopback: this.proxy("loopback"), public: this.proxy("public") };
    return new PlaywrightManager<FakeContext>({
      closeTimeoutMs,
      createProxies: async () => proxies,
      launch: async (_executablePath, mode, proxy) => {
        assert.equal(proxy.mode, mode);
        const session = new FakeSession(mode, ++this.serial);
        this.sessions.push(session);
        return session;
      },
      policy: createBrowserNetworkPolicy(),
      resolveBinary: () => "/fake/chromium",
    });
  }
}

test("mode replacement waits for confirmed Playwright context revocation", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const loopback = await manager.ensure("loopback");
  const first = fixture.sessions[0];
  assert.ok(first);
  const pending = first.blockNextClose();
  let replacementSettled = false;
  const replacement = manager.ensure("public").finally(() => {
    replacementSettled = true;
  });
  await pending.started.promise;
  await Promise.resolve();
  assert.equal(replacementSettled, false);
  assert.equal(manager.current(), loopback);
  assert.equal(fixture.sessions.length, 1);
  pending.release.resolve();
  const publicSession = await replacement;
  assert.equal(first.closed(), true);
  assert.equal(publicSession.mode, "public");
  assert.equal(fixture.sessions.length, 2);
  await manager.stop();
});

test("rejected revocation poisons the manager and blocks replacement", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  await manager.ensure("loopback");
  const first = fixture.sessions[0];
  assert.ok(first);
  const expected = new Error("revocation rejected");
  first.rejectNextClose(expected);
  await assert.rejects(manager.ensure("public"), (error) => error === expected);
  assert.equal(fixture.sessions.length, 1);
  await assert.rejects(manager.ensure("loopback"), (error) => error === expected);
  assert.equal(fixture.sessions.length, 1);
  await manager.stop();
  assert.deepEqual(fixture.proxyCloses, { loopback: 1, public: 1 });
});

test("unconfirmed revocation times out and permanently blocks relaunch", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager(10);
  await manager.ensure("loopback");
  const first = fixture.sessions[0];
  assert.ok(first);
  const pending = first.blockNextClose();
  await assert.rejects(manager.ensure("public"), /Timed out confirming Chromium termination/u);
  assert.equal(fixture.sessions.length, 1);
  pending.release.resolve();
  await pending.started.promise;
  await assert.rejects(manager.ensure("loopback"), /Timed out confirming Chromium termination/u);
  await manager.stop();
});

test("unexpected context closure permits a clean same-mode relaunch", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const first = await manager.ensure("public");
  fixture.sessions[0]?.finishClose();
  const second = await manager.ensure("public");
  assert.notEqual(second.generation, first.generation);
  assert.equal(fixture.sessions.length, 2);
  await manager.stop();
});

test("scoped contexts coexist and release independently", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const sessionA = await manager.ensure("public", "session-a");
  const sessionB = await manager.ensure("public", "session-b");
  assert.notEqual(sessionA.context, sessionB.context);
  assert.equal(manager.current("session-a"), sessionA);
  assert.equal(manager.current("session-b"), sessionB);
  await manager.release("session-a");
  assert.equal(sessionA.closed(), true);
  assert.equal(sessionB.closed(), false);
  assert.equal(manager.current("session-a"), null);
  assert.equal(manager.current("session-b"), sessionB);
  await manager.stop();
  assert.equal(sessionB.closed(), true);
});

test("stop closes the active context and both pinning proxies exactly once", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  await manager.ensure("public");
  await manager.stop();
  await manager.stop();
  assert.equal(fixture.sessions[0]?.closed(), true);
  assert.deepEqual(fixture.proxyCloses, { loopback: 1, public: 1 });
  await assert.rejects(manager.ensure("public"), /manager stopped/u);
});
