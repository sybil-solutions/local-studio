import type { NextRequest } from "next/server";
import type { ClientInfo } from "./proxy-logging";
import { getUpstreamTimeoutMs } from "./proxy-timeouts";

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

/**
 * Distinguishes a transiently dropped/stale connection (worth one retry with a
 * fresh socket) from a definitive failure like a clean connection refusal or
 * DNS error (where retrying just doubles the load on a down backend).
 */
function isRetriableConnectionError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code) {
    return (
      code === "ECONNRESET" ||
      code === "EPIPE" ||
      code === "ETIMEDOUT" ||
      code === "UND_ERR_SOCKET" ||
      code === "UND_ERR_CONNECT_TIMEOUT"
    );
  }
  // undici sometimes surfaces a stale keep-alive socket as a bare "fetch failed"
  // TypeError with no cause code; a single retry typically gets a fresh socket.
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("fetch failed") || message.includes("terminated");
}

function shouldFallbackFromResponse(response: Response): boolean {
  if (response.ok) return false;
  if (response.status !== 404) return false;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/plain");
}

export function buildTargetUrl(backendUrl: string, path: string[], searchParams: string): string {
  return `${backendUrl}/${path.join("/")}${searchParams ? `?${searchParams}` : ""}`;
}

export function buildFallbackTargetUrl({
  defaultBackendUrl,
  overrideUrl,
  path,
  searchParams,
}: {
  defaultBackendUrl: string;
  overrideUrl: string | null;
  path: string[];
  searchParams: string;
}): string | null {
  return overrideUrl && defaultBackendUrl !== overrideUrl
    ? buildTargetUrl(defaultBackendUrl, path, searchParams)
    : null;
}

export function getForwardedSearchParams(request: NextRequest): {
  apiKeyQuery: string | null;
  searchParams: string;
} {
  const url = new URL(request.url);
  const forwardedParams = new URLSearchParams(url.searchParams);
  const apiKeyQuery = forwardedParams.get("api_key");
  if (apiKeyQuery) forwardedParams.delete("api_key");
  return { apiKeyQuery, searchParams: forwardedParams.toString() };
}

const DEFAULT_REQUEST_BODY_LIMIT = 32 * 1024 * 1024;

export class ProxyBodyTooLargeError extends Error {}

export const proxyRequestBodyLimit = (path: readonly string[]): number => {
  const route = path.join("/");
  return DEFAULT_REQUEST_BODY_LIMIT;
};

export const readProxyRequestBody = async (
  request: Pick<Request, "body" | "headers">,
  method: string,
  limit = DEFAULT_REQUEST_BODY_LIMIT,
): Promise<ArrayBuffer | undefined> => {
  if (method === "GET" || method === "DELETE" || !request.body) return undefined;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new ProxyBodyTooLargeError("Request body exceeds the proxy limit");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const current = await reader.read();
      if (current.done) break;
      total += current.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ProxyBodyTooLargeError("Request body exceeds the proxy limit");
      }
      chunks.push(current.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new ArrayBuffer(total);
  const bytes = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export function buildProxyRequestHeaders(
  request: NextRequest,
  apiKey: string,
  apiKeyQuery: string | null,
  allowQueryApiKey: boolean,
): Headers {
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const contentType = request.headers.get("content-type");
  const incomingAuth = request.headers.get("authorization");
  const suppressAuth = request.headers.get("x-backend-suppress-auth") === "1";
  if (accept) headers.set("Accept", accept);
  if (contentType) headers.set("Content-Type", contentType);
  if (suppressAuth) return headers;
  if (incomingAuth) headers.set("Authorization", incomingAuth);
  else if (allowQueryApiKey && apiKeyQuery) headers.set("Authorization", `Bearer ${apiKeyQuery}`);
  else if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  else if (apiKeyQuery) headers.set("Authorization", `Bearer ${apiKeyQuery}`);
  return headers;
}

export async function fetchWithOptionalFallback(
  primaryUrl: string,
  fallbackUrl: string | null,
  init: RequestInit,
  context: {
    client: ClientInfo;
    method: string;
    path: string[];
    overrideUsed: boolean;
    strictOverride: boolean;
  },
): Promise<{ response: Response; usedFallback: boolean }> {
  const canFallback = Boolean(
    context.overrideUsed && !context.strictOverride && fallbackUrl && fallbackUrl !== primaryUrl,
  );

  // Idempotent reads may retry once on a dropped/stale connection so a single
  // bad keep-alive socket doesn't surface to the user as a disconnect.
  const maxConnectionAttempts = context.method === "GET" || context.method === "HEAD" ? 2 : 1;

  const fetchOnce = async (url: string): Promise<Response> => {
    const controller = new AbortController();
    const timeoutMs = getUpstreamTimeoutMs(context.path, context.method);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Do not auto-follow redirects: a compromised/misbehaving upstream must
      // not be able to bounce the proxy (with its bearer key) to an arbitrary
      // location. Redirects are surfaced to the caller as-is.
      return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const fetchWithTimeout = async (url: string): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxConnectionAttempts; attempt++) {
      try {
        return await fetchOnce(url);
      } catch (error) {
        lastError = error;
        if (attempt < maxConnectionAttempts - 1 && isRetriableConnectionError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  try {
    const primaryResponse = await fetchWithTimeout(primaryUrl);
    if (canFallback && shouldFallbackFromResponse(primaryResponse)) {
      console.warn(
        `[PROXY FALLBACK] ip=${context.client.ip} | country=${context.client.country} | method=${context.method} | path=/${context.path.join("/")} | reason=override-404-text`,
      );
      return { response: await fetchWithTimeout(fallbackUrl as string), usedFallback: true };
    }
    return { response: primaryResponse, usedFallback: false };
  } catch (error) {
    if (!canFallback) throw error;
    console.warn(
      `[PROXY FALLBACK] ip=${context.client.ip} | country=${context.client.country} | method=${context.method} | path=/${context.path.join("/")} | reason=override-network-error | error=${String(error)}`,
    );
    return { response: await fetchWithTimeout(fallbackUrl as string), usedFallback: true };
  }
}
