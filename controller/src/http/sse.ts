import { Effect, Stream } from "effect";

export const toReadableByteStream = <E>(
  source: Stream.Stream<string, E>,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return Stream.toReadableStream(Stream.map(source, (value) => encoder.encode(value)));
};

/**
 * Complete once `signal` aborts, so a stream can be interrupted by the client
 * hanging up. Without a signal there is nothing to wait for and the effect
 * never completes.
 */
export const abortEffect = (signal?: AbortSignal): Effect.Effect<void> =>
  signal
    ? Effect.callback<void>((resume) => {
        if (signal.aborted) {
          resume(Effect.void);
          return;
        }
        const abort = (): void => resume(Effect.void);
        signal.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", abort));
      })
    : Effect.never;

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
