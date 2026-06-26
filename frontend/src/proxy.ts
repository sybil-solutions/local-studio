import { NextResponse, type NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
  timingSafeStringEqual,
} from "@/lib/auth/access";

const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function denyResponse(isApi: boolean, status: number, message: string): NextResponse {
  if (isApi) {
    return new NextResponse(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  return new NextResponse(message, { status });
}

// Broad access gate. The frontend hosts an in-process agent with shell/filesystem
// tools, so every route is privileged. See `@/lib/auth/access` for posture rules;
// crown-jewel API routes additionally self-check via `@/lib/auth/guard`. Returns
// a response when access is denied (or a cookie-setting redirect for the one-time
// `?token=` bootstrap), or null when the request may proceed.
function enforceAccess(request: NextRequest): NextResponse | null {
  const posture = resolveAccessPosture();
  if (posture.kind === "allow") return null;

  const url = request.nextUrl;
  const isApi = url.pathname.startsWith("/api/");

  // One-time bootstrap: `?token=<secret>` on a navigation sets an http-only
  // cookie and redirects to the clean URL.
  const queryToken = url.searchParams.get("token");
  if (queryToken && timingSafeStringEqual(queryToken.trim(), posture.token)) {
    const clean = url.clone();
    clean.searchParams.delete("token");
    const redirect = NextResponse.redirect(clean);
    redirect.cookies.set(STUDIO_TOKEN_COOKIE, posture.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: TOKEN_MAX_AGE_SECONDS,
    });
    return redirect;
  }

  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && timingSafeStringEqual(presented, posture.token)) return null;

  return denyResponse(isApi, 401, "Unauthorized");
}

/**
 * Access gate + logging proxy for security monitoring.
 * Enforces the token posture, then logs allowed requests with IP, path, user
 * agent, and auth status.
 */
export function proxy(request: NextRequest) {
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

  if (process.env.LOCAL_STUDIO_ACCESS_LOGS === "true") {
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
