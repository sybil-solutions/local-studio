import { config as loadEnvironment } from "dotenv";
import { Schema } from "effect";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPersistedConfig, type ProviderConfig } from "./persisted-config";
import { parseBooleanFlag } from "../core/validation";

const positiveIntegerSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));

export interface Config {
  host: string;
  port: number;
  api_key?: string;
  allowed_hosts?: string[];
  cors_origins?: string[];
  inference_host: string;
  inference_port: number;

  data_dir: string;
  db_path: string;
  models_dir: string;
  sglang_python?: string;
  llama_bin?: string;
  mlx_python?: string;
  strict_openai_models: boolean;
  providers: ProviderConfig[];
}

export const loadDotEnvironment = (): string | undefined => {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
    resolve(process.cwd(), "..", "..", ".env"),
  ];

  const envPath = candidates.find((pathValue) => existsSync(pathValue));
  if (envPath) {
    loadEnvironment({ path: envPath });
  }
  return envPath;
};

const defaultModelsDirectory = (): string =>
  process.platform === "win32" ? join(homedir(), "models") : "/models";

const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const numericIpv4Pattern = /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*$/;
const loopbackHosts = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

const normalizedIp = (value: string): string | null => {
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
  const ip = normalizedIp(unwrapped);
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

const decodeAllowedHosts = (value: string): string[] => {
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

const defaultAllowedHosts = (host: string): string[] => {
  const normalized = normalizeControllerHost(host);
  if (!normalized) throw new Error("LOCAL_STUDIO_HOST must be a hostname or IP address");
  if (isLoopbackHost(normalized)) return [...new Set([normalized, ...loopbackHosts])];
  if (isWildcardHost(normalized)) return [];
  return [normalized];
};

const parseAllowedHosts = (value: string | undefined, host: string): string[] =>
  value?.trim() ? decodeAllowedHosts(value) : defaultAllowedHosts(host);

export const createConfig = (): Config => {
  loadDotEnvironment();

  // Anchor defaults to the controller package root (two levels up from src/config/)
  // so the data dir lands at <repo>/data regardless of the cwd the process started from.
  const controllerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const defaultDataDirectory = resolve(controllerRoot, "..", "data");

  const parseCorsOrigins = (value: string | undefined): string[] => {
    const defaults = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://[::1]:3001",
      "http://host.docker.internal:3000",
      "http://host.docker.internal:3001",
    ];
    const candidates =
      value && value.trim().length > 0 ? value.split(",").map((entry) => entry.trim()) : defaults;
    return [
      ...new Set(
        candidates
          .map((entry) => normalizeHttpOrigin(entry))
          .filter((entry): entry is string => Boolean(entry)),
      ),
    ];
  };

  const environmentSchema = Schema.Struct({
    LOCAL_STUDIO_HOST: Schema.String,
    LOCAL_STUDIO_PORT: positiveIntegerSchema,
    LOCAL_STUDIO_API_KEY: Schema.optional(Schema.String),
    LOCAL_STUDIO_ALLOW_UNAUTHENTICATED: Schema.optional(Schema.String),
    LOCAL_STUDIO_ALLOWED_HOSTS: Schema.optional(Schema.String),
    LOCAL_STUDIO_CORS_ORIGINS: Schema.optional(Schema.String),
    LOCAL_STUDIO_INFERENCE_HOST: Schema.String,
    LOCAL_STUDIO_INFERENCE_PORT: positiveIntegerSchema,

    LOCAL_STUDIO_DATA_DIR: Schema.String,
    LOCAL_STUDIO_DB_PATH: Schema.optional(Schema.String),
    LOCAL_STUDIO_MODELS_DIR: Schema.String,
    LOCAL_STUDIO_SGLANG_PYTHON: Schema.optional(Schema.String),
    LOCAL_STUDIO_LLAMA_BIN: Schema.optional(Schema.String),
    LOCAL_STUDIO_MLX_PYTHON: Schema.optional(Schema.String),
    LOCAL_STUDIO_STRICT_OPENAI_MODELS: Schema.optional(Schema.String),
  });

  const coercePositiveInteger = (
    key: "LOCAL_STUDIO_PORT" | "LOCAL_STUDIO_INFERENCE_PORT",
    fallback: number,
  ): number => {
    const value = process.env[key];
    return value === undefined ? fallback : Number(value);
  };

  const parsed = Schema.decodeUnknownSync(environmentSchema, {
    onExcessProperty: "preserve",
  })({
    ...process.env,
    LOCAL_STUDIO_HOST: process.env["LOCAL_STUDIO_HOST"] ?? "127.0.0.1",
    LOCAL_STUDIO_PORT: coercePositiveInteger("LOCAL_STUDIO_PORT", 8080),
    LOCAL_STUDIO_INFERENCE_HOST: process.env["LOCAL_STUDIO_INFERENCE_HOST"] ?? "localhost",
    LOCAL_STUDIO_INFERENCE_PORT: coercePositiveInteger("LOCAL_STUDIO_INFERENCE_PORT", 8000),
    LOCAL_STUDIO_DATA_DIR: process.env["LOCAL_STUDIO_DATA_DIR"] ?? defaultDataDirectory,
    LOCAL_STUDIO_MODELS_DIR: process.env["LOCAL_STUDIO_MODELS_DIR"] ?? defaultModelsDirectory(),
  });
  const host = parsed.LOCAL_STUDIO_HOST.trim() || "127.0.0.1";

  const strictOpenAIModelsEnabled = parseBooleanFlag(parsed.LOCAL_STUDIO_STRICT_OPENAI_MODELS);

  // The db default follows the resolved data dir so overriding LOCAL_STUDIO_DATA_DIR
  // alone keeps the database inside it.
  const dataDirectory = resolve(parsed.LOCAL_STUDIO_DATA_DIR);
  const databasePath = resolve(
    parsed.LOCAL_STUDIO_DB_PATH ?? resolve(dataDirectory, "controller.db"),
  );
  const apiKey = parsed.LOCAL_STUDIO_API_KEY?.trim();
  const allowedHosts = apiKey
    ? undefined
    : parseAllowedHosts(parsed.LOCAL_STUDIO_ALLOWED_HOSTS, host);

  const config: Config = {
    host,
    port: parsed.LOCAL_STUDIO_PORT,
    inference_host: parsed.LOCAL_STUDIO_INFERENCE_HOST.trim() || "localhost",
    inference_port: parsed.LOCAL_STUDIO_INFERENCE_PORT,

    data_dir: dataDirectory,
    db_path: databasePath,
    models_dir: resolve(parsed.LOCAL_STUDIO_MODELS_DIR),
    strict_openai_models: strictOpenAIModelsEnabled,
    ...(allowedHosts ? { allowed_hosts: allowedHosts } : {}),
    cors_origins: parseCorsOrigins(parsed.LOCAL_STUDIO_CORS_ORIGINS),
    providers: [],
  };

  if (apiKey) {
    config.api_key = apiKey;
  }

  const allowUnauthenticated = parseBooleanFlag(parsed.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED);
  if (!config.api_key && !allowUnauthenticated && !isLoopbackHost(host)) {
    throw new Error(
      "LOCAL_STUDIO_API_KEY is required when binding the controller to a non-loopback host. Set LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true only for trusted local environments.",
    );
  }
  if (!config.api_key && isWildcardHost(host) && allowedHosts?.length === 0) {
    throw new Error(
      "LOCAL_STUDIO_ALLOWED_HOSTS is required for a keyless wildcard controller bind",
    );
  }

  if (parsed.LOCAL_STUDIO_SGLANG_PYTHON) {
    config.sglang_python = parsed.LOCAL_STUDIO_SGLANG_PYTHON;
  }
  if (parsed.LOCAL_STUDIO_LLAMA_BIN) {
    config.llama_bin = parsed.LOCAL_STUDIO_LLAMA_BIN;
  }
  if (parsed.LOCAL_STUDIO_MLX_PYTHON) {
    config.mlx_python = parsed.LOCAL_STUDIO_MLX_PYTHON;
  }

  const persisted = loadPersistedConfig(config.data_dir);
  if (persisted.models_dir) {
    config.models_dir = resolve(persisted.models_dir);
  }

  if (Array.isArray(persisted.providers)) {
    config.providers = persisted.providers;
  }

  return config;
};
