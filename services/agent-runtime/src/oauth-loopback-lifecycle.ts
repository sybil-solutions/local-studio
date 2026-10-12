import { Effect, Fiber, Semaphore } from "effect";

export type OAuthLoopbackLifecycle = {
  start: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  cancel: <E>(
    invalidation: Effect.Effect<void, E>,
    close: Effect.Effect<void>,
  ) => Effect.Effect<void, E>;
};

export function createOAuthLoopbackLifecycle(): OAuthLoopbackLifecycle {
  const semaphore = Semaphore.makeUnsafe(1);
  return {
    start: (effect) => semaphore.withPermit(effect),
    cancel: (invalidation, close) =>
      Effect.suspend(() => {
        const invalidationFiber = Effect.runFork(invalidation);
        return semaphore.withPermit(
          close.pipe(Effect.andThen(invalidation), Effect.andThen(Fiber.join(invalidationFiber))),
        );
      }),
  };
}
