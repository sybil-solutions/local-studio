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

const PROCESS_CSRF_TOKEN = crypto.randomUUID();

function denyResponse(isApi: boolean, status: number, message: string): NextResponse {
  if (isApi) {
    return new NextResponse(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  return new NextResponse(message, { status });
}

function isAccessExchange(request: NextRequest): boolean {
  return request.nextUrl.pathname === "/api/auth/session" && request.method === "POST";
}

function permitsAccessEntry(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  return (
    (request.nextUrl.pathname === "/access" && (method === "GET" || method === "HEAD")) ||
    isAccessExchange(request)
  );
}

function queryTokenResponse(request: NextRequest): NextResponse | null {
  const clean = request.nextUrl.clone();
  const tokenKeys = [...clean.searchParams.keys()].filter((key) => key.toLowerCase() === "token");
  if (tokenKeys.length === 0) return null;
  for (const key of tokenKeys) clean.searchParams.delete(key);
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.redirect(clean, 303);
  }
  return denyResponse(isApi, 400, "Query-string access tokens are not accepted.");
}

function enforceAccess(request: NextRequest): NextResponse | null {
  const posture = resolveAccessPosture();
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (posture.kind === "configuration-error") {
    return denyResponse(isApi, 503, posture.message);
  }
  if (posture.kind === "allow" || permitsAccessEntry(request)) return null;
  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && timingSafeStringEqual(presented, posture.token)) return null;
  if (!isApi) return NextResponse.redirect(new URL("/access", request.url), 303);
  return denyResponse(true, 401, "Unauthorized");
}

export function proxy(request: NextRequest) {
  const csrfExempt = isAccessExchange(request);
  const boundary = evaluateRequestBoundary({
    method: request.method,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
    csrfCookie: csrfExempt ? PROCESS_CSRF_TOKEN : (request.cookies.get(CSRF_COOKIE)?.value ?? null),
    csrfHeader: csrfExempt ? PROCESS_CSRF_TOKEN : request.headers.get(CSRF_HEADER),
    tailscaleUser: request.headers.get("tailscale-user-login"),
    requestProtocol: request.nextUrl.protocol,
    allowedTailscaleHosts: splitAllowedValues(process.env.ALLOWED_TAILSCALE_HOSTS),
    allowedTailscaleUsers: splitAllowedValues(process.env.ALLOWED_TAILSCALE_USERS),
    csrfToken: PROCESS_CSRF_TOKEN,
  });
  if (!boundary.ok) {
    return denyResponse(
      request.nextUrl.pathname.startsWith("/api/"),
      boundary.status,
      boundary.error,
    );
  }
  const queryResponse = queryTokenResponse(request);
  if (queryResponse) return queryResponse;
  const denied = enforceAccess(request);
  if (denied) return denied;
  const startedAt = Date.now();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CSRF_BOOTSTRAP_HEADER, PROCESS_CSRF_TOKEN);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  writeAccessLog(request, Date.now() - startedAt);
  applySecurityHeaders(request, response);
  return response;
}

function clientIpOf(request: NextRequest): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}

function redactedQuery(request: NextRequest): string {
  const sanitizedUrl = request.nextUrl.clone();
  for (const sensitiveKey of ["api_key", "key", "token", "access_token"]) {
    if (sanitizedUrl.searchParams.has(sensitiveKey)) {
      sanitizedUrl.searchParams.set(sensitiveKey, "[redacted]");
    }
  }
  return sanitizedUrl.search || "";
}

function safeReferer(request: NextRequest): string {
  const raw = request.headers.get("Referer") || "-";
  if (raw === "-") return "-";
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 200);
  } catch {
    return "[invalid]";
  }
}

function writeAccessLog(request: NextRequest, duration: number): void {
  if (process.env.LOCAL_STUDIO_ACCESS_LOGS !== "true") return;
  const referer = safeReferer(request);
  const logParts = [
    `ip=${clientIpOf(request)}`,
    `country=${request.headers.get("CF-IPCountry") || "-"}`,
    `method=${request.method}`,
    `path=${request.nextUrl.pathname}${redactedQuery(request)}`,
    `duration=${duration}ms`,
    `auth=${request.headers.get("Authorization") ? "present" : "none"}`,
    `ua=${request.headers.get("User-Agent")?.slice(0, 100) || "unknown"}`,
  ];
  if (referer !== "-") logParts.push(`referer=${referer}`);
  console.log(`${new Date().toISOString()} ACCESS ${logParts.join(" | ")}`);
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "no-referrer");
  const effectiveProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ||
    request.nextUrl.protocol.replace(/:$/, "");
  response.cookies.set(CSRF_COOKIE, PROCESS_CSRF_TOKEN, {
    httpOnly: false,
    sameSite: "strict",
    secure: effectiveProto === "https",
    path: "/",
  });
}

export default proxy;

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!api/|_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
