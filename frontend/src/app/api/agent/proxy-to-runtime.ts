import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";
import type { NextRequest } from "next/server";
import { requireCallbackOrApiAccess } from "@/lib/auth/guard";
import { AGENT_RUNTIME_URL_ERROR, resolveAgentRuntimeUrl } from "@/lib/agent-runtime-url.mjs";

const RUNTIME_REQUEST_HEADERS = ["accept", "content-type", "last-event-id"];

type AgentRuntimeProxyOptions = {
  bodyLimitBytes?: number;
};

export function agentRuntimeBaseUrl(): string | null {
  const decision = resolveAgentRuntimeUrl(process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL);
  return decision.ok ? decision.url : null;
}

function runtimeRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const name of RUNTIME_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export async function proxyToAgentRuntime(
  request: NextRequest,
  options: AgentRuntimeProxyOptions = {},
): Promise<Response> {
  const denied = requireCallbackOrApiAccess(request);
  if (denied) return denied;
  const base = agentRuntimeBaseUrl();
  if (!base) return Response.json({ error: AGENT_RUNTIME_URL_ERROR }, { status: 503 });
  const url = new URL(request.url);
  const target = `${base}${url.pathname}${url.search}`;

  const headers = runtimeRequestHeaders(request);

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (options.bodyLimitBytes) {
      const bounded = await readRequestBytesWithinLimit(request, options.bodyLimitBytes);
      if (!bounded.ok) return Response.json({ error: bounded.error }, { status: bounded.status });
      body = new ArrayBuffer(bounded.value.byteLength);
      new Uint8Array(body).set(bounded.value);
    } else {
      body = await request.arrayBuffer();
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json({ error: "Agent runtime is unavailable." }, { status: 502 });
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
