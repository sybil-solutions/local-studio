import { NextRequest, NextResponse } from "next/server";
import { getClientInfo, logProxyAccess, shouldLogProxyError } from "./proxy-logging";
import {
  buildFallbackTargetUrl,
  buildProxyRequestHeaders,
  buildTargetUrl,
  fetchWithOptionalFallback,
  getForwardedSearchParams,
  isAbortError,
  ProxyBodyTooLargeError,
  proxyRequestBodyLimit,
  readProxyRequestBody,
} from "./proxy-fetch";
import { toProxyNextResponse } from "./proxy-response";
import { resolveProxyTarget } from "./proxy-target";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "GET", path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "POST", path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "PUT", path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "DELETE", path);
}

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  const startTime = Date.now();
  const client = getClientInfo(request);

  try {
    const target = await resolveProxyTarget(request, client);
    if ("blockedResponse" in target) return target.blockedResponse;

    // Never forward credentials to the controller as query params.
    const { apiKeyQuery, searchParams } = getForwardedSearchParams(request);
    const targetUrl = buildTargetUrl(target.backendUrl, path, searchParams);
    const fallbackTargetUrl = buildFallbackTargetUrl({
      defaultBackendUrl: target.defaultBackendUrl,
      overrideUrl: target.overrideUrl,
      path,
      searchParams,
    });
    const hasAuth = Boolean(request.headers.get("authorization"));
    logProxyAccess({ client, hasAuth, method, overrideUrl: target.overrideUrl, path });

    const body = await readProxyRequestBody(request, method, proxyRequestBodyLimit(path));
    const headers = buildProxyRequestHeaders(
      request,
      target.apiKey,
      apiKeyQuery,
      Boolean(target.overrideUrl),
    );

    const { response, usedFallback } = await fetchWithOptionalFallback(
      targetUrl,
      fallbackTargetUrl,
      { method, headers, body },
      {
        client,
        method,
        path,
        overrideUsed: Boolean(target.overrideUrl),
        strictOverride: target.strictOverride,
      },
    );

    return toProxyNextResponse(response, {
      client,
      invalidateOverride: usedFallback || target.blockedOverrideCleared,
      method,
      path,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    if (shouldLogProxyError(method, path, error)) {
      console.error(
        `[PROXY ERROR] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | duration=${duration}ms | error=${String(error)}`,
      );
    }
    if (isAbortError(error)) {
      return NextResponse.json({ error: "Backend request timed out" }, { status: 504 });
    }
    if (error instanceof ProxyBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
