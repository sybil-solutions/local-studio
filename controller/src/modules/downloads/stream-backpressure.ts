import type { EventEmitter } from "node:events";

type DrainAwareWriter = Pick<EventEmitter, "once" | "removeListener">;
type ErrorAwareWriter = DrainAwareWriter & Pick<EventEmitter, "on">;

type WriterFailureTracker = {
  dispose: () => void;
  throwIfFailed: () => void;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Wait for a write stream to become writable again without leaking listeners
 * across repeated backpressure cycles.
 * @param writer - Writable stream currently under backpressure.
 * @returns A promise that resolves on `drain` or rejects on `error`.
 */
export const waitForWriterDrain = (writer: DrainAwareWriter): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      writer.removeListener("drain", onDrain);
      writer.removeListener("error", onError);
    };

    const onDrain = (): void => {
      cleanup();
      resolve();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    writer.once("drain", onDrain);
    writer.once("error", onError);
  });

/**
 * Track write-stream failures across the lifetime of a transfer.
 * @param writer - Writable stream for the current download.
 * @returns Helpers to surface and clean up writer failures.
 */
export const trackWriterFailure = (writer: ErrorAwareWriter): WriterFailureTracker => {
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
      if (failure) {
        throw failure;
      }
    },
  };
};
