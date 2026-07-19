import { Effect, Schema } from "effect";

export class RequestBodyTooLargeError extends Schema.TaggedErrorClass<RequestBodyTooLargeError>()(
  "RequestBodyTooLargeError",
  { limit: Schema.Number },
) {
  override get message(): string {
    return `Request body exceeds ${this.limit} bytes`;
  }
}

export class RequestBodyReadError extends Schema.TaggedErrorClass<RequestBodyReadError>()(
  "RequestBodyReadError",
  { message: Schema.String, source: Schema.Unknown },
) {}

export type RequestBodyError = RequestBodyTooLargeError | RequestBodyReadError;

type ReadChunkResult =
  | { readonly done: true }
  | { readonly done: false; readonly value: Uint8Array };

const readChunk = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Effect.Effect<ReadChunkResult, RequestBodyReadError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const abort = (): void => {
        void reader.cancel();
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const result = await reader.read();
        return result.done ? { done: true } : { done: false, value: result.value };
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    catch: (source) =>
      new RequestBodyReadError({
        message: `Could not read request body: ${String(source)}`,
        source,
      }),
  });

export const readBoundedRequestBody = (
  request: Request,
  limit: number,
): Effect.Effect<ArrayBuffer, RequestBodyError> =>
  Effect.gen(function* () {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      return yield* Effect.fail(new RequestBodyTooLargeError({ limit }));
    }
    if (!request.body) return new ArrayBuffer(0);
    const reader = request.body.getReader();
    return yield* Effect.acquireUseRelease(
      Effect.succeed(reader),
      (activeReader) =>
        Effect.gen(function* () {
          const chunks: Uint8Array[] = [];
          let total = 0;
          while (true) {
            const next = yield* readChunk(activeReader);
            if (next.done) break;
            total += next.value.byteLength;
            if (total > limit) {
              yield* Effect.tryPromise({
                try: () => activeReader.cancel(),
                catch: () => undefined,
              }).pipe(Effect.ignore);
              return yield* Effect.fail(new RequestBodyTooLargeError({ limit }));
            }
            chunks.push(next.value);
          }
          const body = new ArrayBuffer(total);
          const bytes = new Uint8Array(body);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return body;
        }),
      (activeReader) => Effect.sync(() => activeReader.releaseLock()),
    );
  });

export const boundedFormData = (
  request: Request,
  limit: number,
): Effect.Effect<FormData, RequestBodyError> =>
  readBoundedRequestBody(request, limit).pipe(
    Effect.flatMap((body) =>
      Effect.tryPromise({
        try: () =>
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body,
          }).formData(),
        catch: (source) =>
          new RequestBodyReadError({
            message: `Could not parse multipart request: ${String(source)}`,
            source,
          }),
      }),
    ),
  );
