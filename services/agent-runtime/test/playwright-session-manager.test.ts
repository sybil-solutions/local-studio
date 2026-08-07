import assert from "node:assert/strict";
import { test } from "bun:test";
import { PlaywrightManager, type ManagedPlaywrightSession } from "../src/browser-host/playwright";

class Deferred<T> {
  private readonly state = Promise.withResolvers<T>();
  readonly promise = this.state.promise;

  resolve(value: T): void {
    this.state.resolve(value);
  }
}

type ClosePlan = {
  release: Deferred<void>;
  started: Deferred<void>;
};

type FakeContext = { id: string };

class FakeSession implements Omit<ManagedPlaywrightSession<FakeContext>, "generation"> {
  private isClosed = false;
  private readonly listeners = new Set<() => void>();
  private nextClose: ClosePlan | null = null;
  closeCalls = 0;
  readonly context: FakeContext;

  constructor(id: number) {
    this.context = { id: `context-${id}` };
  }

  blockNextClose(): ClosePlan {
    const plan = { release: new Deferred<void>(), started: new Deferred<void>() };
    this.nextClose = plan;
    return plan;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    const plan = this.nextClose;
    this.nextClose = null;
    plan?.started.resolve();
    await plan?.release.promise;
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
  private serial = 0;

  manager(closeTimeoutMs = 1_000): PlaywrightManager<FakeContext> {
    return new PlaywrightManager<FakeContext>({
      closeTimeoutMs,
      launch: async () => {
        const session = new FakeSession(++this.serial);
        this.sessions.push(session);
        return session;
      },
      resolveBinary: () => "/fake/chromium",
    });
  }
}

test("same-scope creation is coalesced while scopes remain isolated", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const [firstA, secondA, sessionB] = await Promise.all([
    manager.ensure("session-a"),
    manager.ensure("session-a"),
    manager.ensure("session-b"),
  ]);
  assert.equal(firstA, secondA);
  assert.notEqual(firstA.context, sessionB.context);
  assert.equal(fixture.sessions.length, 2);
  await manager.stop();
});

test("scoped contexts release independently", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const sessionA = await manager.ensure("session-a");
  const sessionB = await manager.ensure("session-b");
  await manager.release("session-a");
  assert.equal(sessionA.closed(), true);
  assert.equal(sessionB.closed(), false);
  assert.equal(manager.current("session-a"), null);
  assert.equal(manager.current("session-b"), sessionB);
  await manager.stop();
  assert.equal(sessionB.closed(), true);
});

test("release waits for confirmed context closure", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const session = await manager.ensure("session-a");
  const pending = fixture.sessions[0]?.blockNextClose();
  assert.ok(pending);
  let released = false;
  const release = manager.release("session-a").then(() => {
    released = true;
  });
  await pending.started.promise;
  assert.equal(released, false);
  pending.release.resolve();
  await release;
  assert.equal(session.closed(), true);
  await manager.stop();
});

test("timeout revocation is single-flight and stop preserves its failure", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager(10);
  const session = await manager.ensure("session-a");
  const pending = fixture.sessions[0]?.blockNextClose();
  assert.ok(pending);
  const firstRelease = manager.release("session-a");
  await pending.started.promise;
  const secondRelease = manager.release("session-a");
  const releases = await Promise.allSettled([firstRelease, secondRelease]);
  assert.deepEqual(
    releases.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(
    releases[0]?.status === "rejected" ? releases[0].reason : null,
    releases[1]?.status === "rejected" ? releases[1].reason : null,
  );
  const repeatedRelease = await Promise.allSettled([manager.release("session-a")]);
  assert.equal(repeatedRelease[0]?.status, "rejected");
  assert.equal(
    repeatedRelease[0]?.status === "rejected" ? repeatedRelease[0].reason : null,
    releases[0]?.status === "rejected" ? releases[0].reason : null,
  );
  assert.equal(fixture.sessions[0]?.closeCalls, 1);
  const firstStop = manager.stop();
  const secondStop = manager.stop();
  assert.equal(firstStop, secondStop);
  const stops = await Promise.allSettled([firstStop, secondStop]);
  assert.deepEqual(
    stops.map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(
    stops[0]?.status === "rejected" ? stops[0].reason : null,
    releases[0]?.status === "rejected" ? releases[0].reason : null,
  );
  assert.equal(fixture.sessions[0]?.closeCalls, 1);
  pending.release.resolve();
  await Bun.sleep(0);
  assert.equal(session.closed(), true);
});

test("unexpected closure permits a clean scoped relaunch", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  const first = await manager.ensure("session-a");
  fixture.sessions[0]?.finishClose();
  const second = await manager.ensure("session-a");
  assert.notEqual(first.generation, second.generation);
  assert.equal(fixture.sessions.length, 2);
  await manager.stop();
});

test("stop closes every context once and refuses new sessions", async () => {
  const fixture = new ManagerFixture();
  const manager = fixture.manager();
  await manager.ensure("session-a");
  await manager.ensure("session-b");
  await manager.stop();
  await manager.stop();
  assert.deepEqual(
    fixture.sessions.map((session) => session.closed()),
    [true, true],
  );
  await assert.rejects(manager.ensure("session-c"), /manager stopped/u);
});
