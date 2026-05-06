// CRITICAL
/**
 * Normalize and allow-list URLs for the Computer embedded browser (iframe).
 * Aligns loosely with controller browser_open_url rules (no loopback / private nets).
 *
 * `file://` URLs are allowed for local file viewing (the webview/iframe handles them
 * directly). The caller must decide whether to pass them to a server-side fetch;
 * this function only validates the URL structure.
 */
export function sanitizeEmbeddedBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "file:") return null;

  // file:// URLs are allowed directly — no hostname checks needed.
  if (url.protocol === "file:") return url.toString();

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return null;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some((n) => n < 0 || n > 255)) return null;
    if (a === 10 || a === 127 || a === 0) return null;
    if (a === 169 && b === 254) return null;
    if (a === 172 && b >= 16 && b <= 31) return null;
    if (a === 192 && b === 168) return null;
    if (a === 100 && b >= 64 && b <= 127) return null;
    if (a === 198 && (b === 18 || b === 19)) return null;
    if (a >= 224) return null;
  }

  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "::1" || h === "::") return null;
    if (h.startsWith("fc") || h.startsWith("fd")) return null;
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return null;
  }

  return url.toString();
}
