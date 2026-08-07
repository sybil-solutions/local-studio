import assert from "node:assert/strict";
import { test } from "bun:test";
import { installRuntimeSignalShutdown } from "../src/runtime-shutdown";

class Deferred {
  private readonly state = Promise.withResolvers<void>();
  readonly promise = this.state.promise;

  resolve(): void {
    this.state.resolve();
  }
}

class FakeProcess {
  readonly exits: number[] = [];
  private readonly listeners = new Map<string, () => void>();

  once(event: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.listeners.set(event, listener);
  }

  exit(code = 0): void {
    this.exits.push(code);
  }

  signal(event: "SIGINT" | "SIGTERM"): void {
    this.listeners.get(event)?.();
  }
}

test("signals share one shutdown and exit only after browser cleanup", async () => {
  const runtimeProcess = new FakeProcess();
  const browserStopped = new Deferred();
  let stops = 0;
  let disposals = 0;
  const shutdown = installRuntimeSignalShutdown({
    dispose: () => {
      disposals += 1;
    },
    process: runtimeProcess,
    reportError: () => undefined,
    stop: () => {
      stops += 1;
      return browserStopped.promise;
    },
  });

  runtimeProcess.signal("SIGTERM");
  runtimeProcess.signal("SIGINT");
  const inFlight = shutdown();
  assert.equal(shutdown(), inFlight);
  await Promise.resolve();
  assert.equal(stops, 1);
  assert.equal(disposals, 0);
  assert.deepEqual(runtimeProcess.exits, []);

  browserStopped.resolve();
  await inFlight;
  await Promise.resolve();
  assert.equal(disposals, 1);
  assert.deepEqual(runtimeProcess.exits, [0]);
});

test("failed browser cleanup still disposes metadata and exits nonzero", async () => {
  const runtimeProcess = new FakeProcess();
  const errors: unknown[] = [];
  let disposals = 0;
  const shutdown = installRuntimeSignalShutdown({
    dispose: () => {
      disposals += 1;
    },
    process: runtimeProcess,
    reportError: (error) => errors.push(error),
    stop: () => Promise.reject(new Error("cleanup failed")),
  });

  runtimeProcess.signal("SIGTERM");
  await assert.rejects(shutdown(), /cleanup failed/u);
  await Promise.resolve();
  assert.equal(disposals, 1);
  assert.equal(errors.length, 1);
  assert.deepEqual(runtimeProcess.exits, [1]);
});
