import { NextRequest } from "next/server";
import { browserBridge, type BrowserCommand } from "@/lib/agent/browser-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Long-lived SSE that the renderer subscribes to. Whenever a tool calls one
// of the /api/agent/browser/<verb> endpoints, the corresponding command lands
// here as a `data: { id, verb, payload }` line. The renderer runs it and
// POSTs the result to /api/agent/browser/result.
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const onCommand = (command: BrowserCommand) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(command)}\n\n`));
        } catch {
          // controller is closed
        }
      };
      browserBridge.on("command", onCommand);

      // keepalive ping every 25 seconds
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 25_000);

      const close = () => {
        clearInterval(ping);
        browserBridge.off("command", onCommand);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };
      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
