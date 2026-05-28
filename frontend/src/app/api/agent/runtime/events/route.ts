import { NextRequest } from "next/server";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";
import type { LoggedPiEvent } from "@/lib/agent/pi-runtime-types";
import { isAgentEndEvent } from "@/lib/agent/pi-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSeq(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = request.nextUrl.searchParams.get("piSessionId")?.trim() || null;
  const after = parseSeq(request.nextUrl.searchParams.get("after"));
  const resolved = piRuntimeManager.getSessionForLookup(sessionId, piSessionId);
  const session = resolved.session;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let off = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;
      let replaying = true;
      const replayQueue: LoggedPiEvent[] = [];
      const sentSeqs = new Set<number>();
      const safeSend = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encode(payload));
        } catch {
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        off();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
          // client already closed
        }
      };

      const sendLogged = (logged: LoggedPiEvent) => {
        if (logged.seq <= after || sentSeqs.has(logged.seq)) return;
        sentSeqs.add(logged.seq);
        safeSend({ type: "pi", seq: logged.seq, event: logged.event });
        if (isAgentEndEvent(logged.event)) {
          safeSend({ type: "status", phase: "done", session: session.status });
          setTimeout(close, 25);
        }
      };
      const onLiveEvent = (logged: LoggedPiEvent) => {
        if (replaying) {
          replayQueue.push(logged);
          return;
        }
        sendLogged(logged);
      };

      off = session.onLoggedEvent(onLiveEvent);
      safeSend({
        type: "status",
        phase: session.status.active ? "running" : "idle",
        session: session.status,
      });
      for (const logged of session.getEventsAfter(after)) {
        sendLogged(logged);
      }
      replaying = false;
      for (const logged of replayQueue) {
        sendLogged(logged);
      }

      ping = setInterval(() => {
        if (!session.status.active) {
          safeSend({ type: "status", phase: "idle", session: session.status });
          close();
          return;
        }
        safeSend({ type: "status", phase: "running", session: session.status });
      }, 5_000);

      request.signal.addEventListener("abort", close);
      if (!session.status.active) {
        setTimeout(close, 25);
      }
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
