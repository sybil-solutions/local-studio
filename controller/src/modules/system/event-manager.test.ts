// CRITICAL
import { describe, expect, it } from "bun:test";
import { CONTROLLER_EVENTS } from "../../contracts/controller-events";
import { Event, EventManager } from "./event-manager";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withTimeout = async <T>(promise: Promise<T>, ms = 300): Promise<T> => {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
};

describe("event-manager", () => {
  it("formats Event values as SSE wire payloads", () => {
    const event = new Event(CONTROLLER_EVENTS.STATUS, { ready: true });
    const sse = event.toSse();

    expect(sse).toContain(`event: ${event.type}`);
    expect(sse).toContain(`id: ${event.id}`);
    expect(sse).toContain('"ready":true');
    expect(sse.endsWith("\n\n")).toBe(true);
  });

  it("delivers events only to subscribers on the same channel", async () => {
    const manager = new EventManager();
    const defaultIterator = manager.subscribe()[Symbol.asyncIterator]();
    const logsIterator = manager.subscribe("logs:session-1")[Symbol.asyncIterator]();

    const defaultNext = defaultIterator.next();
    const logsNext = logsIterator.next();

    // Let both generators register before publishing.
    await delay(0);
    await manager.publish(new Event(CONTROLLER_EVENTS.STATUS, { ok: true }));

    const defaultResult = await withTimeout(defaultNext);
    expect(defaultResult.done).toBe(false);
    expect(defaultResult.value?.type).toBe(CONTROLLER_EVENTS.STATUS);

    const logsOutcome = await Promise.race([
      logsNext.then(() => "received"),
      delay(120).then(() => "timeout"),
    ]);
    expect(logsOutcome).toBe("timeout");

    // Unblock the logs iterator cleanly after verifying channel isolation.
    await manager.publish(new Event(CONTROLLER_EVENTS.LOG, { line: "cleanup" }), "logs:session-1");
    const cleanupResult = await withTimeout(logsNext);
    expect(cleanupResult.value?.type).toBe(CONTROLLER_EVENTS.LOG);

    await defaultIterator.return?.();
    await logsIterator.return?.();
  });

  it("tracks subscriber counts and published event totals", async () => {
    const manager = new EventManager();
    const iteratorA = manager.subscribe()[Symbol.asyncIterator]();
    const iteratorB = manager.subscribe("logs:job-42")[Symbol.asyncIterator]();

    const pendingA = iteratorA.next();
    const pendingB = iteratorB.next();
    await delay(0);

    const before = manager.getStats();
    expect(before["total_events_published"]).toBe(0);
    expect(before["total_subscribers"]).toBe(2);

    const channels = before["channels"] as Record<string, number>;
    expect(channels["default"]).toBe(1);
    expect(channels["logs:job-42"]).toBe(1);

    await manager.publish(new Event(CONTROLLER_EVENTS.STATUS, { stage: "boot" }));
    await manager.publish(new Event(CONTROLLER_EVENTS.LOG, { line: "started" }), "logs:job-42");

    const [eventA, eventB] = await Promise.all([withTimeout(pendingA), withTimeout(pendingB)]);
    expect(eventA.value?.type).toBe(CONTROLLER_EVENTS.STATUS);
    expect(eventB.value?.type).toBe(CONTROLLER_EVENTS.LOG);

    const after = manager.getStats();
    expect(after["total_events_published"]).toBe(2);

    await iteratorA.return?.();
    await iteratorB.return?.();
  });

  it("keeps a snapshot of the latest metrics payload for polling fallback", async () => {
    const manager = new EventManager();

    await manager.publishMetrics({ generation_throughput: 42, running_requests: 2 });

    expect(manager.getLatestMetrics()).toEqual({ generation_throughput: 42, running_requests: 2 });
  });
});
