import type { ControllerEvent, ControllerEventType } from "@local-studio/contracts";
import type { Bus } from "./bus";

const enc = new TextEncoder();

export const sseResponse = (bus: Bus, initial: ControllerEvent[], filter: Set<ControllerEventType> | null, signal: AbortSignal): Response => {
  let off = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (e: ControllerEvent) => {
        if (filter && !filter.has(e.type)) return;
        try {
          ctrl.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`));
        } catch {}
      };
      initial.forEach(send);
      off = bus.on(send);
      timer = setInterval(() => {
        try {
          ctrl.enqueue(enc.encode(": keepalive\n\n"));
        } catch {}
      }, 15_000);
      signal.addEventListener("abort", () => {
        off();
        clearInterval(timer);
        try {
          ctrl.close();
        } catch {}
      });
    },
    cancel() {
      off();
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
};
