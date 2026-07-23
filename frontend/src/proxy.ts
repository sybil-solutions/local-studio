import { NextResponse, type NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
  timingSafeStringEqual,
} from "@/lib/auth/access";
import {
  CSRF_COOKIE,
  CSRF_BOOTSTRAP_HEADER,
  CSRF_HEADER,
  evaluateRequestBoundary,
  splitAllowedValues,
} from "@/lib/security/request-boundary";
import {
  FRONTEND_CALLBACK_TOKEN_HEADER,
  isFrontendCallbackRoute,
} from "@shared/agent/frontend-callback-auth";

const PROCESS_CSRF_TOKEN = crypto.randomUUID();
const credentialQueryKeys = new Set(["api_key", "key", "token", "access_token"]);

function denyResponse(isApi: boolean, status: number, message: string): NextResponse {
  if (isApi) {
    return new NextResponse(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  return new NextResponse(message, { status });
}

function permitsCsrfExemption(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  return (
    (path === "/api/auth/session" && request.method === "POST") ||
    (isFrontendCallbackRoute(request.method, path) &&
      Boolean(request.headers.get(FRONTEND_CALLBACK_TOKEN_HEADER)))
  );
}

function permitsAccessEntry(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  return path === "/access" || permitsCsrfExemption(request);
}

function credentialQueryResponse(request: NextRequest): NextResponse | null {
  const sanitizedUrl = request.nextUrl.clone();
  const keys = [...sanitizedUrl.searchParams.keys()].filter(
    (key) =>
      credentialQueryKeys.has(key.toLowerCase()) &&
      !(key === "api_key" && request.nextUrl.pathname.startsWith("/api/proxy/")),
  );
  if (keys.length === 0) return null;
  for (const key of keys) sanitizedUrl.searchParams.delete(key);
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.redirect(sanitizedUrl, 303);
  }
  return denyResponse(isApi, 400, "Credential query parameters are not accepted.");
}

function enforceAccess(request: NextRequest): NextResponse | null {
  const posture = resolveAccessPosture();
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (posture.kind === "configuration-error") {
    return denyResponse(isApi, 503, posture.message);
  }
  if (posture.kind === "allow") return null;
  if (permitsAccessEntry(request)) return null;

  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && timingSafeStringEqual(presented, posture.token)) return null;
  if (!isApi) return NextResponse.redirect(new URL("/access", request.url), 303);
  return denyResponse(isApi, 401, "Unauthorized");
}

export function proxy(request: NextRequest) {
  const boundary = evaluateRequestBoundary({
    method: request.method,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
    csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
    csrfHeader: request.headers.get(CSRF_HEADER),
    tailscaleUser: request.headers.get("tailscale-user-login"),
    requestProtocol: request.nextUrl.protocol,
    allowedTailscaleHosts: splitAllowedValues(process.env.ALLOWED_TAILSCALE_HOSTS),
    allowedTailscaleUsers: splitAllowedValues(process.env.ALLOWED_TAILSCALE_USERS),
    csrfExempt: permitsCsrfExemption(request),
    csrfToken: PROCESS_CSRF_TOKEN,
  });
  if (!boundary.ok) {
    return denyResponse(
      request.nextUrl.pathname.startsWith("/api/"),
      boundary.status,
      boundary.error,
    );
  }
  const queryResponse = credentialQueryResponse(request);
  if (queryResponse) return queryResponse;
  const denied = enforceAccess(request);
  if (denied) return denied;

  const start = Date.now();

  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown";

  const method = request.method;
  const path = request.nextUrl.pathname;
  const sanitizedUrl = request.nextUrl.clone();
  for (const key of sanitizedUrl.searchParams.keys()) {
    if (credentialQueryKeys.has(key.toLowerCase())) {
      sanitizedUrl.searchParams.set(key, "[redacted]");
    }
  }
  const query = sanitizedUrl.search || "";
  const userAgent = request.headers.get("User-Agent")?.slice(0, 100) || "unknown";
  const rawReferer = request.headers.get("Referer") || "-";
  const referer = (() => {
    if (rawReferer === "-") return "-";
    try {
      const parsed = new URL(rawReferer);
      return `${parsed.origin}${parsed.pathname}`.slice(0, 200);
    } catch {
      return "[invalid]";
    }
  })();

  const authHeader = request.headers.get("Authorization") || "";
  const hasAuth = Boolean(authHeader);

  const country = request.headers.get("CF-IPCountry") || "-";

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CSRF_BOOTSTRAP_HEADER, PROCESS_CSRF_TOKEN);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });

  const duration = Date.now() - start;

  const timestamp = new Date().toISOString();
  const logParts = [
    `ip=${clientIp}`,
    `country=${country}`,
    `method=${method}`,
    `path=${path}${query}`,
    `duration=${duration}ms`,
    `auth=${hasAuth ? "present" : "none"}`,
    `ua=${userAgent}`,
  ];

  if (referer !== "-") {
    logParts.push(`referer=${referer}`);
  }

  const logMsg = `${timestamp} ACCESS ${logParts.join(" | ")}`;

  if (process.env.LOCAL_STUDIO_ACCESS_LOGS === "true") {
    console.log(logMsg);
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(CSRF_COOKIE, PROCESS_CSRF_TOKEN, {
    httpOnly: false,
    sameSite: "strict",
    secure: boundary.remote,
    path: "/",
  });

  return response;
}

export default proxy;

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    // Every /api/* request, unconditionally. This MUST come first and carry no
    // extension exclusion: the privileged API routes are the token gate's whole
    // point, and dynamic segments (/api/proxy/[...path], /api/agent/sessions/[id])
    // let a caller append a `.png`-style suffix. If the static-asset exclusion
    // below also covered /api, that suffix would skip the gate entirely.
    "/api/:path*",
    /*
     * All non-API paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (icons/, image extensions)
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
