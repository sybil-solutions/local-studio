import type { EventEmitter } from "node:events";
import { Effect } from "effect";

type WriterFailure = {
  dispose: () => void;
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

export const trackWriterFailure = (writer: EventEmitter): WriterFailure => {
  let failure: Error | null = null;
  const onError = (error: unknown): void => {
    failure = toError(error);
  };
  writer.on("error", onError);
  return {
    dispose: (): void => {
      writer.removeListener("error", onError);
    },
    throwIfFailed: (): void => {
      if (failure) throw failure;
    },
  };
};
