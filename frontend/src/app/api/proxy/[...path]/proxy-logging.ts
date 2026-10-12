import type { NextRequest } from "next/server";

const PROXY_ACCESS_LOGS_ENABLED = process.env.LOCAL_STUDIO_PROXY_ACCESS_LOGS === "true";
const PROXY_ERROR_LOG_THROTTLE_MS = 30_000;
const proxyErrorLogTimes = new Map<string, number>();

export type ClientInfo = { ip: string; country: string; ua: string };

export function getClientInfo(request: NextRequest): ClientInfo {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown";
  const country = request.headers.get("CF-IPCountry") || "-";
  const ua = request.headers.get("User-Agent")?.slice(0, 80) || "unknown";
  return { ip, country, ua };
}

function proxyLogKey(method: string, path: string[], error: unknown): string {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return `${method}:${path.join("/")}:${message.slice(0, 120)}`;
}

export function shouldLogProxyError(method: string, path: string[], error: unknown): boolean {
  const key = proxyLogKey(method, path, error);
  const now = Date.now();
  const previous = proxyErrorLogTimes.get(key) ?? 0;
  if (now - previous < PROXY_ERROR_LOG_THROTTLE_MS) return false;
  proxyErrorLogTimes.set(key, now);
  return true;
}

export function logProxyAccess({
  client,
  hasAuth,
  method,
  overrideUrl,
  path,
}: {
  client: ClientInfo;
  hasAuth: boolean;
  method: string;
  overrideUrl: string | null;
  path: string[];
}): void {
  if (!PROXY_ACCESS_LOGS_ENABLED) return;
  console.log(
    `[PROXY] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | backend=configured | override=${overrideUrl ? "yes" : "no"} | auth=${hasAuth ? "present" : "none"}`,
  );
}
