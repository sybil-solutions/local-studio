import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";
import {
  BrowserOperationCoordinator,
  BrowserOperationError,
} from "../src/browser-host/browser-operation-coordinator";
import { fetchReadable } from "../src/browser-host/reader";

const policy = {
  recoveryMs: 100,
  timeouts: { frame: 25, input: 25, state: 25, verb: 25, viewport: 25 },
};

const errorReason = (error: unknown): string | undefined =>
  error instanceof BrowserOperationError ? error.reason : undefined;

type Recover = ConstructorParameters<typeof BrowserOperationCoordinator>[0]["recover"];

const makeCoordinator = (recover: Recover = async () => undefined, recoveryMs = 100) =>
  new BrowserOperationCoordinator({ policy: { ...policy, recoveryMs }, recover });

afterEach(() => {
  globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = undefined;
  globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = undefined;
});

test("a stalled frame is recovered before later browser work starts", async () => {
  const started = Promise.withResolvers<void>();
  const late = Promise.withResolvers<void>();
  const recoveries: string[] = [];
  let state = "initial";
  const coordinator = makeCoordinator(async (failure) => {
    recoveries.push(`${failure.kind}:${failure.reason}`);
  });
  const frame = coordinator.run({ kind: "frame" }, async (context) => {
    started.resolve();
    await late.promise;
    context.assertActive();
    state = "stale";
  });
  await started.promise;
  let laterStarted = false;
  const stale = coordinator.run({ kind: "verb" }, async () => {
    laterStarted = true;
  });
  const staleRejected = assert.rejects(stale, (error) => errorReason(error) === "aborted");
  await assert.rejects(frame, (error) => errorReason(error) === "timed-out");
  await staleRejected;
  const later = coordinator.run({ kind: "verb" }, async () => {
    state = "current";
    return "ready";
  });
  assert.equal(await later, "ready");
  late.resolve();
  await Bun.sleep(0);
  assert.equal(laterStarted, false);
  assert.equal(state, "current");
  assert.deepEqual(recoveries, ["frame:timed-out"]);
});

test("an aborted queued request performs no browser side effect", async () => {
  const activeStarted = Promise.withResolvers<void>();
  const releaseActive = Promise.withResolvers<void>();
  const coordinator = makeCoordinator();
  const active = coordinator.run({ kind: "frame" }, async () => {
    activeStarted.resolve();
    await releaseActive.promise;
  });
  await activeStarted.promise;
  const cancellation = new AbortController();
  let sideEffects = 0;
  const queued = coordinator.run({ kind: "input", signal: cancellation.signal }, async () => {
    sideEffects += 1;
  });
  cancellation.abort();
  await assert.rejects(queued, (error) => errorReason(error) === "aborted");
  assert.equal(sideEffects, 0);
  releaseActive.resolve();
  await active;
});

test("an active abort recovers before the next operation starts", async () => {
  const activeStarted = Promise.withResolvers<void>();
  const cancellation = new AbortController();
  let recovered = false;
  const coordinator = makeCoordinator(async () => {
    recovered = true;
  });
  const active = coordinator.run({ kind: "input", signal: cancellation.signal }, async () => {
    activeStarted.resolve();
    return new Promise<never>(() => undefined);
  });
  await activeStarted.promise;
  cancellation.abort();
  const later = coordinator.run({ kind: "state" }, async () => recovered);
  await assert.rejects(active, (error) => errorReason(error) === "aborted");
  assert.equal(await later, true);
});

test("queued input and verb cannot mutate the replacement browser generation", async () => {
  const activeStarted = Promise.withResolvers<void>();
  const cancellation = new AbortController();
  const sideEffects: string[] = [];
  let page = "initial";
  const coordinator = makeCoordinator(async () => {
    page = "replacement";
  });
  const active = coordinator.run({ kind: "frame", signal: cancellation.signal }, async () => {
    activeStarted.resolve();
    return new Promise<never>(() => undefined);
  });
  await activeStarted.promise;
  const input = coordinator.run({ kind: "input" }, async () => {
    sideEffects.push(`${page}:input`);
  });
  const verb = coordinator.run({ kind: "verb" }, async () => {
    sideEffects.push(`${page}:verb`);
  });
  cancellation.abort();
  await assert.rejects(active, (error) => errorReason(error) === "aborted");
  await assert.rejects(input, (error) => errorReason(error) === "aborted");
  await assert.rejects(verb, (error) => errorReason(error) === "aborted");
  assert.equal(page, "replacement");
  assert.deepEqual(sideEffects, []);
});

test("queued work expires from its enqueue deadline without side effects", async () => {
  const activeStarted = Promise.withResolvers<void>();
  const releaseActive = Promise.withResolvers<void>();
  let recoveries = 0;
  let sideEffects = 0;
  const coordinator = new BrowserOperationCoordinator({
    policy: {
      ...policy,
      timeouts: { ...policy.timeouts, input: 1, state: 1_000 },
    },
    recover: async () => {
      recoveries += 1;
    },
  });
  const active = coordinator.run({ kind: "state" }, async () => {
    activeStarted.resolve();
    await releaseActive.promise;
  });
  await activeStarted.promise;
  const queued = coordinator.run({ kind: "input" }, async () => {
    sideEffects += 1;
  });
  const queuedRejected = assert.rejects(queued, (error) => errorReason(error) === "timed-out");
  const waitUntil = Date.now() + 10;
  while (Date.now() < waitUntil) await Promise.resolve();
  releaseActive.resolve();
  await active;
  await queuedRejected;
  assert.equal(sideEffects, 0);
  assert.equal(recoveries, 0);
});

test("reader fallback is bounded and a later fallback can proceed", async () => {
  let recoveries = 0;
  const coordinator = makeCoordinator(async () => {
    recoveries += 1;
  });
  globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = async () => ["93.184.216.34"];
  globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async () =>
    new Promise<never>(() => undefined);
  const stalled = coordinator.run({ kind: "verb" }, async (context) => {
    const result = await fetchReadable("https://fallback.test/stalled", context.signal);
    context.assertActive();
    return result;
  });
  await assert.rejects(stalled, (error) => errorReason(error) === "timed-out");
  globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async (url) => ({
    status: 200,
    ok: true,
    url,
    contentType: "text/html",
    body: "<title>Recovered</title><body>ready</body>",
  });
  const recovered = await coordinator.run({ kind: "verb" }, async (context) => {
    const result = await fetchReadable("https://fallback.test/recovered", context.signal);
    context.assertActive();
    return result;
  });
  assert.equal(recovered.title, "Recovered");
  assert.equal(recoveries, 1);
});

test("unconfirmed recovery poisons later browser work closed", async () => {
  let laterSideEffects = 0;
  const coordinator = makeCoordinator(async () => new Promise<never>(() => undefined), 10);
  const stalled = coordinator.run(
    { kind: "frame" },
    async () => new Promise<never>(() => undefined),
  );
  await assert.rejects(stalled, (error) => errorReason(error) === "recovery-failed");
  await assert.rejects(
    coordinator.run({ kind: "verb" }, async () => {
      laterSideEffects += 1;
    }),
    (error) => errorReason(error) === "recovery-failed",
  );
  assert.equal(laterSideEffects, 0);
});
