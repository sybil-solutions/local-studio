// Shared response lifecycle for the runtime's SSE endpoints. Owns the closed
// flag, guarded send/close, heartbeat comments, abort wiring, and the SSE
// headers so each endpoint keeps only its protocol frames.

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/** Enqueue a raw SSE frame; dropped once closed, a failed enqueue closes the stream. */
export type SseSend = (frame: string) => void;

export function sseResponse(options: {
  /** Request signal; an abort tears the stream down. */
  signal?: AbortSignal;
  /** Comment text of the immediate first frame (defaults to "connected"). */
  connectComment?: string;
  /** Periodic comment frame keeping intermediaries from idling the stream out. */
  heartbeat?: { intervalMs: number; comment: string };
  /**
   * Wire the stream's protocol frames. Runs after the first-byte comment is
   * enqueued; may call `close` (even synchronously) and may return a teardown
   * that runs exactly once when the stream closes.
   */
  start: (send: SseSend, close: () => void) => (() => void) | void;
}): Response {
  const { signal } = options;
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let teardown: (() => void) | undefined;
  let onAbort: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (teardown) {
      teardown();
      teardown = undefined;
    }
    if (onAbort && signal) {
      signal.removeEventListener("abort", onAbort);
      onAbort = null;
    }
    if (streamController) {
      try {
        streamController.close();
      } catch {
        // client already closed
      }
    }
  };
  const send: SseSend = (frame) => {
    if (closed || !streamController) return;
    try {
      streamController.enqueue(encoder.encode(frame));
    } catch {
      close();
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      // First byte immediately: the Next standalone proxy withholds even the
      // HTTP headers until the first body chunk, so without this an idle
      // stream left EventSource stuck in "connecting" for up to a heartbeat
      // interval (measured 45s on both surfaces).
      send(`: ${options.connectComment ?? "connected"}\n\n`);
      const result = options.start(send, close);
      if (closed) {
        // close() ran inside start, before the teardown was registered.
        if (result) result();
        return;
      }
      teardown = result || undefined;
      if (signal) {
        if (signal.aborted) {
          close();
          return;
        }
        onAbort = close;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      if (options.heartbeat) {
        const { intervalMs, comment } = options.heartbeat;
        heartbeat = setInterval(() => send(`: ${comment}\n\n`), intervalMs);
      }
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
