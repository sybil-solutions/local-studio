import { TextEncoder } from "node:util";

/**
 * Convert an async iterable of strings into a ReadableStream.
 * @param iterable - Async iterable of strings.
 * @returns ReadableStream of Uint8Array chunks.
 */
export const streamAsyncStrings = (iterable: AsyncIterable<string>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(value));
    },
    async cancel(): Promise<void> {
      if (iterator.return) {
        await iterator.return();
      }
    },
  });
};

/**
 * Build SSE headers for streaming responses.
 * @param extra - Additional headers.
 * @returns Headers object.
 */
export const buildSseHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...extra,
});
