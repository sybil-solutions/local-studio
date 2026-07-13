import { once, type EventEmitter } from "node:events";

type WriterFailure = {
  dispose: () => void;
  throwIfFailed: () => void;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const waitForWriterDrain = async (writer: EventEmitter): Promise<void> => {
  await once(writer, "drain");
};

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
