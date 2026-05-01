// CRITICAL
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Access logging proxy for security monitoring.
 * Logs all requests with IP, path, user agent, and auth status.
 */
export function proxy(request: NextRequest) {
  const start = Date.now();

  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown";

  const method = request.method;
  const path = request.nextUrl.pathname;
  const sanitizedUrl = request.nextUrl.clone();
  for (const sensitiveKey of ["api_key", "key", "token", "access_token"]) {
    if (sanitizedUrl.searchParams.has(sensitiveKey)) {
      sanitizedUrl.searchParams.set(sensitiveKey, "[redacted]");
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

  const response = NextResponse.next();

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

  if (process.env.VLLM_STUDIO_ACCESS_LOGS === "true") {
    console.log(logMsg);
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

export default proxy;

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
