import { Effect, Stream } from "effect";

export const toReadableByteStream = <E>(
  source: Stream.Stream<string, E>,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return Stream.toReadableStream(Stream.map(source, (value) => encoder.encode(value)));
};

const abortEffect = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const abort = (): void => resume(Effect.void);
    if (signal.aborted) {
      abort();
      return Effect.void;
    }
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

export const withSseHeartbeat = <E, R>(
  frames: Stream.Stream<string, E, R>,
  intervalMs: number,
  signal?: AbortSignal,
): Stream.Stream<string, E, R> => {
  const heartbeat: Stream.Stream<string> = Stream.map(
    Stream.tick(intervalMs),
    () => ": keepalive\n\n",
  );
  const stream: Stream.Stream<string, E, R> = Stream.merge(frames, heartbeat, {
    haltStrategy: "left",
  });
  return signal ? stream.pipe(Stream.interruptWhen(abortEffect(signal))) : stream;
};

export const buildSseHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...extra,
});
