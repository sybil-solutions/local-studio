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

type HostDecision =
  | { readonly ok: false; readonly failure: RequestBoundaryResult }
  | { readonly ok: true; readonly effectiveHost: string; readonly remote: boolean };

/** Which host this request is really for, and whether it reached us from off-box. */
function resolveHost(input: RequestBoundaryInput): HostDecision {
  const host = normalizedHost(input.host);
  const forwardedHost = input.forwardedHost ? normalizedHost(input.forwardedHost) : null;
  const allowedHosts = new Set(input.allowedTailscaleHosts.map((entry) => entry.toLowerCase()));
  const allowed = (candidate: string) => isLoopbackHost(candidate) || allowedHosts.has(candidate);

  if (!host || !allowed(host)) {
    return { ok: false, failure: { ok: false, status: 421, error: "Host is not allowed" } };
  }
  if (input.forwardedHost && !forwardedHost) {
    return { ok: false, failure: { ok: false, status: 421, error: "Forwarded host is invalid" } };
  }
  if (forwardedHost && !allowed(forwardedHost)) {
    return {
      ok: false,
      failure: { ok: false, status: 421, error: "Forwarded host is not allowed" },
    };
  }
  const effectiveHost = forwardedHost ?? host;
  return { ok: true, effectiveHost, remote: !isLoopbackHost(effectiveHost) };
}

/** Tailscale identity gate. Only applies to remote callers, and only when an
 *  allowlist is configured. */
function rejectedUser(input: RequestBoundaryInput, remote: boolean): RequestBoundaryResult | null {
  if (!remote || input.allowedTailscaleUsers.length === 0) return null;
  const allowedUsers = new Set(input.allowedTailscaleUsers.map((entry) => entry.toLowerCase()));
  const user = input.tailscaleUser?.trim().toLowerCase() ?? "";
  if (allowedUsers.has(user)) return null;
  return { ok: false, status: 403, error: "Tailscale user is not allowed" };
}

/** The Origin header must name the same host and scheme we are serving. */
function rejectedOrigin(
  input: RequestBoundaryInput,
  effectiveHost: string,
  remote: boolean,
): RequestBoundaryResult | null {
  if (!input.origin) return null;
  const protocol = remote
    ? input.forwardedProto?.split(",")[0]?.trim().toLowerCase() || "https"
    : input.requestProtocol.replace(/:$/, "").toLowerCase();
  try {
    const origin = new URL(input.origin);
    if (origin.host.toLowerCase() !== effectiveHost || origin.protocol !== `${protocol}:`) {
      return { ok: false, status: 403, error: "Origin is not allowed" };
    }
  } catch {
    return { ok: false, status: 403, error: "Origin is invalid" };
  }
  return null;
}

/** CSRF only defends against a *browser* replaying ambient credentials from
 *  another origin. Our own server-to-server callers (the pi tool extensions:
 *  browser_*) POST from Node with no cookie jar and no origin, so they
 *  could never satisfy a double-submit token — and every browser attaches at
 *  least one of Origin/Sec-Fetch-Site to a cross-origin mutation, so the
 *  absence of both is proof this is not a browser. Skipping the token check
 *  there is what makes the agent's own tools work; the host allowlist,
 *  cross-site rejection and the access-token guard still apply. */
function rejectedCsrf(input: RequestBoundaryInput): RequestBoundaryResult | null {
  const fromBrowser = Boolean(input.origin) || Boolean(input.fetchSite);
  if (!fromBrowser) return null;
  if (input.csrfCookie === input.csrfToken && input.csrfHeader === input.csrfToken) return null;
  return { ok: false, status: 403, error: "CSRF validation failed" };
}

export function evaluateRequestBoundary(input: RequestBoundaryInput): RequestBoundaryResult {
  const hostDecision = resolveHost(input);
  if (!hostDecision.ok) return hostDecision.failure;
  const { effectiveHost, remote } = hostDecision;

  const userRejection = rejectedUser(input, remote);
  if (userRejection) return userRejection;

  if (!isMutation(input.method)) return { ok: true, remote };

  if (input.fetchSite?.toLowerCase() === "cross-site") {
    return { ok: false, status: 403, error: "Cross-site mutation rejected" };
  }
  return (
    rejectedOrigin(input, effectiveHost, remote) ?? rejectedCsrf(input) ?? { ok: true, remote }
  );
}
