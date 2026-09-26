import type { ControllerEvent, ControllerEventType } from "@local-studio/contracts";
import type { Bus } from "./bus";
import type { Obs } from "./obs";

const enc = new TextEncoder();
const KEEPALIVE = enc.encode(": keepalive\n\n");
const MAX_QUEUED = 64;

interface Client {
  ctrl: ReadableStreamDefaultController<Uint8Array>;
  filter: Set<ControllerEventType> | null;
  close(): void;
}

const frame = (e: ControllerEvent): Uint8Array => enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);

export const createSse = (bus: Bus, obs: Obs) => {
  const clients = new Set<Client>();
  const send = (c: Client, bytes: Uint8Array) => {
    if ((c.ctrl.desiredSize ?? 0) < -MAX_QUEUED) {
      obs.count("sse.dropped_slow");
      return c.close();
    }
    try {
      c.ctrl.enqueue(bytes);
    } catch {
      c.close();
    }
  };
  bus.on((e) => {
    let bytes: Uint8Array | null = null;
    for (const c of clients) if (!c.filter || c.filter.has(e.type)) send(c, (bytes ??= frame(e)));
  });
  const timer = setInterval(() => {
    for (const c of clients) send(c, KEEPALIVE);
  }, 15_000);
  timer.unref?.();
  obs.gauge("sse.clients", () => clients.size);
  return {
    response(initial: ControllerEvent[], filter: Set<ControllerEventType> | null, signal: AbortSignal): Response {
      let client: Client | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          const c: Client = {
            ctrl,
            filter,
            close() {
              if (!clients.delete(c)) return;
              try {
                ctrl.close();
              } catch {}
            },
          };
          client = c;
          for (const e of initial) if (!filter || filter.has(e.type)) ctrl.enqueue(frame(e));
          clients.add(c);
          signal.addEventListener("abort", () => c.close(), { once: true });
        },
        cancel() {
          if (client) clients.delete(client);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
      });
    },
    stop() {
      clearInterval(timer);
      for (const c of [...clients]) c.close();
    },
  };
};
