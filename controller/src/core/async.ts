/**
 * Delay execution for a given number of milliseconds.
 * @param milliseconds - Duration to wait.
 * @returns Promise that resolves after the delay.
 */
export const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Async mutex for serialized access.
 */
export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * Acquire the lock, waiting until available.
   * @returns A release function to unlock.
   */
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

  /**
   * Acquire the lock with a timeout.
   * @param timeoutMs - Time to wait for the lock.
   * @returns Release function or null if timeout.
   */
  public async acquireWithTimeout(timeoutMs: number): Promise<(() => void) | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });
    const acquirePromise = this.acquire().then((release) => release);
    const result = await Promise.race([timeoutPromise, acquirePromise]);
    return result;
  }

  /**
   * Release the lock and wake the next waiter.
   * @returns void
   */
  public release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

/**
 * Simple async queue for event streaming.
 */
export class AsyncQueue<TValue> {
  private readonly capacity: number;
  private readonly items: TValue[] = [];
  private readonly resolvers: Array<{ resolve: (value: TValue) => void; reject: (error: Error) => void }> = [];
  private closed = false;

  /**
   * Create a queue with bounded capacity.
   * @param capacity - Maximum number of buffered items.
   */
  public constructor(capacity: number) {
    this.capacity = capacity;
  }

  /**
   * Push a new item into the queue.
   * @param item - Item to enqueue.
   * @returns True if queued, false if dropped.
   */
  public push(item: TValue): boolean {
    if (this.closed) {
      return false;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver.resolve(item);
      return true;
    }
    if (this.items.length >= this.capacity) {
      return false;
    }
    this.items.push(item);
    return true;
  }

  /**
   * Close the queue and resolve pending waiters.
   * @returns void
   */
  public close(): void {
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      if (resolver) {
        resolver.reject(new Error("Queue closed"));
      }
    }
  }

  /**
   * Wait for the next item.
   * @param signal - Abort signal to cancel waiting.
   * @returns Next queued item.
   */
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
