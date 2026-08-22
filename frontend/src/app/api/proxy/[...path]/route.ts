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

/**
 * One handler under every method name the controller speaks. The verb was the
 * only thing the four wrappers differed by, and the request already carries it.
 */
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const { method } = request;
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

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
