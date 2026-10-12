import { NextResponse } from "next/server";
import { shouldLogProxyError, type ClientInfo } from "./proxy-logging";
import { clearBackendOverrideHeaders } from "./proxy-target";

function proxyResponseStream(
  body: ReadableStream<Uint8Array>,
  context: {
    client: Pick<ClientInfo, "ip" | "country">;
    method: string;
    path: string[];
  },
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  // The consumer (the client's SSE/EventSource connection) can disconnect at any
  // time — e.g. a page reload mid-stream. When it does, the runtime cancels this
  // ReadableStream and any in-flight pull then sees an already-closed controller.
  // Closing/enqueuing on it throws ERR_INVALID_STATE ("Controller is already
  // closed"), and the old code re-threw that from inside the catch (uncaught) and
  // logged a benign disconnect as a [PROXY STREAM CLOSED] error. Track terminal
  // state and make close idempotent so a client disconnect is a no-op, not noise.
  let finished = false;
  const safeClose = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (finished) return;
    finished = true;
    try {
      controller.close();
    } catch {
      // Consumer already closed/cancelled the stream — nothing to do.
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          safeClose(controller);
          return;
        }
        if (!finished) controller.enqueue(value);
      } catch (error) {
        // Only surface genuine upstream failures; a post-disconnect error is
        // expected once the consumer has gone away.
        if (!finished && shouldLogProxyError(context.method, context.path, error)) {
          console.warn(
            `[PROXY STREAM CLOSED] ip=${context.client.ip} | country=${context.client.country} | method=${context.method} | path=/${context.path.join("/")} | error=${String(error)}`,
          );
        }
        safeClose(controller);
      }
    },
    cancel(reason) {
      finished = true;
      void reader.cancel(reason).catch(() => undefined);
    },
  });
}

function invalidOverrideHeaders(invalidateOverride: boolean): Record<string, string> {
  return invalidateOverride ? clearBackendOverrideHeaders() : {};
}

export async function toProxyNextResponse(
  response: Response,
  context: {
    client: ClientInfo;
    invalidateOverride: boolean;
    method: string;
    path: string[];
  },
): Promise<NextResponse> {
  const contentType = response.headers.get("content-type") || "application/json";
  if (contentType.includes("text/event-stream") && response.body) {
    const runId = response.headers.get("x-run-id");
    return new NextResponse(
      proxyResponseStream(response.body, {
        client: context.client,
        method: context.method,
        path: context.path,
      }),
      {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": response.headers.get("cache-control") || "no-cache",
          ...invalidOverrideHeaders(context.invalidateOverride),
          ...(runId ? { "X-Run-Id": runId } : {}),
        },
      },
    );
  }

  return new NextResponse(
    response.body
      ? proxyResponseStream(response.body, {
          client: context.client,
          method: context.method,
          path: context.path,
        })
      : null,
    {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        ...invalidOverrideHeaders(context.invalidateOverride),
      },
    },
  );
}
