import { Deferred, Effect, Option } from "effect";

export const delayEffect = (milliseconds: number): Effect.Effect<void> => Effect.sleep(milliseconds);

export const delay = (milliseconds: number): Promise<void> => Effect.runPromise(delayEffect(milliseconds));

export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  public acquireEffect(): Effect.Effect<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Effect.succeed(() => this.release());
    }

    return Effect.callback<() => void>((resume) => {
      this.queue.push(() => {
        this.locked = true;
        resume(Effect.succeed(() => this.release()));
      });
    });
  }

  public acquire(): Promise<() => void> {
    return Effect.runPromise(this.acquireEffect());
  }

  public acquireWithTimeoutEffect(timeoutMs: number): Effect.Effect<(() => void) | null> {
    return this.acquireEffect().pipe(
      Effect.timeoutOption(timeoutMs),
      Effect.map((result) => (Option.isSome(result) ? result.value : null)),
    );
  }

  public acquireWithTimeout(timeoutMs: number): Promise<(() => void) | null> {
    return Effect.runPromise(this.acquireWithTimeoutEffect(timeoutMs));
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

export class AsyncQueue<TValue> {
  private readonly capacity: number;
  private readonly items: TValue[] = [];
  private readonly resolvers: Array<{
    deferred: Deferred.Deferred<TValue, Error>;
    cleanup: () => void;
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
      resolver.cleanup();
      void Effect.runPromise(Deferred.succeed(resolver.deferred, item));
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
        void Effect.runPromise(Deferred.fail(resolver.deferred, new Error("Queue closed")));
      }
    }
  }

  public shiftEffect(signal?: AbortSignal): Effect.Effect<TValue, Error> {
    if (this.items.length > 0) {
      return Effect.succeed(this.items.shift() as TValue);
    }

    const deferred = Deferred.makeUnsafe<TValue, Error>();
    const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      const index = this.resolvers.findIndex((entry) => entry.deferred === deferred);
      if (index >= 0) this.resolvers.splice(index, 1);
      cleanup();
      void Effect.runPromise(Deferred.fail(deferred, new Error("Queue aborted")));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    this.resolvers.push({ deferred, cleanup });
    return Deferred.await(deferred);
  }

  public shift(signal?: AbortSignal): Promise<TValue> {
    return Effect.runPromise(this.shiftEffect(signal));
  }
}
