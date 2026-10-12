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

/**
 * "private" is a real network someone may legitimately browse from their own
 * machine — RFC1918, CGNAT (which is where every Tailscale peer lives), and
 * link-local. "blocked" is the residue nothing should ever dial: unspecified,
 * benchmarking, multicast/reserved, malformed literals.
 */
function classifyIpv4([a, b]: [number, number, number, number]): BrowserHostClass {
  if (a === 127) return "loopback";
  if (
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  ) {
    return "private";
  }
  if (a === 0 || (a === 198 && (b === 18 || b === 19)) || a >= 224) return "blocked";
  return "public";
}

function classifyIpv6(normalized: string): BrowserHostClass {
  // Mapped spellings (::ffff:127.0.0.1) stay blocked outright: only the plain
  // spelling of an address earns its class.
  if (ipv4FromMappedIpv6(normalized)) return "blocked";
  if (normalized === "::1") return "loopback";
  if (normalized === "::") return "blocked";
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) {
    return "private";
  }
  return "public";
}

function ipv4FromMappedIpv6(host: string): [number, number, number, number] | null {
  const tail = host.startsWith("::ffff:")
    ? host.slice("::ffff:".length)
    : host.startsWith("0:0:0:0:0:ffff:")
      ? host.slice("0:0:0:0:0:ffff:".length)
      : "";
  if (!tail) return null;
  const dotted = ipv4Octets(tail);
  if (dotted) return dotted;
  const parts = tail.split(":");
  if (parts.length !== 2) return null;
  const words = parts.map((part) => Number.parseInt(part, 16));
  if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    return null;
  }
  const [high, low] = words as [number, number];
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

export function sanitizePublicBrowserUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  return classifyBrowserHost(host) === "public" ? url.toString() : null;
}

export type BrowserHostClass = "public" | "loopback" | "private" | "blocked";

/**
 * Classify a hostname or IP literal under the embedded-browser policy. This is
 * the single source of truth the sanitizers above are expressed against, and it
 * is what the agent runtime's DNS-pinning layer re-applies to every RESOLVED
 * address — so a public-looking name that resolves into a private range is
 * caught by exactly the same rules that vetted the URL. Note that a mapped
 * loopback (::ffff:127.0.0.1) classifies as "blocked", not "loopback": only
 * plain loopback spellings earn the pane's localhost allowance.
 */
export function classifyBrowserHost(host: string): BrowserHostClass {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return "loopback";
  // mDNS names live on the local network by definition.
  if (isLocalHostname(normalized)) return "private";
  const octets = ipv4Octets(normalized);
  if (octets) return classifyIpv4(octets);
  // Dotted-quad shaped but not a valid address: never dial it.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return "blocked";
  if (normalized.includes(":")) return classifyIpv6(normalized);
  return "public";
}

/**
 * The browser pane's navigate rules: public URLs plus loopback — the pane
 * exists to preview the dev servers the agent is running on this machine.
 * Other private ranges (the LAN, the tailnet) are opt-in via `allowPrivate`:
 * the desktop app turns it on because a single-user machine browsing its own
 * network is the product, while shared deployments keep the agent off the LAN
 * unless the operator says otherwise.
 */
export function sanitizeBrowserPaneUrl(
  raw: string,
  options?: { allowPrivate?: boolean },
): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostClass = classifyBrowserHost(url.hostname);
  if (hostClass === "public" || hostClass === "loopback") return url.toString();
  return hostClass === "private" && options?.allowPrivate ? url.toString() : null;
}

export function sanitizeLocalFileUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || url.protocol !== "file:") return null;
  const host = url.hostname.toLowerCase();
  if (host && host !== "localhost") return null;
  return url.toString();
}
