import { Schema } from "effect";
import { isIP } from "node:net";

const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const numericIpv4Pattern = /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*$/;
const loopbackHosts = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

const normalizeIp = (value: string): string | null => {
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  try {
    return new URL(`http://[${value}]`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
};

export const normalizeControllerHost = (value: string): string | null => {
  const candidate = value.trim().toLowerCase();
  const bracketed = candidate.startsWith("[") || candidate.endsWith("]");
  if (bracketed && !(candidate.startsWith("[") && candidate.endsWith("]"))) return null;
  const unwrapped = bracketed ? candidate.slice(1, -1) : candidate;
  const ip = normalizeIp(unwrapped);
  if (ip) return bracketed && isIP(unwrapped) !== 6 ? null : ip;
  if (numericIpv4Pattern.test(unwrapped)) {
    try {
      const numericIp = new URL(`http://${unwrapped}`).hostname;
      return isIP(numericIp) === 4 ? numericIp : null;
    } catch {
      return null;
    }
  }
  if (
    bracketed ||
    candidate.length > 253 ||
    candidate.endsWith(".") ||
    candidate.includes(":") ||
    candidate.includes("@") ||
    candidate.includes("/") ||
    candidate.includes("*")
  ) {
    return null;
  }
  return candidate.split(".").every((label) => hostnamePattern.test(label)) ? candidate : null;
};

export const isLoopbackHost = (value: string): boolean => {
  const normalized = normalizeControllerHost(value);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

export const isWildcardHost = (value: string): boolean => {
  const normalized = normalizeControllerHost(value);
  return normalized === "0.0.0.0" || normalized === "::";
};

export const normalizeHttpOrigin = (value: string): string | null => {
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !normalizeControllerHost(parsed.hostname)
    ) {
      return null;
    }
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
};

const allowedHostSchema = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      const normalized = normalizeControllerHost(value);
      return normalized !== null && !isWildcardHost(normalized);
    },
    { expected: "an exact hostname or IP address" },
  ),
);
const allowedHostsSchema = Schema.Array(allowedHostSchema).check(Schema.isNonEmpty());

export const decodeAllowedHosts = (value: string): string[] => {
  try {
    const entries = Schema.decodeUnknownSync(allowedHostsSchema)(value.split(","));
    return [
      ...new Set(
        entries.flatMap((entry) => {
          const normalized = normalizeControllerHost(entry);
          return normalized ? [normalized] : [];
        }),
      ),
    ];
  } catch {
    throw new Error(
      "LOCAL_STUDIO_ALLOWED_HOSTS must contain a nonempty comma-separated list of exact hostnames or IP addresses",
    );
  }
};

export const defaultAllowedHosts = (host: string): string[] => {
  const normalized = normalizeControllerHost(host);
  if (!normalized) throw new Error("LOCAL_STUDIO_HOST must be a hostname or IP address");
  if (isLoopbackHost(normalized)) return [...new Set([normalized, ...loopbackHosts])];
  if (isWildcardHost(normalized)) return [];
  return [normalized];
};

export const normalizeRequestAuthority = (value: string, expectedPort: number): string | null => {
  const candidate = value.trim().toLowerCase();
  if (!candidate || /[\s/@?#]/.test(candidate)) return null;
  const match = candidate.startsWith("[")
    ? candidate.match(/^\[([^\]]+)](?::([0-9]+))?$/)
    : candidate.match(/^([^:]+)(?::([0-9]+))?$/);
  if (!match?.[1]) return null;
  const host = normalizeControllerHost(match[1]);
  if (!host || isWildcardHost(host)) return null;
  const suppliedPort = match[2];
  if (suppliedPort !== undefined) {
    const port = Number(suppliedPort);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || port !== expectedPort) {
      return null;
    }
  }
  return host;
};
