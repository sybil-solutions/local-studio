import { lookup } from "node:dns/promises";
import { Effect, Schema } from "effect";
import {
  browserAddressFamily,
  classifyBrowserAddress,
  sanitizeBrowserNetworkUrl,
  type BrowserAddressClass,
  type BrowserNetworkMode,
} from "../../../../shared/agent/sanitize-embedded-browser-url";

const RESOLUTION_TIMEOUT_MS = 5_000;
const ResolvedAddressSchema = Schema.Struct({
  address: Schema.String,
  family: Schema.Union([Schema.Literal(4), Schema.Literal(6)]),
});
const ResolvedAddressesSchema = Schema.Array(ResolvedAddressSchema);

export type ResolvedBrowserAddress = { address: string; family: 4 | 6 };
export type BrowserHostResolver = (
  hostname: string,
) => Promise<ReadonlyArray<ResolvedBrowserAddress>>;
export type PinnedBrowserDestination = {
  address: ResolvedBrowserAddress;
  addressClass: Exclude<BrowserAddressClass, "blocked">;
  hostname: string;
  mode: BrowserNetworkMode;
  port: number;
  url: URL;
};
export type BrowserNetworkPolicy = {
  allows: (raw: string, mode: BrowserNetworkMode) => boolean;
  resolve: (raw: string, mode: BrowserNetworkMode) => Promise<PinnedBrowserDestination>;
};

export class BrowserNetworkPolicyError extends Error {
  override name = "BrowserNetworkPolicyError";
}

function normalizedHostname(hostname: string): string {
  const unwrapped = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return unwrapped.endsWith(".") ? unwrapped.slice(0, -1) : unwrapped;
}

function destinationPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80;
}

async function systemResolver(hostname: string): Promise<ReadonlyArray<ResolvedBrowserAddress>> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
}

function allowedAddressClass(
  addressClass: BrowserAddressClass,
  mode: BrowserNetworkMode,
): addressClass is Exclude<BrowserAddressClass, "blocked"> {
  return addressClass === "public" || (addressClass === "loopback" && mode === "loopback");
}

function literalDestination(hostname: string): ResolvedBrowserAddress | null {
  const family = browserAddressFamily(hostname);
  return family ? { address: hostname, family } : null;
}

function validatedAnswers(input: unknown): ReadonlyArray<ResolvedBrowserAddress> {
  try {
    const addresses = Schema.decodeUnknownSync(ResolvedAddressesSchema)(input);
    for (const address of addresses) {
      if (browserAddressFamily(address.address) !== address.family) {
        throw new BrowserNetworkPolicyError("Resolved host returned an invalid address family");
      }
    }
    return addresses;
  } catch (error) {
    if (error instanceof BrowserNetworkPolicyError) throw error;
    throw new BrowserNetworkPolicyError(
      `Resolved host returned invalid addresses: ${String(error)}`,
    );
  }
}

async function resolvedAnswers(
  hostname: string,
  resolver: BrowserHostResolver,
  timeoutMs: number,
): Promise<ReadonlyArray<ResolvedBrowserAddress>> {
  const resolution = Effect.tryPromise({
    try: () => resolver(hostname),
    catch: (error) =>
      new BrowserNetworkPolicyError(`Host resolution failed for ${hostname}: ${String(error)}`),
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.fail(new BrowserNetworkPolicyError(`Host resolution timed out for ${hostname}`)),
    }),
  );
  return validatedAnswers(await Effect.runPromise(resolution));
}

async function pinnedAddress(
  hostname: string,
  mode: BrowserNetworkMode,
  resolver: BrowserHostResolver,
  timeoutMs: number,
): Promise<{
  address: ResolvedBrowserAddress;
  addressClass: Exclude<BrowserAddressClass, "blocked">;
}> {
  const literal = literalDestination(hostname);
  const addresses = literal ? [literal] : await resolvedAnswers(hostname, resolver, timeoutMs);
  if (addresses.length === 0) {
    throw new BrowserNetworkPolicyError(`Host resolved to no addresses: ${hostname}`);
  }
  const classes = new Set(addresses.map(({ address }) => classifyBrowserAddress(address)));
  if (classes.size !== 1) {
    throw new BrowserNetworkPolicyError(`Host resolved to mixed address classes: ${hostname}`);
  }
  const addressClass = classes.values().next().value;
  const address = addresses[0];
  if (!addressClass || !address) {
    throw new BrowserNetworkPolicyError(`Host resolved to no usable addresses: ${hostname}`);
  }
  if (!allowedAddressClass(addressClass, mode)) {
    throw new BrowserNetworkPolicyError(`Browser network policy blocked destination: ${hostname}`);
  }
  return { address, addressClass };
}

export function createBrowserNetworkPolicy({
  resolver = systemResolver,
  timeoutMs = RESOLUTION_TIMEOUT_MS,
}: {
  resolver?: BrowserHostResolver;
  timeoutMs?: number;
} = {}): BrowserNetworkPolicy {
  const allows = (raw: string, mode: BrowserNetworkMode) =>
    sanitizeBrowserNetworkUrl(raw, mode) !== null;
  const resolve = async (raw: string, mode: BrowserNetworkMode) => {
    const safe = sanitizeBrowserNetworkUrl(raw, mode);
    if (!safe) throw new BrowserNetworkPolicyError("Browser network policy blocked URL");
    const url = new URL(safe);
    const hostname = normalizedHostname(url.hostname);
    const destination = await pinnedAddress(hostname, mode, resolver, timeoutMs);
    return {
      ...destination,
      hostname,
      mode,
      port: destinationPort(url),
      url,
    };
  };
  return { allows, resolve };
}

export const browserNetworkPolicy = createBrowserNetworkPolicy();
