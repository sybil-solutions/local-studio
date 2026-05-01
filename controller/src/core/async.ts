// CRITICAL
export const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  public async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  public async acquireWithTimeout(timeoutMs: number): Promise<(() => void) | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });
    const acquirePromise = this.acquire().then((release) => release);
    const result = await Promise.race([timeoutPromise, acquirePromise]);
    return result;
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

/** Bounded async queue with backpressure — drops oldest items when full. */
export class AsyncQueue<TValue> {
  private readonly capacity: number;
  private readonly items: TValue[] = [];
  private readonly resolvers: Array<{
    resolve: (value: TValue) => void;
    reject: (error: Error) => void;
  }> = [];
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
        resolver.reject(new Error("Queue closed"));
      }
    }
  }

  public async shift(signal?: AbortSignal): Promise<TValue> {
    if (this.items.length > 0) {
      return this.items.shift() as TValue;
    }

    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Queue aborted"));
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.resolvers.push({
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
    });
  }
}
