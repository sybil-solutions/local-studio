import { describe, expect, test } from "bun:test";

import { AsyncLock, AsyncQueue } from "./async";

describe("AsyncLock", () => {
  test("serializes critical sections in FIFO order", async () => {
    const lock = new AsyncLock();
    const order: number[] = [];
    const run = async (id: number): Promise<void> => {
      const release = await lock.acquire();
      order.push(id);
      // Yield a macrotask so overlapping sections would interleave if unlocked.
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(-id);
      release();
    };
    await Promise.all([run(1), run(2), run(3)]);
    // Each section runs to completion (id then -id) before the next starts, and
    // waiters resume in the order they queued.
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  test("the release closure is idempotent — a double-call cannot free two waiters", async () => {
    const lock = new AsyncLock();
    const first = await lock.acquire();
    let bAcquired = false;
    let cAcquired = false;
    void lock.acquire().then(() => {
      bAcquired = true;
    });
    void lock.acquire().then(() => {
      cAcquired = true;
    });
    first();
    first(); // second call must be a no-op
    await new Promise((resolve) => setTimeout(resolve, 1));
    // Only one waiter may hold the lock; the double-release must not admit both.
    expect(bAcquired).toBe(true);
    expect(cAcquired).toBe(false);
  });

  test("second acquire blocks until the first releases", async () => {
    const lock = new AsyncLock();
    const first = await lock.acquire();
    let secondAcquired = false;
    const second = lock.acquire().then((release) => {
      secondAcquired = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(secondAcquired).toBe(false);
    first();
    (await second)();
    expect(secondAcquired).toBe(true);
  });
});

describe("AsyncQueue", () => {
  test("returns a buffered item immediately", async () => {
    const queue = new AsyncQueue<number>(4);
    queue.push(7);
    expect(await queue.shift()).toBe(7);
  });

  test("a pending shift wakes on the next push (no lost wakeup)", async () => {
    const queue = new AsyncQueue<string>(4);
    const pending = queue.shift();
    queue.push("hello");
    expect(await pending).toBe("hello");
  });

  test("push delivers to a waiter FIFO and bypasses the buffer", async () => {
    const queue = new AsyncQueue<number>(4);
    const a = queue.shift();
    const b = queue.shift();
    queue.push(1);
    queue.push(2);
    expect(await a).toBe(1);
    expect(await b).toBe(2);
    expect(queue.size).toBe(0);
  });

  test("evicts oldest when over capacity", () => {
    const queue = new AsyncQueue<number>(2);
    queue.push(1);
    queue.push(2);
    queue.push(3);
    expect(queue.evictions).toBe(1);
    expect(queue.size).toBe(2);
  });

  test("close rejects pending shifts and drops later pushes", async () => {
    const queue = new AsyncQueue<number>(4);
    const pending = queue.shift();
    queue.close();
    await expect(pending).rejects.toThrow("Queue closed");
    expect(queue.push(1)).toBe(false);
  });

  test("aborting a pending shift rejects it and removes the resolver", async () => {
    const queue = new AsyncQueue<number>(4);
    const controller = new AbortController();
    const pending = queue.shift(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("Queue aborted");
    // The aborted waiter must not steal the next pushed item.
    queue.push(42);
    expect(await queue.shift()).toBe(42);
  });

  test("shift on a closed drained queue rejects instead of hanging", async () => {
    const queue = new AsyncQueue<number>(4);
    queue.close();
    await expect(queue.shift()).rejects.toThrow("Queue closed");
  });

  test("shift with an already-aborted signal rejects instead of hanging", async () => {
    const queue = new AsyncQueue<number>(4);
    const controller = new AbortController();
    controller.abort();
    await expect(queue.shift(controller.signal)).rejects.toThrow("Queue aborted");
    // No resolver leaked: a normal push/shift still works.
    queue.push(5);
    expect(await queue.shift()).toBe(5);
  });
});
