// CRITICAL
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Access logging middleware for security monitoring.
 * Logs all requests with IP, path, user agent, and auth status.
 */
export function proxy(request: NextRequest) {
  const start = Date.now();

  // Extract client info
  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown";

  const method = request.method;
  const path = request.nextUrl.pathname;
  const query = request.nextUrl.search || "";
  const userAgent = request.headers.get("User-Agent")?.slice(0, 100) || "unknown";
  const referer = request.headers.get("Referer")?.slice(0, 200) || "-";

  // Check for API key in various places
  const authHeader = request.headers.get("Authorization") || "";
  const hasAuth = Boolean(authHeader);

  // Country info from Cloudflare
  const country = request.headers.get("CF-IPCountry") || "-";

  // Create response
  const response = NextResponse.next();

  // Calculate duration after response
  const duration = Date.now() - start;

  // Build log message
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

  // Log to console (will appear in container logs)
  console.log(logMsg);

  // Add security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

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
