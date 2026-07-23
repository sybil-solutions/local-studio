export const CSRF_COOKIE = "local_studio_csrf";
export const CSRF_HEADER = "x-local-studio-csrf";
export const CSRF_BOOTSTRAP_HEADER = "x-local-studio-csrf-bootstrap";

export type RequestBoundaryInput = {
  method: string;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  origin: string | null;
  fetchSite: string | null;
  csrfCookie: string | null;
  csrfHeader: string | null;
  tailscaleUser: string | null;
  requestProtocol: string;
  allowedTailscaleHosts: string[];
  allowedTailscaleUsers: string[];
  csrfExempt: boolean;
  csrfToken: string;
};

export type RequestBoundaryResult =
  | { ok: true; remote: boolean }
  | { ok: false; status: 403 | 421; error: string };

function normalizedHost(value: string | null): string | null {
  const host = value?.trim().toLowerCase();
  if (!host || host.includes(",") || /[\s/@\\]/.test(host)) return null;
  return host;
}

function hostname(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLoopbackHost(value: string): boolean {
  const name = hostname(value);
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function isMutation(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function splitAllowedValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function evaluateRequestBoundary(input: RequestBoundaryInput): RequestBoundaryResult {
  const host = normalizedHost(input.host);
  const forwardedHost = input.forwardedHost ? normalizedHost(input.forwardedHost) : null;
  const allowedHosts = new Set(input.allowedTailscaleHosts.map((entry) => entry.toLowerCase()));
  if (!host || (!isLoopbackHost(host) && !allowedHosts.has(host))) {
    return { ok: false, status: 421, error: "Host is not allowed" };
  }
  if (input.forwardedHost && !forwardedHost) {
    return { ok: false, status: 421, error: "Forwarded host is invalid" };
  }
  if (forwardedHost && !isLoopbackHost(forwardedHost) && !allowedHosts.has(forwardedHost)) {
    return { ok: false, status: 421, error: "Forwarded host is not allowed" };
  }
  const effectiveHost = forwardedHost ?? host;
  const remote = !isLoopbackHost(effectiveHost);
  if (remote && input.allowedTailscaleUsers.length > 0) {
    const allowedUsers = new Set(input.allowedTailscaleUsers.map((entry) => entry.toLowerCase()));
    const user = input.tailscaleUser?.trim().toLowerCase() ?? "";
    if (!allowedUsers.has(user))
      return { ok: false, status: 403, error: "Tailscale user is not allowed" };
  }
  if (!isMutation(input.method)) return { ok: true, remote };
  if (input.fetchSite?.toLowerCase() === "cross-site") {
    return { ok: false, status: 403, error: "Cross-site mutation rejected" };
  }
  const protocol = remote
    ? input.forwardedProto?.split(",")[0]?.trim().toLowerCase() || "https"
    : input.requestProtocol.replace(/:$/, "").toLowerCase();
  if (input.origin) {
    try {
      const origin = new URL(input.origin);
      if (origin.host.toLowerCase() !== effectiveHost || origin.protocol !== `${protocol}:`) {
        return { ok: false, status: 403, error: "Origin is not allowed" };
      }
    } catch {
      return { ok: false, status: 403, error: "Origin is invalid" };
    }
  }
  if (input.csrfExempt) return { ok: true, remote };
  if (input.csrfCookie !== input.csrfToken || input.csrfHeader !== input.csrfToken) {
    return { ok: false, status: 403, error: "CSRF validation failed" };
  }
  return { ok: true, remote };
}
