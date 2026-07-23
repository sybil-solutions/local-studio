export type BrowserNetworkMode = "public" | "loopback";
export type BrowserAddressClass = "public" | "loopback" | "blocked";
export type BrowserNavigation = { mode: BrowserNetworkMode; url: string };

type Ipv4 = readonly [number, number, number, number];
type Ipv6 = readonly [number, number, number, number, number, number, number, number];

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [Ipv4, number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 31, 196, 0], 24],
  [[192, 52, 193, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[192, 175, 48, 0], 24],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const BLOCKED_IPV6_RANGES: ReadonlyArray<readonly [Ipv6, number]> = [
  [[0x2001, 0, 0, 0, 0, 0, 0, 0], 23],
  [[0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32],
  [[0x2002, 0, 0, 0, 0, 0, 0, 0], 16],
  [[0x2620, 0x004f, 0x8000, 0, 0, 0, 0, 0], 48],
  [[0x3fff, 0, 0, 0, 0, 0, 0, 0], 20],
];

function parseUrl(raw: string, protocols: ReadonlySet<string>): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!protocols.has(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function ipv4Octets(input: string): Ipv4 | null {
  const match = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (!match) return null;
  const [first, second, third, fourth] = match.slice(1).map(Number);
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    [first, second, third, fourth].some(
      (value) => !Number.isInteger(value) || value < 0 || value > 255,
    )
  ) {
    return null;
  }
  return [first, second, third, fourth];
}

function ipv4Value(address: Ipv4): number {
  return (((address[0] * 256 + address[1]) * 256 + address[2]) * 256 + address[3]) >>> 0;
}

function ipv4InRange(address: Ipv4, range: Ipv4, prefix: number): boolean {
  const shift = 32 - prefix;
  return ipv4Value(address) >>> shift === ipv4Value(range) >>> shift;
}

function hextet(input: string): number | null {
  if (!/^[0-9a-f]{1,4}$/iu.test(input)) return null;
  return Number.parseInt(input, 16);
}

function expandedIpv6Input(input: string): string | null {
  const value = input.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!value || value.includes("%")) return null;
  const lastColon = value.lastIndexOf(":");
  if (!value.includes(".") || lastColon < 0) return value;
  const ipv4 = ipv4Octets(value.slice(lastColon + 1));
  if (!ipv4) return null;
  const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
  const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
  return `${value.slice(0, lastColon)}:${high}:${low}`;
}

function ipv6Words(input: string): Ipv6 | null {
  const expanded = expandedIpv6Input(input);
  if (!expanded || !expanded.includes(":")) return null;
  const halves = expanded.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => hextet(part) === null)) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) =>
    Number.parseInt(part, 16),
  );
  const [first, second, third, fourth, fifth, sixth, seventh, eighth, extra] = words;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined ||
    sixth === undefined ||
    seventh === undefined ||
    eighth === undefined ||
    extra !== undefined
  ) {
    return null;
  }
  return [first, second, third, fourth, fifth, sixth, seventh, eighth];
}

function ipv6InRange(address: Ipv6, range: Ipv6, prefix: number): boolean {
  const completeWords = Math.floor(prefix / 16);
  for (let index = 0; index < completeWords; index += 1) {
    if (address[index] !== range[index]) return false;
  }
  const remaining = prefix % 16;
  if (remaining === 0) return true;
  const mask = (0xffff << (16 - remaining)) & 0xffff;
  const addressWord = address[completeWords];
  const rangeWord = range[completeWords];
  return addressWord !== undefined && rangeWord !== undefined
    ? (addressWord & mask) === (rangeWord & mask)
    : false;
}

function mappedIpv4(address: Ipv6): Ipv4 | null {
  if (address.slice(0, 5).some((word) => word !== 0) || address[5] !== 0xffff) return null;
  return [address[6] >> 8, address[6] & 0xff, address[7] >> 8, address[7] & 0xff];
}

function classifyIpv4(address: Ipv4): BrowserAddressClass {
  if (address[0] === 127) return "loopback";
  return BLOCKED_IPV4_RANGES.some(([range, prefix]) => ipv4InRange(address, range, prefix))
    ? "blocked"
    : "public";
}

function classifyIpv6(address: Ipv6): BrowserAddressClass {
  const mapped = mappedIpv4(address);
  if (mapped) return classifyIpv4(mapped);
  if (address.slice(0, 7).every((word) => word === 0) && address[7] === 1) return "loopback";
  if (!ipv6InRange(address, [0x2000, 0, 0, 0, 0, 0, 0, 0], 3)) return "blocked";
  return BLOCKED_IPV6_RANGES.some(([range, prefix]) => ipv6InRange(address, range, prefix))
    ? "blocked"
    : "public";
}

export function classifyBrowserAddress(input: string): BrowserAddressClass {
  const host = input.replace(/^\[|\]$/gu, "");
  const ipv4 = ipv4Octets(host);
  if (ipv4) return classifyIpv4(ipv4);
  const ipv6 = ipv6Words(host);
  return ipv6 ? classifyIpv6(ipv6) : "blocked";
}

export function browserAddressFamily(input: string): 4 | 6 | null {
  const host = input.replace(/^\[|\]$/gu, "");
  if (ipv4Octets(host)) return 4;
  return ipv6Words(host) ? 6 : null;
}

function localHostname(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

function blockedHostname(host: string): boolean {
  return host.endsWith(".local");
}

function literalAddressClass(host: string): BrowserAddressClass | null {
  return browserAddressFamily(host) ? classifyBrowserAddress(host) : null;
}

function urlMode(url: URL): BrowserNetworkMode | null {
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.endsWith(".") ? rawHost.slice(0, -1) : rawHost;
  if (localHostname(host)) return "loopback";
  if (blockedHostname(host)) return null;
  const addressClass = literalAddressClass(host);
  if (addressClass === "loopback") return "loopback";
  return addressClass === "blocked" ? null : "public";
}

export function browserNavigation(raw: string): BrowserNavigation | null {
  const url = parseUrl(raw, new Set(["http:", "https:"]));
  if (!url) return null;
  const mode = urlMode(url);
  return mode ? { mode, url: url.toString() } : null;
}

export function sanitizeBrowserNetworkUrl(raw: string, mode: BrowserNetworkMode): string | null {
  const url = parseUrl(raw, new Set(["http:", "https:", "ws:", "wss:"]));
  if (!url) return null;
  const destinationMode = urlMode(url);
  if (!destinationMode || (mode === "public" && destinationMode === "loopback")) return null;
  return url.toString();
}

export function sanitizePublicBrowserUrl(raw: string): string | null {
  const navigation = browserNavigation(raw);
  return navigation?.mode === "public" ? navigation.url : null;
}

export function sanitizeBrowserPaneUrl(raw: string): string | null {
  return browserNavigation(raw)?.url ?? null;
}

export function sanitizeLocalFileUrl(raw: string): string | null {
  const url = parseUrl(raw, new Set(["file:"]));
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return host && host !== "localhost" ? null : url.toString();
}
