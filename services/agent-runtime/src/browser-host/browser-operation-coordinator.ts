import { Effect, Schema, Semaphore } from "effect";

export type BrowserOperationKind = "frame" | "input" | "state" | "verb" | "viewport";
export type BrowserOperationFailureReason = "aborted" | "failed" | "recovery-failed" | "timed-out";

const TimeoutSchema = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(60_000)),
);

export const BrowserOperationPolicySchema = Schema.Struct({
  recoveryMs: TimeoutSchema,
  timeouts: Schema.Struct({
    frame: TimeoutSchema,
    input: TimeoutSchema,
    state: TimeoutSchema,
    verb: TimeoutSchema,
    viewport: TimeoutSchema,
  }),
});

export type BrowserOperationPolicy = typeof BrowserOperationPolicySchema.Type;

export const DefaultBrowserOperationPolicy: BrowserOperationPolicy = {
  recoveryMs: 5_000,
  timeouts: { frame: 5_000, input: 5_000, state: 5_000, verb: 15_000, viewport: 5_000 },
};

export class BrowserOperationError extends Error {
  readonly name = "BrowserOperationError";

  constructor(
    readonly kind: BrowserOperationKind,
    readonly reason: BrowserOperationFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type BrowserOperationContext = { assertActive: () => void; signal: AbortSignal };
export type BrowserOperationRunOptions = { kind: BrowserOperationKind; signal?: AbortSignal };

export type BrowserOperationCoordinatorOptions = {
  policy?: unknown;
  recover: (failure: BrowserOperationError) => Promise<void>;
};

const operationError = (
  kind: BrowserOperationKind,
  reason: BrowserOperationFailureReason,
  cause?: unknown,
): BrowserOperationError => {
  const label = reason === "timed-out" ? "timed out" : reason.replace("-", " ");
  return new BrowserOperationError(kind, reason, `Browser ${kind} operation ${label}`, { cause });
};

const normalizeError = (kind: BrowserOperationKind, error: unknown): Error =>
  error instanceof Error ? error : operationError(kind, "failed", error);

export class BrowserOperationCoordinator {
  private readonly lock = Semaphore.makeUnsafe(1);
  private readonly policy: BrowserOperationPolicy;
  private generation = 0;
  private poisoned: BrowserOperationError | null = null;

  constructor(private readonly options: BrowserOperationCoordinatorOptions) {
    this.policy = Schema.decodeUnknownSync(BrowserOperationPolicySchema)(
      options.policy ?? DefaultBrowserOperationPolicy,
    );
  }

  run<A>(
    options: BrowserOperationRunOptions,
    operation: (context: BrowserOperationContext) => Promise<A>,
  ): Promise<A> {
    if (options.signal?.aborted) {
      return Promise.reject(operationError(options.kind, "aborted", options.signal.reason));
    }
    const generation = this.generation;
    const deadline = Date.now() + this.policy.timeouts[options.kind];
    const active = Effect.suspend(() => {
      if (this.poisoned) return Effect.fail(this.poisoned);
      if (generation !== this.generation) {
        return Effect.fail(operationError(options.kind, "aborted"));
      }
      if (Date.now() >= deadline) {
        return Effect.fail(operationError(options.kind, "timed-out"));
      }
      return this.operationEffect(options, operation, generation, deadline);
    });
    return Effect.runPromise(this.lock.withPermit(Effect.uninterruptible(active)), {
      signal: options.signal,
    }).catch((error: unknown) => {
      if (this.poisoned) throw this.poisoned;
      if (options.signal?.aborted) {
        throw operationError(options.kind, "aborted", options.signal.reason);
      }
      throw error;
    });
  }

  private operationEffect<A>(
    options: BrowserOperationRunOptions,
    operation: (context: BrowserOperationContext) => Promise<A>,
    generation: number,
    deadline: number,
  ): Effect.Effect<A, Error> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Effect.fail(operationError(options.kind, "timed-out"));
    return Effect.callback<A, Error>((resume) => {
      const controller = new AbortController();
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      };
      const succeed = (value: A): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resume(Effect.succeed(value));
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resume(Effect.fail(normalizeError(options.kind, error)));
      };
      const invalidate = (failure: BrowserOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        this.generation += 1;
        controller.abort(failure);
        void this.recover(failure).then((recoveryFailure) => {
          resume(Effect.fail(recoveryFailure ?? failure));
        });
      };
      const abort = (): void =>
        invalidate(operationError(options.kind, "aborted", options.signal?.reason));
      const timeout = setTimeout(
        () => invalidate(operationError(options.kind, "timed-out")),
        remaining,
      );
      const context: BrowserOperationContext = {
        assertActive: () => {
          if (settled || generation !== this.generation || controller.signal.aborted) {
            throw operationError(options.kind, "aborted", controller.signal.reason);
          }
        },
        signal: controller.signal,
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      else
        void Promise.resolve()
          .then(() => operation(context))
          .then(succeed, fail);
      return Effect.sync(cleanup);
    });
  }

  private async recover(failure: BrowserOperationError): Promise<BrowserOperationError | null> {
    try {
      await Effect.runPromise(
        Effect.tryPromise({
          try: () => this.options.recover(failure),
          catch: (error) => error,
        }).pipe(
          Effect.timeoutOrElse({
            duration: this.policy.recoveryMs,
            orElse: () => Effect.fail(new Error("Browser operation recovery timed out")),
          }),
        ),
      );
      return null;
    } catch (error) {
      const poisoned = operationError(failure.kind, "recovery-failed", error);
      this.poisoned = poisoned;
      return poisoned;
    }
  }
}
