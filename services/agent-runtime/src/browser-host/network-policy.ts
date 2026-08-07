import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Effect, Schema } from "effect";
import { sanitizeBrowserPaneUrl, sanitizePublicBrowserUrl } from "../../../../shared/agent/sanitize-embedded-browser-url";
export type BrowserNetworkMode = "public" | "loopback";
export type BrowserNavigation = { mode: BrowserNetworkMode; url: string };
export type BrowserAddress = { address: string; family: 4 | 6 };
export type BrowserResolver = (hostname: string) => Promise<ReadonlyArray<BrowserAddress>>;
export type BrowserDestination = { address: BrowserAddress; port: number; url: string };
export interface BrowserNetworkPolicy {
  navigation(raw: string): BrowserNavigation | null;
  resolve(raw: string, mode: BrowserNetworkMode): Promise<BrowserDestination>;
}
const Answers = Schema.Array(Schema.Struct({ address: Schema.String, family: Schema.Literals([4, 6]) }));
const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4"); loopback.addAddress("::1", "ipv6");
const blocked = new BlockList();
function addRanges(list: BlockList, type: "ipv4" | "ipv6", ranges: string): void {
  for (const range of ranges.split(" ")) {
    const separator = range.lastIndexOf("/");
    list.addSubnet(range.slice(0, separator), Number(range.slice(separator + 1)), type);
  }
}
addRanges(blocked, "ipv4", "0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
addRanges(blocked, "ipv6", "2001::/23 2001:db8::/32 2002::/16 3fff::/20");
const systemResolver: BrowserResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
function addressClass(value: BrowserAddress): BrowserNetworkMode | "blocked" {
  const family = isIP(value.address);
  if (value.address.includes("%") || family !== value.family) return "blocked";
  const type = family === 6 ? "ipv6" : "ipv4";
  if (loopback.check(value.address, type)) return "loopback";
  if (blocked.check(value.address, type)) return "blocked";
  return family === 4 || globalIpv6.check(value.address, "ipv6") ? "public" : "blocked";
}
function acceptedNavigation(raw: string, mode: BrowserNetworkMode): BrowserNavigation | null {
  try {
    const url = new URL(raw.trim());
    if (!/^(?:http|ws)s?:$/u.test(url.protocol) || url.username || url.password) return null;
    const probe = new URL(url); probe.protocol = url.protocol.replace(/^ws/u, "http");
    const targetMode = sanitizePublicBrowserUrl(probe.toString())
      ? "public"
      : sanitizeBrowserPaneUrl(probe.toString())
        ? "loopback"
        : null;
    return targetMode && (mode === "loopback" || targetMode === "public") ? { mode: targetMode, url: url.toString() } : null;
  } catch {
    return null;
  }
}
export function createBrowserNetworkPolicy(defaultResolver: BrowserResolver = systemResolver): BrowserNetworkPolicy {
  const navigation = (raw: string): BrowserNavigation | null => {
    const accepted = acceptedNavigation(raw, "loopback");
    return accepted && /^https?:/u.test(accepted.url) ? accepted : null;
  };
  const resolve = async (raw: string, mode: BrowserNetworkMode): Promise<BrowserDestination> => {
    const navigation = acceptedNavigation(raw, mode);
    if (!navigation) throw new Error("Browser network policy blocked URL");
    const url = new URL(navigation.url);
    const hostname = url.hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
    const literalFamily = isIP(hostname);
    const input = literalFamily ? [{ address: hostname, family: literalFamily }] : await Effect.runPromise(
      Effect.tryPromise(() => defaultResolver(hostname)).pipe(Effect.timeout(5_000)),
    );
    const answers = Schema.decodeUnknownSync(Answers)(input);
    const classes = new Set(answers.map(addressClass));
    const address = answers[0];
    if (!address || classes.size !== 1 || !classes.has(navigation.mode)) throw new Error("Browser network policy blocked resolved destination");
    const port = url.port ? Number(url.port) : /^(?:https|wss):$/u.test(url.protocol) ? 443 : 80;
    return { address, port, url: url.toString() };
  };
  return { navigation, resolve };
}
export const browserNetworkPolicy = createBrowserNetworkPolicy();
