import type { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import { Deferred, Effect } from "effect";

type WriterFailure = {
  close: () => Effect.Effect<void, Error>;
  dispose: () => void;
  failed: Effect.Effect<never, Error>;
  throwIfFailed: () => void;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const waitForWriterDrain = (writer: EventEmitter): Effect.Effect<void, Error> =>
  Effect.callback<void, Error>((resume) => {
    const cleanup = (): void => {
      writer.removeListener("drain", onDrain);
      writer.removeListener("error", onError);
    };
    const onDrain = (): void => {
      cleanup();
      resume(Effect.void);
    };
    const onError = (error: unknown): void => {
      cleanup();
      resume(Effect.fail(toError(error)));
    };
    writer.once("drain", onDrain);
    writer.once("error", onError);
    return Effect.sync(cleanup);
  });

export const trackWriterFailure = (writer: Writable): WriterFailure => {
  let failure: Error | null = null;
  const failed = Deferred.makeUnsafe<never, Error>();
  const closed = Deferred.makeUnsafe<void, never>();
  const onError = (error: unknown): void => {
    if (failure) return;
    failure = toError(error);
    Deferred.doneUnsafe(failed, Effect.fail(failure));
  };
  const onClose = (): void => {
    Deferred.doneUnsafe(closed, Effect.void);
  };
  const throwIfFailed = (): void => {
    if (failure) throw failure;
  };
  writer.on("error", onError);
  writer.once("close", onClose);
  return {
    close: () =>
      Effect.gen(function* () {
        if (!writer.destroyed) {
          yield* Effect.try({
            try: () => writer.end(),
            catch: toError,
          });
        }
        if (!writer.closed) yield* Deferred.await(closed);
        yield* Effect.try({
          try: throwIfFailed,
          catch: toError,
        });
      }),
    dispose: (): void => {
      writer.removeListener("error", onError);
      writer.removeListener("close", onClose);
    },
    failed: Deferred.await(failed),
    throwIfFailed,
  };
};
