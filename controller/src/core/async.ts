import { Effect } from "effect";

export const delayEffect = (milliseconds: number): Effect.Effect<void> =>
  Effect.sleep(milliseconds);

export const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  // Each acquire hands back a single-use release closure. Guarding against a
  // double-call is essential: releasing twice would pop two waiters and grant
  // the lock to both, silently breaking mutual exclusion.
  private guardedRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  public acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(this.guardedRelease());
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(this.guardedRelease());
      });
    });
  }

  public release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

type QueueResolver<TValue> = {
  resolve: (value: TValue) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export class AsyncQueue<TValue> {
  private readonly capacity: number;
  private readonly items: TValue[] = [];
  private readonly resolvers: Array<QueueResolver<TValue>> = [];
  private closed = false;
  private evictedCount = 0;

  public constructor(capacity: number) {
    this.capacity = capacity;
  }

  public push(item: TValue): boolean {
    if (this.closed) {
      return false;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver.cleanup();
      resolver.resolve(item);
      return true;
    }
    if (this.capacity <= 0) {
      return false;
    }
    if (this.items.length >= this.capacity) {
      this.items.shift();
      this.evictedCount += 1;
    }
    this.items.push(item);
    return true;
  }

  /** Evict the oldest item from the queue. Returns the evicted item or null. */
  public evictOldest(): TValue | null {
    if (this.items.length === 0) return null;
    this.evictedCount += 1;
    return this.items.shift() ?? null;
  }

  /** Number of items evicted due to backpressure since construction. */
  public get evictions(): number {
    return this.evictedCount;
  }

  /** Current number of items waiting in the queue. */
  public get size(): number {
    return this.items.length;
  }

  /** True when the queue is at capacity. */
  public get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  public close(): void {
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      if (resolver) {
        resolver.cleanup();
        resolver.reject(new Error("Queue closed"));
      }
    }
  }

  public shift(signal?: AbortSignal): Promise<TValue> {
    if (this.items.length > 0) {
      return Promise.resolve(this.items.shift() as TValue);
    }
    // A closed, drained queue will never push or close again, so a resolver
    // registered below would never settle. Reject instead of hanging.
    if (this.closed) {
      return Promise.reject(new Error("Queue closed"));
    }
    // An already-aborted signal never dispatches `abort` to a listener added
    // afterwards, so registering below would hang forever and leak the resolver.
    if (signal?.aborted) {
      return Promise.reject(new Error("Queue aborted"));
    }

    return new Promise<TValue>((resolve, reject) => {
      const entry: QueueResolver<TValue> = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      };
      const onAbort = (): void => {
        const index = this.resolvers.indexOf(entry);
        if (index >= 0) this.resolvers.splice(index, 1);
        entry.cleanup();
        reject(new Error("Queue aborted"));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.resolvers.push(entry);
    });
  }
}
