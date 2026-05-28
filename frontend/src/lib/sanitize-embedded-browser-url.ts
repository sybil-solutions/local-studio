/**
 * Normalize and allow-list URLs for the Computer embedded browser.
 * Public URLs align loosely with controller browser_open_url rules
 * (no loopback / private nets). Local file URLs are intentionally separate so
 * agent/browser-tool and server-side fetch paths cannot accidentally read disk.
 */
function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function isLocalHostname(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local");
}

function ipv4Octets(host: string): [number, number, number, number] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number) as [number, number, number, number];
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv4(host: string): boolean {
  const octets = ipv4Octets(host);
  return !octets || isPrivateIpv4(octets);
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

function isBlockedPublicHost(host: string): boolean {
  if (isLocalHostname(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isBlockedIpv4(host);
  return host.includes(":") && isPrivateIpv6(host);
}

export function sanitizePublicBrowserUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  return isBlockedPublicHost(host) ? null : url.toString();
}

export function sanitizeLocalFileUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || url.protocol !== "file:") return null;
  const host = url.hostname.toLowerCase();
  if (host && host !== "localhost") return null;
  return url.toString();
}
